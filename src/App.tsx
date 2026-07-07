import { useState } from "react";
import ScheduleList from "./routes/scheduler/ScheduleList";
import TrackerPage from "./routes/tracker/TrackerPage";
import AuthGate, { signOut, useSession } from "./auth/AuthGate";
import "./App.css";

type Tab = "scheduler" | "tracker";

function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("scheduler");
  const session = useSession();

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
        {session && (
          <div className="account-chip">
            <span title="Signed in on this device">{session.user.email}</span>
            <button className="ghost signout" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="content">
        {tab === "scheduler" ? <ScheduleList /> : <TrackerPage />}
      </main>
    </div>
  );
}

export default App;
