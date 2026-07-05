import { useState } from "react";
import ScheduleList from "./routes/scheduler/ScheduleList";
import TrackerPage from "./routes/tracker/TrackerPage";
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
            Tracker
          </button>
        </nav>
      </header>
      <main className="content">
        {tab === "scheduler" ? <ScheduleList /> : <TrackerPage />}
      </main>
    </div>
  );
}

export default App;
