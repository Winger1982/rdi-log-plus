import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://axhpjwqvdtjeyqyiqoyg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6hEILqgZS51Q7Bk5OiusKw_BcsDHq07';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
