'use strict';

const { createServerSupabaseClient } = require('../lib/supabase-server');

const THEMES = ['school','sports','family','friends','conflict','success','failure','injury','travel','nature','romantic','death','other','none'];
const EMOTIONS = ['happy','calm','excited','stressed','sad','angry','confused','fearful','proud','lonely','embarrassed'];
const TONES = ['positive','neutral','negative'];

function failedTagging() {
  return {
    themes: ['other'],
    emotions: [],
    tone: 'neutral',
    confidence: 0,
    notes: 'AI tagging failed.',
    ai_processed: false,
    manual_review: true
  };
}

function safeErrorReason(error) {
  if (error && error.code === 'DEEPSEEK_TIMEOUT') return 'timeout';
  if (error && error.name === 'AbortError') return 'timeout';
  if (error instanceof SyntaxError) return 'invalid_json';
  return 'request_failed';
}

function safeDatabaseErrorCode(error) {
  return error && typeof error.code === 'string' ? error.code : 'unknown';
}

// ── DeepSeek dream tagger ──────────────────────────────────────────
async function tagDream(text, options) {
  if (!text || text.trim().length < 5) {
    return { themes: ['none'], emotions: [], tone: 'neutral', confidence: 1.0, notes: 'No dream text.' };
  }

  const settings = options || {};
  const fetchImpl = settings.fetchImpl || fetch;
  const timeoutMs = settings.timeoutMs || 5000;
  const apiKey = Object.prototype.hasOwnProperty.call(settings, 'apiKey')
    ? settings.apiKey
    : process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    console.error('DeepSeek tagging skipped:', { reason: 'missing_api_key' });
    return failedTagging();
  }

  const prompt = `You are assisting with adolescent sleep research. Label this dream diary entry using ONLY the tags below. Return ONLY valid JSON, no markdown, no explanation.

Allowed themes: school, sports, family, friends, conflict, success, failure, injury, travel, nature, romantic, death, other, none
Allowed emotions: happy, calm, excited, stressed, sad, angry, confused, fearful, proud, lonely, embarrassed
Allowed tone: positive, neutral, negative

Dream text: "${text.slice(0, 400)}"

Return exactly:
{"themes":[],"emotions":[],"tone":"neutral","confidence":0.0,"notes":""}`;

  const controller = new AbortController();
  let timer;

  try {
    const request = (async function requestDeepSeek() {
      const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.2
        })
      });

      if (!response || !response.ok) {
        const error = new Error('DeepSeek request failed');
        error.code = 'DEEPSEEK_HTTP_ERROR';
        throw error;
      }
      return response.json();
    }());

    const timeout = new Promise(function rejectOnTimeout(resolve, reject) {
      timer = setTimeout(function abortDeepSeek() {
        controller.abort();
        const error = new Error('DeepSeek request timed out');
        error.code = 'DEEPSEEK_TIMEOUT';
        reject(error);
      }, timeoutMs);
    });

    const data = await Promise.race([request, timeout]);
    const raw = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content
      ? data.choices[0].message.content
      : '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    const parsedThemes = Array.isArray(parsed.themes) ? parsed.themes : [];
    const parsedEmotions = Array.isArray(parsed.emotions) ? parsed.emotions : [];
    const parsedConfidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    return {
      themes:     parsedThemes.filter(function validTheme(theme) { return THEMES.includes(theme); }),
      emotions:   parsedEmotions.filter(function validEmotion(emotion) { return EMOTIONS.includes(emotion); }),
      tone:       TONES.includes(parsed.tone) ? parsed.tone : 'neutral',
      confidence: parsedConfidence,
      notes:      typeof parsed.notes === 'string' ? parsed.notes : '',
      ai_processed: true,
      manual_review: false
    };
  } catch (error) {
    console.error('DeepSeek tagging failed:', { reason: safeErrorReason(error) });
    return failedTagging();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createHandler(options) {
  const createSupabase = options && options.createSupabase
    ? options.createSupabase
    : createServerSupabaseClient;
  const tagDreamEntry = options && options.tagDream
    ? options.tagDream
    : tagDream;

  return async function dailySubmit(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false });

    const d = req.body || {};
    const required = ['participant_id','entry_date','wave','bedtime','wake_time',
      'sleep_quality','sleep_latency','night_awakenings','unresolved_mind',
      'dream_recall','stress_level','stress_vs_avg','mental_health'];

    for (const f of required) {
      if (d[f] === null || d[f] === undefined || d[f] === '') {
        return res.status(400).json({ success: false, error: `Missing: ${f}` });
      }
    }

    let tagging = { themes: [], emotions: [], tone: null, confidence: null, notes: null, ai_processed: false, manual_review: false };
    if (d.dream_text_raw && d.dream_text_raw.trim().length > 5) {
      try {
        tagging = await tagDreamEntry(d.dream_text_raw);
      } catch (error) {
        // A replacement tagger must not be able to block database persistence.
        console.error('DeepSeek tagging failed:', { reason: safeErrorReason(error) });
        tagging = failedTagging();
      }
    }

    const row = {
      participant_id:        d.participant_id,
      entry_date:            d.entry_date,
      wave:                  d.wave,
      lang:                  d.lang || 'en',
      bedtime:               d.bedtime,
      wake_time:             d.wake_time,
      sleep_quality:         d.sleep_quality,
      sleep_latency:         d.sleep_latency,
      night_awakenings:      d.night_awakenings,
      unresolved_mind:       d.unresolved_mind,
      unresolved_categories: d.unresolved_categories || [],
      dream_recall:          d.dream_recall,
      dream_text_raw:        d.dream_text_raw || null,
      stress_level:          d.stress_level,
      stress_causes:         d.stress_causes || [],
      stress_vs_avg:         d.stress_vs_avg,
      mental_health:         d.mental_health,
      ai_themes:             tagging.themes,
      ai_emotions:           tagging.emotions,
      ai_tone:               tagging.tone,
      ai_confidence:         tagging.confidence,
      ai_notes:              tagging.notes,
      ai_processed:          tagging.ai_processed,
      manual_review:         tagging.manual_review,
    };

    let supabase;
    try {
      supabase = createSupabase();
    } catch (error) {
      console.error('Daily server configuration error:', {
        missing: error && error.variable ? error.variable : 'unknown'
      });
      return res.status(500).json({ success: false, error: 'Server configuration error' });
    }

    try {
      const { error } = await supabase.from('daily_entries').insert(row);
      
      if (error) {
        console.error('Supabase daily_entries insert ERROR DETAILS:', JSON.stringify(error, null, 2));

        if (error.code === '23505') {
          return res.status(409).json({ success: false, code: 'already_submitted' });
        }
        
        return res.status(500).json({ success: false, error: 'Submission failed', details: error.message });
      }
    } catch (error) {
      console.error('Supabase daily_entries insert request failed:', {
        code: safeDatabaseErrorCode(error)
      });
      return res.status(500).json({ success: false, error: 'Submission failed' });
    }

    return res.status(200).json({ success: true });
  };

  const handler = createHandler();
  handler._test = {
    createHandler,
    failedTagging,
    safeDatabaseErrorCode,
    safeErrorReason,
    tagDream
  };
  module.exports = handler;}


