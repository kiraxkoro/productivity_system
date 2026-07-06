// Person B: the Tracker screen — two halves, one place to see progress.
// Tasks = long-running goals with per-item checkboxes.
// Habits = daily checkmarks with monthly stats.

import { useState } from "react";
import GoalList from "./GoalList";
import HabitList from "./HabitList";
import "./tracker.css";

type SubTab = "tasks" | "habits";

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
      </nav>
      {sub === "tasks" ? <GoalList /> : <HabitList />}
    </div>
  );
}
