// Supabase client for email+password accounts (multi-device access).
// Signing in is REQUIRED — the app does not open without an account.
//
// The URL + anon key identify the project and are safe to ship in the app
// (the anon key is public by design; data access is enforced server-side by
// Supabase row-level security). .env.local can override them for dev.

import { createClient } from "@supabase/supabase-js";

const DEFAULT_URL = "https://gnicnofcbynnafkxyznc.supabase.co";
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduaWNub2ZjYnlubmFma3h5em5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjcxNzgsImV4cCI6MjA5OTAwMzE3OH0.HlSCUxz51r9y_uuaNkJxfU2O9Xb95X5-VfM5Dpbw99Q";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? DEFAULT_URL;
const anonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? DEFAULT_ANON_KEY;

export const supabase = createClient(url, anonKey);

/** True once the placeholder values above have been replaced. */
export const isConfigured =
  !url.includes("YOUR-PROJECT") && !anonKey.includes("YOUR-ANON");
