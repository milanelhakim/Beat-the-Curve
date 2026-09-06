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
 * Assumed `notes` table schema — adjust the column names in App code below
 * if your actual table differs:
 *
 *   create table notes (
 *     user_id uuid references auth.users primary key,
 *     data jsonb not null,
 *     updated_at timestamptz default now()
 *   );
 *   alter table notes enable row level security;
 *   create policy "Users manage their own notes" on notes
 *     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *
 * One row per user; `data` holds the entire notebook payload (same shape
 * produced by hydrateData() in the main app) as a single JSON blob — this
 * mirrors the existing local/Drive JSON-backup model, just synced live.
 */

/** Starts the Google OAuth flow via Supabase, requesting Drive file access
 *  in the same consent screen as sign-in. */
export function signInWithGoogleDrive() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
      redirectTo: window.location.origin,
    },
  });
}

export function signOutOfGoogle() {
  return supabase.auth.signOut();
}
