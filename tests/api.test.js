'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const dailyModule = require('../api/daily-submit');
const adminModule = require('../api/admin-data');
const supabaseServer = require('../lib/supabase-server');

function request(method, body, headers) {
  return { method, body: body || {}, headers: headers || {} };
}

function response() {
  return {
    headers: {}, statusCode: null, body: null, ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; }
  };
}

function validBody() {
  return {
    participant_id: 'TEST-001', entry_date: '2026-08-04', wave: 'high_pressure', lang: 'en',
    bedtime: '11PM-12AM / 11-12点', wake_time: '7AM-8AM / 7-8点', sleep_quality: 4,
    sleep_latency: 'Took a little while / 花了一会儿', night_awakenings: 'No / 没有',
    unresolved_mind: 'No / 没有', unresolved_categories: [], dream_recall: 'No dreams / 不记得梦',
    dream_text_raw: null, stress_level: 3, stress_causes: [], stress_vs_avg: 'Same / 差不多',
    mental_health: 4
  };
}

function insertClient(result, observed) {
  return {
    from(table) {
      observed.table = table;
      return {
        async insert(row) {
          observed.row = row;
          if (result instanceof Error) throw result;
          return result;
        }
      };
    }
  };
}

async function withoutExpectedErrorLogs(callback) {
  const original = console.error;
  console.error = function ignoreExpectedError() {};
  try { return await callback(); } finally { console.error = original; }
}

test('normal Daily insert returns 200 and writes daily_entries', async function() {
  const observed = {};
  const handler = dailyModule._test.createHandler({
    createSupabase: function() { return insertClient({ error: null }, observed); }
  });
  const res = response();
  await handler(request('POST', validBody()), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true });
  assert.equal(observed.table, 'daily_entries');
  assert.equal(observed.row.participant_id, 'TEST-001');
  assert.equal(observed.row.entry_date, '2026-08-04');
});

test('23505 returns the stable already_submitted business code', async function() {
  const handler = dailyModule._test.createHandler({
    createSupabase: function() { return insertClient({ error: { code: '23505' } }, {}); }
  });
  const res = response();
  await handler(request('POST', validBody()), res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { success: false, code: 'already_submitted' });
});

test('42501 and Supabase network failures are logged safely and remain generic to participants', async function() {
  const captured = [];
  const original = console.error;
  console.error = function capture() { captured.push(Array.from(arguments)); };
  try {
    for (const result of [{ error: { code: '42501', message: 'dream text must not leak' } }, new Error('network details')]) {
      const handler = dailyModule._test.createHandler({
        createSupabase: function() { return insertClient(result, {}); }
      });
      const res = response();
      await handler(request('POST', validBody()), res);
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { success: false, error: 'Submission failed' });
    }
  } finally {
    console.error = original;
  }
  const logged = JSON.stringify(captured);
  assert.match(logged, /42501/);
  assert.doesNotMatch(logged, /dream text must not leak|network details|TEST-001/);
});

test('missing service role environment variable fails explicitly', async function() {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.invalid';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.throws(
      function createClient() { supabaseServer.createServerSupabaseClient(); },
      /SUPABASE_SERVICE_ROLE_KEY/
    );
    await withoutExpectedErrorLogs(async function() {
      const res = response();
      await dailyModule(request('POST', validBody()), res);
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { success: false, error: 'Server configuration error' });
    });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test('DeepSeek normal, timeout, permanent pending, invalid JSON, illegal tags and network cases still save', async function() {
  const cases = [
    {
      name: 'normal',
      fetchImpl: async function() { return { ok: true, async json() { return { choices: [{ message: { content: '{"themes":["school"],"emotions":["stressed"],"tone":"negative","confidence":0.9,"notes":""}' } }] }; } }; }
    },
    {
      name: 'timeout',
      fetchImpl: function(url, options) { return new Promise(function(resolve, reject) { options.signal.addEventListener('abort', function() { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }); }); }
    },
    { name: 'permanent pending', fetchImpl: function() { return new Promise(function() {}); } },
    {
      name: 'invalid JSON',
      fetchImpl: async function() { return { ok: true, async json() { return { choices: [{ message: { content: 'not json' } }] }; } }; }
    },
    {
      name: 'HTTP error',
      fetchImpl: async function() { return { ok: false, status: 402, async json() { return {}; } }; }
    },
    {
      name: 'illegal tags',
      fetchImpl: async function() { return { ok: true, async json() { return { choices: [{ message: { content: '{"themes":["forbidden","school"],"emotions":["illegal","calm"],"tone":"wild","confidence":0.7,"notes":""}' } }] }; } }; }
    },
    { name: 'network exception', fetchImpl: async function() { throw new Error('offline'); } }
  ];

  await withoutExpectedErrorLogs(async function() {
    for (const scenario of cases) {
      const observed = {};
      const handler = dailyModule._test.createHandler({
        createSupabase: function() { return insertClient({ error: null }, observed); },
        tagDream: function(text) {
          return dailyModule._test.tagDream(text, {
            apiKey: 'test-only-key', fetchImpl: scenario.fetchImpl, timeoutMs: 15
          });
        }
      });
      const body = validBody();
      body.dream_recall = 'Very clear / 非常清楚';
      body.dream_text_raw = 'I was walking through a school corridor.';
      const res = response();
      await handler(request('POST', body), res);
      assert.equal(res.statusCode, 200, scenario.name);
      assert.ok(observed.row, scenario.name + ' did not insert');
      if (scenario.name === 'illegal tags') {
        assert.deepEqual(observed.row.ai_themes, ['school']);
        assert.deepEqual(observed.row.ai_emotions, ['calm']);
        assert.equal(observed.row.ai_tone, 'neutral');
      }
      if (['timeout','permanent pending','invalid JSON','HTTP error','network exception'].includes(scenario.name)) {
        assert.equal(observed.row.ai_processed, false, scenario.name);
        assert.equal(observed.row.manual_review, true, scenario.name);
      }
    }
  });
});

