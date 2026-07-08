// App settings, opened from the profile menu: account, autostart, the
// commitment password, and the lockdown-surviving browser. These lived on the
// scheduler page before; a settings home suits them better.

import { useEffect, useState } from "react";
import { useSession } from "./auth/AuthGate";
import {
  getAllowedBrowser,
  getAutostart,
  hasCommitmentPassword,
  listBrowsers,
  setAllowedBrowser,
  setAutostart,
  setCommitmentPassword,
} from "./routes/scheduler/api";

const DEFAULT_BROWSERS = [
  { name: "Chrome", exe: "chrome.exe" },
  { name: "Edge", exe: "msedge.exe" },
  { name: "Brave", exe: "brave.exe" },
  { name: "Firefox", exe: "firefox.exe" },
];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const session = useSession();
  // null = backend doesn't support it (e.g. running in a plain browser)
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [hasPw, setHasPw] = useState(false);
  const [pwDraft, setPwDraft] = useState("");
  const [browser, setBrowser] = useState("chrome.exe");
  const [browserList, setBrowserList] = useState(DEFAULT_BROWSERS);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getAutostart()
      .then(setAutostartState)
      .catch(() => setAutostartState(null));
    hasCommitmentPassword().then(setHasPw).catch(() => {});
    getAllowedBrowser().then(setBrowser).catch(() => {});
    listBrowsers()
      .then((found) => found.length > 0 && setBrowserList(found))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function flash(msg: string) {
    setNotice(msg);
    setError("");
    setTimeout(() => setNotice(""), 5000);
  }

  async function toggleAutostart() {
    if (autostart === null) return;
    const next = !autostart;
    try {
      await setAutostart(next);
      setAutostartState(next);
    } catch (e) {
      setError(String(e));
    }
  }

  async function savePassword() {
    try {
      await setCommitmentPassword(pwDraft);
      setHasPw(pwDraft.trim().length > 0);
      flash(
        pwDraft.trim()
          ? "🔑 Commitment password set — breaking a running block now needs the phrase AND the password."
          : "Commitment password removed.",
      );
      setPwDraft("");
    } catch (e) {
      setError(String(e));
    }
  }

  async function changeBrowser(exe: string) {
    try {
      await setAllowedBrowser(exe);
      setBrowser(exe);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>⚙️ Settings</h2>

        {session && (
          <div className="settings-row">
            <span className="settings-label">Account</span>
            <span className="settings-value">{session.user.email}</span>
          </div>
        )}

        {autostart !== null && (
          <label className="check">
            <input
              type="checkbox"
              checked={autostart}
              onChange={() => void toggleAutostart()}
            />
            start automatically with the system (recommended)
          </label>
        )}
        <p className="muted small">
          Closing the window doesn't quit Focus OS — it keeps running in the
          system tray so your schedule always fires. Right-click the tray icon
          to quit completely.
        </p>

        <label className="check pw-row">
          🔑 commitment password {hasPw ? "(set)" : "(not set)"}:
          <input
            type="password"
            value={pwDraft}
            placeholder={hasPw ? "new password (empty = remove)" : "set one"}
            onChange={(e) => setPwDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void savePassword();
            }}
          />
          <button className="chip" onClick={() => void savePassword()}>
            save
          </button>
        </label>
        <p className="muted small">
          Also required to break a running block; can't be changed mid-block.
        </p>

        <label className="check browser-pick">
          your browser:
          <select
            value={browser}
            onChange={(e) => void changeBrowser(e.currentTarget.value)}
          >
            {(browserList.some((b) => b.exe === browser)
              ? browserList
              : [...browserList, { name: browser, exe: browser }]
            ).map((b) => (
              <option key={b.exe} value={b.exe}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          This one survives lockdown blocks (put the extension here and enable
          "Allow in Incognito"); all others get closed &amp; kept closed.
        </p>

        {notice && <p className="auth-notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}

        <div className="modal-footer">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
