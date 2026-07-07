// Person B: the Dashboard — everything at a glance. In-progress task cards
// (ring + checklist shortcut), completed tasks on the right, and this week's
// habit activity. The search box in the top bar filters both columns.

import { useCallback, useEffect, useState } from "react";
import type { Goal, Habit, HabitLog } from "../../shared/types";
import Ring from "../tracker/Ring";
import GoalForm from "../tracker/GoalForm";
import {
  createGoal,
  fmtPct,
  isComplete,
  listGoals,
  listHabitLogs,
  listHabits,
  pad,
  percentOf,
  toISO,
} from "../tracker/api";
import "../tracker/tracker.css";
import "./dashboard.css";

const DAY_LETTERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Dashboard({
  query,
  onOpenTasks,
}: {
  query: string;
  onOpenTasks: (goalId?: string) => void;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [weekLogs, setWeekLogs] = useState<HabitLog[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loadError, setLoadError] = useState("");

  // this week, Sunday -> Saturday
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const refresh = useCallback(async () => {
    try {
      const [g, h, l] = await Promise.all([
        listGoals(),
        listHabits(),
        listHabitLogs(toISO(weekStart), toISO(weekEnd)),
      ]);
      setGoals(g);
      setHabits(h);
      setWeekLogs(l);
      setLoadError("");
    } catch (e) {
      setLoadError(String(e));
    }
    // weekStart/weekEnd are derived from "now" — stable enough per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveNew(goal: Goal) {
    try {
      await createGoal(goal);
      setShowForm(false);
      await refresh();
    } catch (e) {
      setLoadError(String(e));
    }
  }

  const q = query.trim().toLowerCase();
  const matches = (title: string) => !q || title.toLowerCase().includes(q);
  const inProgress = goals.filter((g) => !isComplete(g) && matches(g.title));
  const completed = goals.filter((g) => isComplete(g) && matches(g.title));

  // habit check-ins per weekday of the current week
  const dayCounts = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return weekLogs.filter((l) => l.date === iso).length;
  });

  return (
    <div className="dash">
      {loadError && (
        <div className="banner error">
          Something went wrong ({loadError}). Run the desktop app with{" "}
          <code>npm run tauri dev</code>.
        </div>
      )}

      <div className="dash-main">
        <div className="section-head">
          <h2 className="dash-title">In Progress</h2>
          <button className="primary" onClick={() => setShowForm(true)}>
            ＋ New task
          </button>
        </div>
        {inProgress.length === 0 ? (
          <div className="empty-state card">
            <div className="empty-emoji">🎯</div>
            <p className="muted">
              {q ? `Nothing matches "${query}".` : "No active tasks yet — start one!"}
            </p>
          </div>
        ) : (
          <ul className="dash-grid">
            {inProgress.map((g) => (
              <DashCard key={g.id} goal={g} onOpen={() => onOpenTasks(g.id)} />
            ))}
          </ul>
        )}
      </div>

      <div className="dash-side">
        <h2 className="dash-title">Completed</h2>
        {completed.length === 0 ? (
          <p className="muted">
            {q ? "No completed tasks match." : "Nothing completed yet — it's coming."}
          </p>
        ) : (
          <ul className="dash-done-list">
            {completed.map((g) => (
              <li key={g.id} className="dash-done card">
                <Ring pct={100} size={64} stroke={7} tone="ok">
                  <span className="dash-done-pct">100%</span>
                </Ring>
                <div className="dash-done-info">
                  <div className="dash-card-title">{g.title}</div>
                  <span className="pill done">DONE ✓</span>
                  <div className="muted small">
                    {g.currentCount} of {g.targetCount} {g.unit}
                  </div>
                  <button className="chip" onClick={() => onOpenTasks(g.id)}>
                    show checklist ›
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="card week-card">
          <h3>Weekly Activity</h3>
          {habits.length === 0 ? (
            <p className="muted small">Habit check-ins appear here.</p>
          ) : (
            <WeekChart counts={dayCounts} habitCount={habits.length} />
          )}
        </div>
      </div>

      {showForm && (
        <GoalForm onSave={(g) => void saveNew(g)} onCancel={() => setShowForm(false)} />
      )}
    </div>
  );
}

function DashCard({ goal, onOpen }: { goal: Goal; onOpen: () => void }) {
  const pct = percentOf(goal);
  return (
    <li className="dash-card card">
      <Ring pct={pct} size={92} stroke={9}>
        <span className="ring-pct">{fmtPct(pct)}</span>
      </Ring>
      <div className="dash-card-info">
        <div className="dash-card-title">{goal.title}</div>
        <div className="muted small">
          {goal.currentCount} of {goal.targetCount} {goal.unit}
        </div>
        <button className="chip" onClick={onOpen}>
          show checklist ›
        </button>
      </div>
    </li>
  );
}

// Single-series column chart: habit check-ins per day, this week.
// Same mark specs as the month chart (thin rounded-top columns, hairline
// grid, muted ticks).
function WeekChart({ counts, habitCount }: { counts: number[]; habitCount: number }) {
  const W = 300;
  const H = 150;
  const top = 10;
  const bottom = 22;
  const left = 26;
  const right = 6;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const slot = plotW / 7;
  const barW = Math.min(18, slot - 6);
  const maxY = Math.max(habitCount, ...counts, 1);
  const y = (v: number) => top + plotH * (1 - v / maxY);
  const r = 4;

  const barPath = (cx: number, v: number) => {
    const x0 = cx - barW / 2;
    const h = plotH * (v / maxY);
    if (h <= r) return `M ${x0} ${top + plotH} v ${-h} h ${barW} v ${h} Z`;
    return [
      `M ${x0} ${top + plotH}`,
      `v ${-(h - r)}`,
      `q 0 ${-r} ${r} ${-r}`,
      `h ${barW - 2 * r}`,
      `q ${r} 0 ${r} ${r}`,
      `v ${h - r}`,
      `Z`,
    ].join(" ");
  };

  return (
    <div className="month-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Habit check-ins per day this week">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W - right} y1={y(f * maxY)} y2={y(f * maxY)} className="grid-line" />
            <text x={left - 5} y={y(f * maxY) + 3.5} className="tick" textAnchor="end">
              {Math.round(f * maxY)}
            </text>
          </g>
        ))}
        {counts.map((v, i) => {
          const cx = left + slot * (i + 0.5);
          return (
            <g key={i}>
              {v > 0 && <path d={barPath(cx, v)} className="bar" />}
              {v === 0 && (
                <line
                  x1={cx - barW / 2}
                  x2={cx + barW / 2}
                  y1={y(0)}
                  y2={y(0)}
                  className="bar-zero"
                />
              )}
              <text x={cx} y={H - 6} className="tick" textAnchor="middle">
                {DAY_LETTERS[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
