// Email + password sign-in / sign-up screen, shown by AuthGate until a
// session exists. One form, two modes; Supabase handles the heavy lifting.

import { useState } from "react";
import { isConfigured, supabase } from "./supabase";

type Mode = "signin" | "signup";

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    if (!isConfigured) {
      setError(
        "Auth backend not configured — set the Supabase URL + anon key in src/auth/supabase.ts or .env.local.",
      );
      return;
    }
    if (!email.trim() || !password) {
      setError("Email and password are both required.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) setError(error.message);
        // success: AuthGate's onAuthStateChange listener swaps in the app
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) {
          setError(error.message);
        } else if (!data.session) {
          // email confirmation is ON in the Supabase project
          setNotice(
            "Account created — check your email for a confirmation link, then sign in.",
          );
          setMode("signin");
        }
      }
    } catch (err) {
      setError(`Can't reach the server (${String(err)}). Check your internet connection.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">⚡ Focus OS</div>
        <h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
        <p className="muted auth-sub">
          {mode === "signin"
            ? "Sign in to access your account on this device."
            : "One account, all your devices."}
        </p>

        <form onSubmit={(e) => void submit(e)}>
          <label className="field">
            <span>Email</span>
            <input
              autoFocus
              type="email"
              autoComplete="email"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              placeholder={mode === "signup" ? "at least 6 characters" : "••••••••"}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
          </label>

          {error && <p className="form-error">{error}</p>}
          {notice && <p className="auth-notice">{notice}</p>}

          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : "Sign up"}
          </button>
        </form>

        <button
          type="button"
          className="ghost auth-switch"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError("");
            setNotice("");
          }}
        >
          {mode === "signin"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
