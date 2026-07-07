// Person B: the Tracker screen — three halves, one place to see progress.
// Tasks = long-running goals with per-item checkboxes.
// Habits = daily checkmarks with monthly stats.
// Progress = XP, level ring, achievements (ticks earn +10 XP, unticks −10).

import { useState } from "react";
import GoalList from "./GoalList";
import HabitList from "./HabitList";
import ProgressPanel from "./ProgressPanel";
import ToastHost from "./Toasts";
import "./tracker.css";

type SubTab = "tasks" | "habits" | "progress";

export default function TrackerPage() {
  const [sub, setSub] = useState<SubTab>("tasks");

  return (
    <div className="tracker">
      <nav className="subtabs">
        <button
          className={sub === "tasks" ? "subtab on" : "subtab"}
          onClick={() => setSub("tasks")}
        >
          🎯 Task Tracker
        </button>
        <button
          className={sub === "habits" ? "subtab on" : "subtab"}
          onClick={() => setSub("habits")}
        >
          🔁 Habit Tracker
        </button>
        <button
          className={sub === "progress" ? "subtab on" : "subtab"}
          onClick={() => setSub("progress")}
        >
          🏆 Progress
        </button>
      </nav>
      {sub === "tasks" ? (
        <GoalList />
      ) : sub === "habits" ? (
        <HabitList />
      ) : (
        <ProgressPanel />
      )}
      <ToastHost />
    </div>
  );
}
