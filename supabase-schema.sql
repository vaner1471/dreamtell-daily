CREATE TABLE IF NOT EXISTS daily_entries (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at          TIMESTAMPTZ DEFAULT NOW(),
  participant_id        TEXT NOT NULL,
  entry_date            DATE NOT NULL,
  wave                  TEXT,
  lang                  TEXT,
  bedtime               TEXT,
  wake_time             TEXT,
  sleep_quality         INTEGER,
  sleep_latency         TEXT,
  night_awakenings      TEXT,
  unresolved_mind       TEXT,
  unresolved_categories TEXT[],
  dream_recall          TEXT,
  dream_text_raw        TEXT,
  stress_level          INTEGER,
  stress_causes         TEXT[],
  stress_vs_avg         TEXT,
  mental_health         INTEGER,
  ai_themes             TEXT[],
  ai_emotions           TEXT[],
  ai_tone               TEXT,
  ai_confidence         NUMERIC(3,2),
  ai_notes              TEXT,
  ai_processed          BOOLEAN DEFAULT FALSE,
  manual_review         BOOLEAN DEFAULT FALSE,
  UNIQUE (participant_id, entry_date)
);

ALTER TABLE daily_entries ENABLE ROW LEVEL SECURITY;

-- Intentionally no anon SELECT or INSERT policy. The Vercel server functions
-- use the server-only service role; browsers never connect to Supabase.
