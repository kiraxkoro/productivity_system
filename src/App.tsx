import { useEffect, useState } from "react";
import ScheduleList from "./routes/scheduler/ScheduleList";
import GoalList from "./routes/tracker/GoalList";
import HabitList from "./routes/tracker/HabitList";
import ProgressPanel from "./routes/tracker/ProgressPanel";
import Dashboard from "./routes/dashboard/Dashboard";
import ToastHost from "./routes/tracker/Toasts";
import { getXp, levelOf, XP_PER_LEVEL, xpIntoLevel } from "./routes/tracker/progress";
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
  const [page, setPage] = useState<Page>("dashboard");
  const [query, setQuery] = useState("");
  // a task card on the dashboard can jump straight to its open checklist
  const [focusGoalId, setFocusGoalId] = useState<string | null>(null);

  function openTasks(goalId?: string) {
    setFocusGoalId(goalId ?? null);
    setPage("tasks");
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
              onClick={() => {
                if (n.id !== "tasks") setFocusGoalId(null);
                setPage(n.id);
              }}
            >
              <span className="side-icon">{n.icon}</span>
              <span className="side-label">{n.label}</span>
            </button>
          ))}
        </nav>
        <ProfileBlock />
      </aside>

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
      <ToastHost />
    </div>
  );
}

/** Sidebar footer: who you are + how far you've leveled. Stays live via the
 *  "xp-changed" event that applyTickXp fires on every tick. */
function ProfileBlock() {
  const [xp, setXp] = useState(0);

  useEffect(() => {
    getXp()
      .then(setXp)
      .catch(() => {});
    const onXp = (e: Event) => setXp((e as CustomEvent<number>).detail);
    window.addEventListener("xp-changed", onXp);
    return () => window.removeEventListener("xp-changed", onXp);
  }, []);

  const level = levelOf(xp);
  const pct = (xpIntoLevel(xp) / XP_PER_LEVEL) * 100;

  return (
    <div className="profile">
      <div className="avatar">👤</div>
      <div className="profile-info">
        <div className="profile-name">You</div>
        <div className="profile-level muted">
          Level {level} · {xp} XP
        </div>
        <div className="profile-bar">
          <div className="profile-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

export default App;
