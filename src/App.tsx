import { useState } from "react";
import ScheduleList from "./routes/scheduler/ScheduleList";
import "./App.css";

type Tab = "scheduler" | "tracker";

function App() {
  const [tab, setTab] = useState<Tab>("scheduler");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">⚡ Focus OS</div>
        <nav className="tabs">
          <button
            className={tab === "scheduler" ? "tab on" : "tab"}
            onClick={() => setTab("scheduler")}
          >
            Scheduler
          </button>
          <button
            className={tab === "tracker" ? "tab on" : "tab"}
            onClick={() => setTab("tracker")}
          >
            Task Tracker
          </button>
        </nav>
      </header>
      <main className="content">
        {tab === "scheduler" ? <ScheduleList /> : <TrackerPlaceholder />}
      </main>
    </div>
  );
}

// Person B's territory — this placeholder lives here (not in src/routes/tracker/)
// so their folder stays untouched until they build GoalList/GoalForm.
function TrackerPlaceholder() {
  return (
    <div className="tracker-placeholder">
      <div className="tracker-emoji">🎯</div>
      <h2>Task Tracker</h2>
      <p>
        Long-running goals like "90 LeetCode problems in 90 days" live here.
        <br />
        Person B is building this — the <code>goals</code> table and command
        contract are already waiting in <code>src/shared/types.ts</code>.
      </p>
    </div>
  );
}

export default App;
