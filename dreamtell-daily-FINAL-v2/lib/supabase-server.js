'use strict';

function requireServerEnvironmentVariable(name) {
  const value = process.env[name];
  if (!value) {
    const error = new Error('Missing required server-side environment variable: ' + name);
    error.code = 'MISSING_ENVIRONMENT_VARIABLE';
    error.variable = name;
    throw error;
  }
  return value;
}

function createServerSupabaseClient() {
  const url = requireServerEnvironmentVariable('SUPABASE_URL');
  const serviceRoleKey = requireServerEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY');
  const { createClient } = require('@supabase/supabase-js');

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

module.exports = {
  createServerSupabaseClient,
  requireServerEnvironmentVariable
};
