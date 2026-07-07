// Person B: daily habits. One checkbox per habit per day (the habit IS the
// description), with today's + this month's completion % and a month graph.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Habit, HabitLog } from "../../shared/types";
import Ring from "./Ring";
import {
  createHabit,
  daysInMonth,
  deleteHabit,
  fmtPct,
  listHabitLogs,
  listHabits,
  pad,
  setHabitDone,
  todayISO,
} from "./api";

export default function HabitList() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [loadError, setLoadError] = useState("");

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const totalDays = daysInMonth(year, month);
  const todayDay = now.getDate();
  const today = todayISO();
  const monthLabel = now.toLocaleString("en", { month: "long", year: "numeric" });

  const refresh = useCallback(async () => {
    try {
      const from = `${year}-${pad(month + 1)}-01`;
      const to = `${year}-${pad(month + 1)}-${pad(totalDays)}`;
      const [h, l] = await Promise.all([listHabits(), listHabitLogs(from, to)]);
      setHabits(h);
      setLogs(l);
      setLoadError("");
    } catch (e) {
      setLoadError(String(e));
    }
  }, [year, month, totalDays]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doneSet = useMemo(
    () => new Set(logs.map((l) => `${l.habitId}|${l.date}`)),
    [logs],
  );

  /** Completion fraction for one day, or null if no habits existed yet. */
  const dayFraction = useCallback(
    (day: number): number | null => {
      const date = `${year}-${pad(month + 1)}-${pad(day)}`;
      const existing = habits.filter((h) => h.createdDate <= date);
      if (existing.length === 0) return null;
      const done = existing.filter((h) => doneSet.has(`${h.id}|${date}`)).length;
      return done / existing.length;
    },
    [habits, doneSet, year, month],
  );

  const todayFraction = dayFraction(todayDay);
  // Whole-month progress: every habit × every day of the month is one slot;
  // the percentage is slots done so far. Day 5 with everything done ≈ 16%,
  // not 100% — the month itself is the target.
  const monthSlots = habits.length * totalDays;
  const monthDone = logs.length;
  const monthProgress = monthSlots > 0 ? monthDone / monthSlots : null;

  async function addHabit() {
    const title = newTitle.trim();
    if (!title) {
      // silent returns made "nothing happened" bug reports — say something
      setLoadError('Type the habit first (e.g. "Morning run"), then hit Add.');
      setTimeout(() => setLoadError(""), 4000);
      return;
    }
    try {
      await createHabit({ id: crypto.randomUUID(), title, createdDate: today });
      setNewTitle("");
      await refresh();
    } catch (e) {
      setLoadError(String(e));
    }
  }

  async function toggle(habit: Habit) {
    const done = !doneSet.has(`${habit.id}|${today}`);
    // optimistic: flip locally so the checkbox + stats respond instantly
    setLogs((prev) =>
      done
        ? [...prev, { habitId: habit.id, date: today }]
        : prev.filter((l) => !(l.habitId === habit.id && l.date === today)),
    );
    try {
      await setHabitDone(habit.id, today, done);
    } catch (e) {
      setLoadError(String(e));
      await refresh();
    }
  }

  async function remove(habit: Habit) {
    if (!confirm(`Delete "${habit.title}" and its whole history?`)) return;
    try {
      await deleteHabit(habit.id);
      await refresh();
    } catch (e) {
      setLoadError(String(e));
    }
  }

  return (
    <>
      {loadError && (
        <div className="banner error">
          Something went wrong ({loadError}). Run the desktop app with{" "}
          <code>npm run tauri dev</code>.
        </div>
      )}

      <div className="stat-row">
        <div className="stat-tile">
          <Ring
            pct={todayFraction === null ? 0 : todayFraction * 100}
            size={130}
            stroke={11}
            tone={todayFraction === 1 ? "ok" : "accent"}
          >
            <span className="ring-value">
              {todayFraction === null ? "—" : fmtPct(todayFraction * 100)}
            </span>
          </Ring>
          <div className="stat-text">
            <div className="stat-label">Today</div>
            <div className="stat-sub muted">
              {habits.length === 0
                ? "no habits yet"
                : `${logs.filter((l) => l.date === today).length} of ${
                    habits.length
                  } done`}
            </div>
          </div>
        </div>
        <div className="stat-tile">
          <Ring
            pct={monthProgress === null ? 0 : monthProgress * 100}
            size={130}
            stroke={11}
            tone={monthProgress === 1 ? "ok" : "accent"}
          >
            <span className="ring-value">
              {monthProgress === null ? "—" : fmtPct(monthProgress * 100)}
            </span>
          </Ring>
          <div className="stat-text">
            <div className="stat-label">{monthLabel}</div>
            <div className="stat-sub muted">
              {monthDone} of {monthSlots} check-ins this month
            </div>
          </div>
        </div>
      </div>

      <section className="card">
        <h3>
          🔁 Today's habits{" "}
          <span className="muted">tick them off — the streak builds itself</span>
        </h3>
        <div className="habit-add">
          <input
            value={newTitle}
            placeholder="e.g. Morning run"
            onChange={(e) => setNewTitle(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void addHabit()}
          />
          <button className="primary" onClick={() => void addHabit()}>
            ＋ Add habit
          </button>
        </div>
        {habits.length === 0 ? (
          <p className="muted">
            No habits yet. Add one above — small daily wins beat big plans.
          </p>
        ) : (
          <ul className="habit-list">
            {habits.map((h) => {
              const done = doneSet.has(`${h.id}|${today}`);
              const monthCount = logs.filter((l) => l.habitId === h.id).length;
              return (
                <li key={h.id} className={`habit-row ${done ? "done" : ""}`}>
                  <label className="habit-check-label">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => void toggle(h)}
                    />
                    <span className="habit-check" aria-hidden="true">
                      {done ? "✓" : ""}
                    </span>
                    <span className="habit-title">{h.title}</span>
                  </label>
                  <span className="habit-month muted">
                    {monthCount} day{monthCount === 1 ? "" : "s"} this month
                  </span>
                  <button
                    className="icon-btn danger"
                    title="Delete habit"
                    onClick={() => void remove(h)}
                  >
                    🗑
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>
          📈 {monthLabel}{" "}
          <span className="muted">daily completion, all habits</span>
        </h3>
        {habits.length === 0 ? (
          <p className="muted">The graph appears once you have a habit.</p>
        ) : (
          <MonthChart
            totalDays={totalDays}
            todayDay={todayDay}
            dayFraction={dayFraction}
          />
        )}
      </section>
    </>
  );
}

// Single-series column chart: one column per day, height = completion %.
// Specs per the app's chart rules: thin columns with a rounded data-end and a
// square baseline, hairline gridlines, muted text, tooltip on hover.
function MonthChart({
  totalDays,
  todayDay,
  dayFraction,
}: {
  totalDays: number;
  todayDay: number;
  dayFraction: (day: number) => number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 640;
  const H = 170;
  const top = 12;
  const bottom = 22; // room for day labels
  const left = 34; // room for y ticks
  const right = 8;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const slot = plotW / totalDays;
  const barW = Math.min(16, Math.max(4, slot - 2)); // 2px surface gap between bars
  const r = Math.min(4, barW / 2); // rounded data-end

  const y = (frac: number) => top + plotH * (1 - frac);

  // rounded top corners, square baseline
  const barPath = (cx: number, frac: number) => {
    const x0 = cx - barW / 2;
    const h = plotH * frac;
    if (h <= r) {
      return `M ${x0} ${top + plotH} v ${-h} h ${barW} v ${h} Z`;
    }
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

  const days = Array.from({ length: totalDays }, (_, i) => i + 1);
  const hoverFrac = hover !== null ? dayFraction(hover) : null;

  return (
    <div className="month-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Daily habit completion percentage for the month"
      >
        {/* hairline gridlines at 0 / 50 / 100 */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={left}
              x2={W - right}
              y1={y(f)}
              y2={y(f)}
              className="grid-line"
            />
            <text x={left - 6} y={y(f) + 3.5} className="tick" textAnchor="end">
              {f * 100}
              {f === 1 ? "%" : ""}
            </text>
          </g>
        ))}

        {days.map((d) => {
          const frac = dayFraction(d);
          const cx = left + slot * (d - 0.5);
          const isFuture = d > todayDay;
          return (
            <g key={d}>
              {frac !== null && !isFuture && frac > 0 && (
                <path
                  d={barPath(cx, frac)}
                  className={`bar ${hover === d ? "hot" : ""}`}
                />
              )}
              {frac === 0 && !isFuture && (
                <line
                  x1={cx - barW / 2}
                  x2={cx + barW / 2}
                  y1={y(0)}
                  y2={y(0)}
                  className="bar-zero"
                />
              )}
              {/* hit target wider than the mark */}
              <rect
                x={left + slot * (d - 1)}
                y={top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(d)}
                onMouseLeave={() => setHover(null)}
              />
              {(d === 1 || d % 5 === 0) && (
                <text x={cx} y={H - 6} className="tick" textAnchor="middle">
                  {d}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="chart-tip"
          style={{ left: `${((left + slot * (hover - 0.5)) / W) * 100}%` }}
        >
          {hover > todayDay || hoverFrac === null
            ? `Day ${hover} — upcoming`
            : `Day ${hover} — ${fmtPct(hoverFrac * 100)}`}
        </div>
      )}
    </div>
  );
}
