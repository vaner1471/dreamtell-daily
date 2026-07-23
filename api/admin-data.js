// api/admin-data.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pwd');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-admin-pwd'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { data, error } = await supabase
    .from('daily_entries')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.status(200).json({ success: true, data });
};
