// Person B: form to create a task — "Solve 90 LeetCode problems" style.
// No deadline: a task is just a title + how many items it takes.

import { useEffect, useState } from "react";
import type { Goal } from "../../shared/types";
import { todayISO } from "./api";

interface Props {
  onSave: (goal: Goal) => void;
  onCancel: () => void;
}

const UNIT_SUGGESTIONS = ["problems", "days", "hours", "pages", "reps", "sessions"];

export default function GoalForm({ onSave, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [targetCount, setTargetCount] = useState(90);
  const [unit, setUnit] = useState("problems");
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit() {
    if (!title.trim()) {
      setError("Give the task a name.");
      return;
    }
    if (!Number.isFinite(targetCount) || targetCount <= 0) {
      setError("Target must be greater than 0.");
      return;
    }
    onSave({
      id: crypto.randomUUID(),
      title: title.trim(),
      targetCount: Math.floor(targetCount),
      currentCount: 0,
      unit: unit.trim() || "items",
      startDate: todayISO(), // kept for the data contract; no deadline anymore
      endDate: "",
      itemLabels: [],
      checkedItems: [],
    });
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New task</h2>

        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            value={title}
            placeholder="e.g. Solve 90 LeetCode problems"
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Target</span>
            <input
              type="number"
              min={1}
              value={targetCount}
              onChange={(e) => setTargetCount(Number(e.currentTarget.value))}
            />
          </label>
          <label className="field">
            <span>Unit</span>
            <input
              list="unit-suggestions"
              value={unit}
              onChange={(e) => setUnit(e.currentTarget.value)}
            />
            <datalist id="unit-suggestions">
              {UNIT_SUGGESTIONS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </label>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-footer">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={submit}>
            Add task
          </button>
        </div>
      </div>
    </div>
  );
}
