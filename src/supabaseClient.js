import { createClient } from "@supabase/supabase-js";

/**
 * Assumption: this project uses Vite, so env vars are read via
 * `import.meta.env.VITE_*`. If your project is Create React App instead,
 * replace the two lines below with:
 *   const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
 *   const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
 * (and make sure the matching env vars are set in Vercel with that prefix).
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly and early rather than silently breaking auth/sync later.
  console.error(
    "Missing Supabase env vars. Expected VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
      "(adjust the names in supabaseClient.js if your bundler isn't Vite)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Actual `notes` table schema in use (adjust here if it changes again):
 *
 *   id uuid primary key default gen_random_uuid()
 *   user_id uuid references auth.users   -- needs a UNIQUE constraint for upsert to work
 *   "NoteBook" jsonb                     -- the entire notebook payload, case-sensitive name
 *   updated_at timestamptz default now()
 *
 * One row per user; the app's App.jsx reads/writes the "NoteBook" column.
 */

/** Starts the Google OAuth flow via Supabase, requesting Drive file access
 *  in the same consent screen as sign-in. */
export function signInWithGoogleDrive() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      redirectTo: window.location.origin,
    },
  });
}

export function signOutOfGoogle() {
  return supabase.auth.signOut();
}