test('a throwing tagger cannot prevent database persistence', async function() {
  const observed = {};
  const handler = dailyModule._test.createHandler({
    createSupabase: function() { return insertClient({ error: null }, observed); },
    tagDream: async function() { throw new Error('unexpected tagger failure'); }
  });
  const body = validBody();
  body.dream_recall = 'Very clear / 非常清楚';
  body.dream_text_raw = 'A sufficiently long dream.';
  await withoutExpectedErrorLogs(async function() {
    const res = response();
    await handler(request('POST', body), res);
    assert.equal(res.statusCode, 200);
  });
  assert.equal(observed.row.ai_processed, false);
  assert.equal(observed.row.manual_review, true);
});

test('CORS OPTIONS and invalid methods do not touch Supabase', async function() {
  let calls = 0;
  const handler = dailyModule._test.createHandler({ createSupabase: function() { calls++; } });
  const optionsRes = response();
  await handler(request('OPTIONS'), optionsRes);
  assert.equal(optionsRes.statusCode, 200);
  assert.equal(optionsRes.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  const getRes = response();
  await handler(request('GET'), getRes);
  assert.equal(getRes.statusCode, 405);
  assert.equal(calls, 0);
});

test('admin endpoint authenticates and reads daily_entries', async function() {
  let table;
  const handler = adminModule._test.createHandler({
    requireEnvironmentVariable: function() { return 'test-password'; },
    createSupabase: function() {
      return { from(name) { table = name; return { select() { return { async order() { return { data: [{ id: 1 }], error: null }; } }; } }; } };
    }
  });
  const optionsRes = response();
  await handler(request('OPTIONS'), optionsRes);
  assert.equal(optionsRes.statusCode, 200);
  const invalidMethod = response();
  await handler(request('POST'), invalidMethod);
  assert.equal(invalidMethod.statusCode, 405);
  const unauthorized = response();
  await handler(request('GET', null, { 'x-admin-pwd': 'wrong' }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  const ok = response();
  await handler(request('GET', null, { 'x-admin-pwd': 'test-password' }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(table, 'daily_entries');
});

test('static routes, three-layer fields, local date, RLS and browser compatibility align', function() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const vercel = JSON.parse(fs.readFileSync(path.join(projectRoot, 'vercel.json'), 'utf8'));
  const index = fs.readFileSync(path.join(projectRoot, 'public/index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(projectRoot, 'public/admin.html'), 'utf8');
  const schema = fs.readFileSync(path.join(projectRoot, 'supabase-schema.sql'), 'utf8');
  const server = ['api/daily-submit.js','api/admin-data.js','lib/supabase-server.js']
    .map(function(file) { return fs.readFileSync(path.join(projectRoot, file), 'utf8'); }).join('\n');
  const publicCode = index + '\n' + admin;

  assert.equal(packageJson.scripts.test, 'node --test tests/*.test.js');
  assert.deepEqual(vercel.rewrites, [{ source: '/admin', destination: '/admin.html' }]);
  assert.match(index, /fetch\('\/api\/daily-submit'/);
  assert.ok(fs.existsSync(path.join(projectRoot, 'api/daily-submit.js')));
  assert.ok(fs.existsSync(path.join(projectRoot, 'api/admin-data.js')));
  assert.match(index, /getFullYear\(\)/);
  assert.match(index, /getMonth\(\) \+ 1/);
  assert.doesNotMatch(index, /toISOString\(\).*entry_date/);
  assert.match(index, /noDream \? null/);
  assert.match(index, /if \(!saidYes\) d\.unresolved_categories = \[\]/);
  assert.match(index, /result\.code === 'already_submitted'/);
  assert.match(schema, /UNIQUE \(participant_id, entry_date\)/i);
  assert.match(schema, /ALTER TABLE daily_entries ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(schema, /CREATE\s+POLICY/i);

  const rowFields = ['participant_id','entry_date','wave','lang','bedtime','wake_time','sleep_quality','sleep_latency','night_awakenings','unresolved_mind','unresolved_categories','dream_recall','dream_text_raw','stress_level','stress_causes','stress_vs_avg','mental_health','ai_themes','ai_emotions','ai_tone','ai_confidence','ai_notes','ai_processed','manual_review'];
  for (const field of rowFields) assert.match(schema, new RegExp('\\b' + field + '\\b'));
  const frontendFields = new Set(Array.from(index.matchAll(/data-field="([^"]+)"/g), function(match) { return match[1]; }));
  for (const field of ['bedtime','wake_time','sleep_quality','sleep_latency','night_awakenings','unresolved_mind','unresolved_categories','dream_recall','stress_level','stress_causes','stress_vs_avg','mental_health']) {
    assert.ok(frontendFields.has(field), 'missing frontend field ' + field);
  }
  for (const field of ['participant_id','entry_date','wave','lang','dream_text_raw']) assert.match(index, new RegExp('\\b' + field + '\\b'));

  assert.match(server, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(server, /SUPABASE_ANON_KEY/);
  assert.doesNotMatch(publicCode, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|ADMIN_PWD|Chrisgogogo/);
  assert.doesNotMatch(publicCode, /\?\.|\?\?|catch\s*\{\s*\}/);
  for (const match of publicCode.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(function parseInlineScript() { new vm.Script(match[1]); });
  }
});
