// Person B: daily habits. One checkbox per habit per day (the habit IS the
// description), with today's + this month's completion % and a month graph.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Habit, HabitLog } from "../../shared/types";
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
  toISO,
} from "./api";
import { applyTickXp, checkAchievements, XP_PER_TICK } from "./progress";
import { toast } from "./Toasts";
import "./tracker.css";

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
      // all-time logs: the streak crosses months and Total Completed is
      // lifetime; the calendar/chart just filter down to this month
      const to = `${year}-${pad(month + 1)}-${pad(totalDays)}`;
      const [h, l] = await Promise.all([
        listHabits(),
        listHabitLogs("2000-01-01", to),
      ]);
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

  // --- the three headline boxes ---
  const doneToday = logs.filter((l) => l.date === today).length;
  const totalCompleted = logs.length; // lifetime check-ins

  // Streak: consecutive days where EVERY habit existing that day was done,
  // walking back from today. An incomplete today doesn't break it — the day
  // isn't over yet; it joins the streak once the last habit is ticked.
  const streak = useMemo(() => {
    const doneSet = new Set(logs.map((l) => `${l.habitId}|${l.date}`));
    const fullDay = (date: string) => {
      const existing = habits.filter((h) => h.createdDate <= date);
      return (
        existing.length > 0 &&
        existing.every((h) => doneSet.has(`${h.id}|${date}`))
      );
    };
    let days = 0;
    const d = new Date();
    if (!fullDay(today)) d.setDate(d.getDate() - 1);
    while (fullDay(toISO(d))) {
      days++;
      d.setDate(d.getDate() - 1);
    }
    return days;
  }, [habits, logs, today]);

  async function addHabit() {
    const title = newTitle.trim();
    if (!title) {
      // silent returns made "nothing happened" bug reports — say something
      setLoadError('Type the habit first (e.g. "Morning run"), then hit Add.');
      setTimeout(() => setLoadError(""), 4000);
      return;
    }
    try {
      const habit = { id: crypto.randomUUID(), title, createdDate: today };
      await createHabit(habit);
      setNewTitle("");
      await refresh();
      void checkAchievements({ habits: [...habits, habit] });
    } catch (e) {
      setLoadError(String(e));
    }
  }

  async function toggle(habit: Habit) {
    const done = !doneSet.has(`${habit.id}|${today}`);
    const nextLogs = done
      ? [...logs, { habitId: habit.id, date: today }]
      : logs.filter((l) => !(l.habitId === habit.id && l.date === today));
    // optimistic: flip locally so the checkbox + stats respond instantly
    setLogs(nextLogs);
    try {
      await setHabitDone(habit.id, today, done);
      // done = +10 XP; missed/undone = the 10 comes back off
      toast(done ? "✨" : "↩️", done ? `+${XP_PER_TICK} XP` : `−${XP_PER_TICK} XP`);
      const xp = await applyTickXp(done ? XP_PER_TICK : -XP_PER_TICK);
      await checkAchievements({ habits, logs: nextLogs, today, xp });
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

      <div className="stat-boxes">
        <div className="stat-box purple">
          <div className="stat-box-label">🎯 Today's Focus</div>
          <div className="stat-box-value">
            {doneToday}/{habits.length} Habits
          </div>
          <div className="focus-bar">
            <div
              className="focus-bar-fill"
              style={{
                width: `${habits.length ? (doneToday / habits.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <div className="stat-box purple">
          <div className="stat-box-label">🔥 Current Streak</div>
          <div className="stat-box-value">
            {streak} Day{streak === 1 ? "" : "s"}
          </div>
          <div className="stat-box-sub muted">
            days in a row with every habit done
          </div>
        </div>
        <div className="stat-box green">
          <div className="stat-box-label">✅ Total Completed</div>
          <div className="stat-box-value">{totalCompleted} Habits</div>
          <div className="stat-box-sub muted">lifetime check-ins</div>
        </div>
      </div>

      <div className="habit-cols">
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
              const monthPrefix = `${year}-${pad(month + 1)}`;
              const monthCount = logs.filter(
                (l) => l.habitId === h.id && l.date.startsWith(monthPrefix),
              ).length;
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
          🗓 Monthly completion <span className="muted">{monthLabel}</span>
        </h3>
        <MonthCalendar
          totalDays={totalDays}
          todayDay={todayDay}
          firstWeekday={new Date(year, month, 1).getDay()}
          dayFraction={dayFraction}
        />
        <div className="cal-legend muted">
          <span className="cal-cell full" /> all done
          <span className="cal-cell partial" /> partial
          <span className="cal-cell none" /> missed
        </div>
      </section>
      </div>

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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Month grid: one cell per day, green = every habit done, purple = some,
// dim = missed, hollow = future / before any habit existed.
function MonthCalendar({
  totalDays,
  todayDay,
  firstWeekday,
  dayFraction,
}: {
  totalDays: number;
  todayDay: number;
  firstWeekday: number; // weekday of the 1st (0 = Sunday)
  dayFraction: (day: number) => number | null;
}) {
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  const statusOf = (day: number): string => {
    if (day > todayDay) return "future";
    const f = dayFraction(day);
    if (f === null) return "future"; // before the first habit existed
    if (f >= 1) return "full";
    if (f > 0) return "partial";
    return "none";
  };

  return (
    <div className="cal">
      {WEEKDAYS.map((w) => (
        <div key={w} className="cal-head muted">
          {w}
        </div>
      ))}
      {cells.map((day, i) =>
        day === null ? (
          <div key={`pad-${i}`} />
        ) : (
          <div
            key={day}
            className={`cal-cell ${statusOf(day)} ${day === todayDay ? "today" : ""}`}
            title={`Day ${day}`}
          >
            {day}
          </div>
        ),
      )}
    </div>
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
