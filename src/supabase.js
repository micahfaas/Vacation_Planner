// Supabase client. URL and anon key come from Vite env vars (.env locally,
// repo variables in CI). The anon key is public by design — RLS protects data.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check your .env');
}

export const supabase = createClient(url, key);
