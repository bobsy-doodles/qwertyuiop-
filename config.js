// ============================================================
// Supabase connection — Project Settings → API in your dashboard
// ============================================================
// The anon key is safe to ship in client-side code. It does not
// grant any access by itself — every table has Row Level Security
// enabled (see supabase-schema.sql), so access is enforced by
// Postgres based on who is signed in, not by keeping this key secret.

const SUPABASE_URL = 'https://sycvuzhaajztybjrfumn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5Y3Z1emhhYWp6dHlianJmdW1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzMyOTQsImV4cCI6MjEwMDMwOTI5NH0.XrvSUmDksZkwh4ARi_pDTUX8vzhuJV4fWq27RqBM3RE';
