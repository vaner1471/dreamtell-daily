// api/daily-submit.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── DeepSeek dream tagger ──────────────────────────────────────────
async function tagDream(text) {
  if (!text || text.trim().length < 5) {
    return { themes: ['none'], emotions: [], tone: 'neutral', confidence: 1.0, notes: 'No dream text.' };
  }

  const prompt = `You are assisting with adolescent sleep research. Label this dream diary entry using ONLY the tags below. Return ONLY valid JSON, no markdown, no explanation.

Allowed themes: school, sports, family, friends, conflict, success, failure, injury, travel, nature, romantic, death, other, none
Allowed emotions: happy, calm, excited, stressed, sad, angry, confused, fearful, proud, lonely, embarrassed
Allowed tone: positive, neutral, negative

Dream text: "${text.slice(0, 400)}"

Return exactly:
{"themes":[],"emotions":[],"tone":"neutral","confidence":0.0,"notes":""}`;

  try {
    // 5s timeout: if DeepSeek is slow, abort and use fallback.
    // Without this, a slow DeepSeek response can exceed Vercel's 10s
    // function limit and kill the whole request before data is saved.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.2
      })
    });
    clearTimeout(timer);

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Validate allowed values
    const THEMES   = ['school','sports','family','friends','conflict','success','failure','injury','travel','nature','romantic','death','other','none'];
    const EMOTIONS = ['happy','calm','excited','stressed','sad','angry','confused','fearful','proud','lonely','embarrassed'];
    const TONES    = ['positive','neutral','negative'];

    return {
      themes:     (parsed.themes || []).filter(t => THEMES.includes(t)),
      emotions:   (parsed.emotions || []).filter(e => EMOTIONS.includes(e)),
      tone:       TONES.includes(parsed.tone) ? parsed.tone : 'neutral',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      notes:      parsed.notes || '',
      ai_processed: true,
      manual_review: false
    };
  } catch (err) {
    console.error('DeepSeek error:', err.message);
    return { themes: ['other'], emotions: [], tone: 'neutral', confidence: 0, notes: 'AI tagging failed.', ai_processed: false, manual_review: true };
  }
}

// ── Handler ───────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const d = req.body;

  const required = ['participant_id','entry_date','wave','bedtime','wake_time',
    'sleep_quality','sleep_latency','night_awakenings','unresolved_mind',
    'dream_recall','stress_level','stress_vs_avg','mental_health'];

  for (const f of required) {
    if (d[f] === null || d[f] === undefined || d[f] === '') {
      return res.status(400).json({ success: false, error: `Missing: ${f}` });
    }
  }

  // Tag dream if present
  let tagging = { themes: [], emotions: [], tone: null, confidence: null, notes: null, ai_processed: false, manual_review: false };
  if (d.dream_text_raw && d.dream_text_raw.trim().length > 5) {
    tagging = await tagDream(d.dream_text_raw);
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

  const { error } = await supabase.from('daily_entries').insert(row);
  if (error) {
    // Duplicate: same participant already submitted today (UNIQUE constraint)
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'already_submitted', message: 'You have already submitted an entry for today.' });
    }
    console.error(error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }

  return res.status(200).json({ success: true });
};
