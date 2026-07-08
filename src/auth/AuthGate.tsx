// Wraps the app: no session -> LoginScreen, no exceptions. Sessions persist
// in the webview's localStorage, so a signed-in device stays signed in across
// restarts (and keeps working offline once the session is cached).

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import LoginScreen from "./LoginScreen";
import "./auth.css";

const SessionContext = createContext<Session | null>(null);

/** Current auth session (null while signed out). */
export function useSession() {
  return useContext(SessionContext);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // resolving = reading the persisted session at startup; render nothing
  // rather than flashing the login screen at every launch
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setResolving(false));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (resolving) return null;
  if (!session) return <LoginScreen />;
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

export async function signOut() {
  await supabase.auth.signOut();
}
