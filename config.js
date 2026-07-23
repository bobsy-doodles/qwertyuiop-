// ============================================================
// Supabase connection — Project Settings → API in your dashboard
// ============================================================
// The anon key is safe to ship in client-side code. It does not
// grant any access by itself — every table has Row Level Security
// enabled (see supabase-schema.sql), so access is enforced by
// Postgres based on who is signed in, not by keeping this key secret.

const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
