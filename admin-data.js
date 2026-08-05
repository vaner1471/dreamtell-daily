'use strict';

const {
  createServerSupabaseClient,
  requireServerEnvironmentVariable
} = require('../lib/supabase-server');

function safeDatabaseErrorCode(error) {
  return error && typeof error.code === 'string' ? error.code : 'unknown';
}

function createHandler(options) {
  const createSupabase = options && options.createSupabase
    ? options.createSupabase
    : createServerSupabaseClient;
  const requireEnvironmentVariable = options && options.requireEnvironmentVariable
    ? options.requireEnvironmentVariable
    : requireServerEnvironmentVariable;

  return async function adminData(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pwd');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ success: false });

    let adminPassword;
    try {
      adminPassword = requireEnvironmentVariable('ADMIN_PASSWORD');
    } catch (error) {
      console.error('Daily server configuration error:', {
        missing: error && error.variable ? error.variable : 'unknown'
      });
      return res.status(500).json({ success: false, error: 'Server configuration error' });
    }

    if (req.headers['x-admin-pwd'] !== adminPassword) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

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
      const { data, error } = await supabase
        .from('daily_entries')
        .select('*')
        .order('submitted_at', { ascending: false });

      if (error) {
        console.error('Supabase daily_entries select failed:', {
          code: safeDatabaseErrorCode(error)
        });
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('Supabase daily_entries select request failed:', {
        code: safeDatabaseErrorCode(error)
      });
      return res.status(500).json({ success: false, error: 'Database error' });
    }
  };
}

const handler = createHandler();
handler._test = { createHandler, safeDatabaseErrorCode };
module.exports = handler;
