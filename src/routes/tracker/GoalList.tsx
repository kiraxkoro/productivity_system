// Person B: list of goals with live completion percentage. Clicking a goal
// unfolds one checkbox per target item ("Task 1..N" by default); a Word/text
// document upload renames the checkboxes, one label per line.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Goal } from "../../shared/types";
import GoalForm from "./GoalForm";
import { extractLines } from "./extractLines";
import {
  createGoal,
  deleteGoal,
  fmtPct,
  isComplete,
  itemLabel,
  listGoals,
  percentOf,
  updateGoal,
} from "./api";

export default function GoalList() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setGoals(await listGoals());
      setLoadError("");
    } catch (e) {
      setLoadError(String(e));
    }
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

  async function toggleItem(goal: Goal, index: number) {
    const checked = goal.checkedItems.includes(index)
      ? goal.checkedItems.filter((i) => i !== index)
      : [...goal.checkedItems, index];
    // optimistic: flip locally first so the bar moves the instant you click
    setGoals((prev) =>
      prev.map((g) =>
        g.id === goal.id
          ? { ...g, checkedItems: checked, currentCount: checked.length }
          : g,
      ),
    );
    try {
      await updateGoal({ ...goal, checkedItems: checked });
    } catch (e) {
      setLoadError(String(e));
      await refresh();
    }
  }

  async function uploadLabels(goal: Goal, file: File) {
    try {
      const lines = await extractLines(file);
      if (lines.length === 0) {
        setLoadError(`"${file.name}" has no usable lines.`);
        return;
      }
      await updateGoal({ ...goal, itemLabels: lines });
      await refresh();
    } catch (e) {
      setLoadError(String(e));
    }
  }

  async function resetLabels(goal: Goal) {
    try {
      await updateGoal({ ...goal, itemLabels: [] });
      await refresh();
    } catch (e) {
      setLoadError(String(e));
    }
  }

  async function remove(goal: Goal) {
    if (!confirm(`Delete "${goal.title}"?`)) return;
    try {
      await deleteGoal(goal.id);
      await refresh();
    } catch (e) {
      setLoadError(String(e));
    }
  }

  const active = goals.filter((g) => !isComplete(g));
  const done = goals.filter(isComplete);

  return (
    <>
      {loadError && (
        <div className="banner error">
          Something went wrong ({loadError}). Run the desktop app with{" "}
          <code>npm run tauri dev</code>.
        </div>
      )}

      <section className="card">
        <h3>
          🎯 Tasks{" "}
          <span className="muted">
            click a task to tick off its items one by one
          </span>
        </h3>
        <button className="primary" onClick={() => setShowForm(true)}>
          ＋ New task
        </button>
      </section>

      <section className="card">
        <h3>In progress</h3>
        {active.length === 0 ? (
          <p className="muted">
            No active tasks yet. Add one above — "90 problems in 90 days" is a
            good start.
          </p>
        ) : (
          <ul className="goal-list">
            {active.map((g) => (
              <GoalRow
                key={g.id}
                goal={g}
                expanded={expandedId === g.id}
                onExpand={() =>
                  setExpandedId(expandedId === g.id ? null : g.id)
                }
                onToggleItem={toggleItem}
                onUpload={uploadLabels}
                onResetLabels={resetLabels}
                onDelete={remove}
              />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="card">
          <h3>✅ Completed</h3>
          <ul className="goal-list">
            {done.map((g) => (
              <GoalRow
                key={g.id}
                goal={g}
                expanded={expandedId === g.id}
                onExpand={() =>
                  setExpandedId(expandedId === g.id ? null : g.id)
                }
                onToggleItem={toggleItem}
                onUpload={uploadLabels}
                onResetLabels={resetLabels}
                onDelete={remove}
              />
            ))}
          </ul>
        </section>
      )}

      {showForm && (
        <GoalForm
          onSave={(g) => void saveNew(g)}
          onCancel={() => setShowForm(false)}
        />
      )}
    </>
  );
}

function GoalRow({
  goal,
  expanded,
  onExpand,
  onToggleItem,
  onUpload,
  onResetLabels,
  onDelete,
}: {
  goal: Goal;
  expanded: boolean;
  onExpand: () => void;
  onToggleItem: (g: Goal, index: number) => void;
  onUpload: (g: Goal, file: File) => void;
  onResetLabels: (g: Goal) => void;
  onDelete: (g: Goal) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pct = percentOf(goal);
  const complete = isComplete(goal);

  return (
    <li className={`goal-row ${complete ? "complete" : ""}`}>
      <div className="goal-head" onClick={onExpand}>
        <div className="goal-info">
          <div className="goal-label">
            <span className="goal-caret">{expanded ? "▾" : "▸"}</span>
            {goal.title}
            {complete && <span className="pill done">done ✓</span>}
          </div>
          <div className="goal-meta muted">
            {goal.currentCount} / {goal.targetCount} {goal.unit} · {fmtPct(pct)}
          </div>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="goal-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn danger"
            title="Delete"
            onClick={() => onDelete(goal)}
          >
            🗑
          </button>
        </div>
      </div>

      {expanded && (
        <div className="goal-items">
          <div className="goal-items-bar">
            <span className="muted small">
              Tick off each {goal.unit.replace(/s$/, "") || "item"} as you finish
              it.
            </span>
            <span className="goal-items-tools">
              <button
                className="chip"
                title="Upload a Word (.docx) or text file — each line becomes a checkbox label"
                onClick={() => fileRef.current?.click()}
              >
                📄 Upload descriptions
              </button>
              {goal.itemLabels.length > 0 && (
                <button
                  className="chip"
                  title='Back to default "Task 1, Task 2, …" labels'
                  onClick={() => onResetLabels(goal)}
                >
                  ↺ Reset labels
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".docx,.txt,.md,.csv"
                hidden
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) onUpload(goal, f);
                  e.currentTarget.value = "";
                }}
              />
            </span>
          </div>
          <ul className="item-grid">
            {Array.from({ length: goal.targetCount }, (_, i) => (
              <li key={i}>
                <label className="item-check">
                  <input
                    type="checkbox"
                    checked={goal.checkedItems.includes(i)}
                    onChange={() => onToggleItem(goal, i)}
                  />
                  <span className="item-label">{itemLabel(goal, i)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
