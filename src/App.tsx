import { useEffect, useRef, useState } from "react";
import ScheduleList from "./routes/scheduler/ScheduleList";
import GoalList from "./routes/tracker/GoalList";
import HabitList from "./routes/tracker/HabitList";
import ProgressPanel from "./routes/tracker/ProgressPanel";
import Dashboard from "./routes/dashboard/Dashboard";
import ToastHost from "./routes/tracker/Toasts";
import AuthGate, { signOut, useSession } from "./auth/AuthGate";
import SettingsModal from "./SettingsModal";
import {
  getXp,
  levelOf,
  rankOf,
  xpIntoLevel,
  xpNeededFor,
} from "./routes/tracker/progress";
import "./App.css";

type Page = "dashboard" | "scheduler" | "tasks" | "habits" | "progress";

const NAV: { id: Page; icon: string; label: string }[] = [
  { id: "dashboard", icon: "▦", label: "Dashboard" },
  { id: "scheduler", icon: "⏱", label: "Scheduler" },
  { id: "tasks", icon: "🎯", label: "Task Tracker" },
  { id: "habits", icon: "🔁", label: "Habit Tracker" },
  { id: "progress", icon: "🏆", label: "Progress" },
];

function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Shell() {
  const [page, setPage] = useState<Page>("dashboard");
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  // a task card on the dashboard can jump straight to its open checklist
  const [focusGoalId, setFocusGoalId] = useState<string | null>(null);

  function openTasks(goalId?: string) {
    setFocusGoalId(goalId ?? null);
    setPage("tasks");
  }

  function goTo(id: Page) {
    if (id !== "tasks") setFocusGoalId(null);
    setPage(id);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand side-brand">⚡ Focus OS</div>
        <nav className="side-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "side-item on" : "side-item"}
              onClick={() => goTo(n.id)}
            >
              <span className="side-icon">{n.icon}</span>
              <span className="side-label">{n.label}</span>
            </button>
          ))}
        </nav>
        <ProfileBlock onOpenSettings={() => setShowSettings(true)} />
      </aside>

      {/* phone-width nav: bottom tab bar replaces the vertical rail —
          see the max-width: 560px block in App.css */}
      <nav className="bottom-nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={page === n.id ? "bottom-nav-item on" : "bottom-nav-item"}
            onClick={() => goTo(n.id)}
          >
            <span className="bottom-nav-icon">{n.icon}</span>
            <span className="bottom-nav-label">{n.label}</span>
          </button>
        ))}
      </nav>

      <div className="main">
        {page === "dashboard" && (
          <div className="main-top">
            <input
              className="search"
              type="search"
              placeholder="🔍 Search tasks and habits…"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
          </div>
        )}
        <main className="content">
          {page === "dashboard" ? (
            <Dashboard query={query} onOpenTasks={openTasks} />
          ) : page === "scheduler" ? (
            <ScheduleList />
          ) : page === "tasks" ? (
            <GoalList key={focusGoalId ?? "tasks"} initialExpanded={focusGoalId} />
          ) : page === "habits" ? (
            <HabitList />
          ) : (
            <ProgressPanel />
          )}
        </main>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <ToastHost />
    </div>
  );
}

/** Sidebar footer: who you are + how far you've leveled. Clicking it opens
 *  the account menu (Settings / Log out). XP stays live via the "xp-changed"
 *  event that applyTickXp fires on every tick. */
function ProfileBlock({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [xp, setXp] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useSession();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getXp()
      .then(setXp)
      .catch(() => {});
    const onXp = (e: Event) => setXp((e as CustomEvent<number>).detail);
    window.addEventListener("xp-changed", onXp);
    return () => window.removeEventListener("xp-changed", onXp);
  }, []);

  // any click outside the profile area closes the menu
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const level = levelOf(xp);
  const pct = (xpIntoLevel(xp) / xpNeededFor(level)) * 100;
  const name = session?.user.email?.split("@")[0] ?? "You";

  return (
    <div className="profile-wrap" ref={wrapRef}>
      {menuOpen && (
        <div className="profile-menu">
          <button
            className="menu-item"
            onClick={() => {
              setMenuOpen(false);
              onOpenSettings();
            }}
          >
            ⚙️ Settings
          </button>
          <button
            className="menu-item danger"
            onClick={() => {
              setMenuOpen(false);
              void signOut();
            }}
          >
            🚪 Log out
          </button>
        </div>
      )}
      <button
        className={`profile ${menuOpen ? "open" : ""}`}
        title={session?.user.email ?? "Account"}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <div className="avatar">👤</div>
        <div className="profile-info">
          <div className="profile-name">{name}</div>
          <div className="profile-level muted">
            {rankOf(level)} · Level {level} · {xp} XP
          </div>
          <div className="profile-bar">
            <div className="profile-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </button>
    </div>
  );
}

export default App;
