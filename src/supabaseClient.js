import { createClient } from "@supabase/supabase-js";

// These read from Vite's env system. Vite only exposes variables prefixed
// with VITE_ to the browser bundle — this is intentional and safe, since
// the anon key is designed to be public (it's restricted by the Row Level
// Security policies we set up in Supabase, not by secrecy).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
});