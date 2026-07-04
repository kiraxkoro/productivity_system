// Person A: create/edit a schedule block. Designed so the lazy path is always
// one click away: duration chips, day shortcuts, prebuilt action packs.

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { BlockAction, ScheduleBlock } from "../../shared/types";
import { addMinutes, DAY_LETTERS, todayISO, toMinutes } from "./api";
import {
  BROWSERS,
  DISTRACTIONS,
  distractionBlockers,
  freshBrowser,
  OPEN_SUGGESTIONS,
} from "./presets";

interface Props {
  initial: ScheduleBlock;
  isNew: boolean;
  onSave: (block: ScheduleBlock) => void;
  onCancel: () => void;
}

const TRIGGER_OPTIONS = [
  { value: "onStart", label: "when it starts" },
  { value: "onEnd", label: "when it ends" },
] as const;

const TYPE_OPTIONS = [
  { value: "openApp", label: "open app" },
  { value: "openTab", label: "open website" },
  { value: "closeApp", label: "close app" },
  { value: "closeTab", label: "close tab (soon)" },
] as const;

const DURATION_CHIPS = [30, 60, 90, 120];

const DAY_SHORTCUTS: { label: string; days: number[] }[] = [
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekend", days: [0, 6] },
];

export default function BlockForm({ initial, isNew, onSave, onCancel }: Props) {
  const [label, setLabel] = useState(initial.label);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [oneOff, setOneOff] = useState(initial.oneOffDate !== null);
  const [days, setDays] = useState<number[]>(initial.daysOfWeek);
  const [actions, setActions] = useState<BlockAction[]>(initial.actions);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const APP_FILTERS = [
    { name: "Apps & shortcuts", extensions: ["exe", "lnk", "bat", "cmd"] },
    { name: "All files", extensions: ["*"] },
  ];

  /** Lazy path: "+ App…" opens the native picker, the action adds itself. */
  async function pickApp() {
    try {
      const picked = await openDialog({
        title: "Choose an app to open when the block starts",
        filters: APP_FILTERS,
      });
      if (typeof picked === "string") {
        setActions((prev) => [
          ...prev,
          { trigger: "onStart", type: "openApp", target: picked },
        ]);
      }
    } catch {
      // dialog unavailable (running outside the desktop app) — ignore
    }
  }

  async function pickFolder() {
    try {
      const picked = await openDialog({
        directory: true,
        title: "Choose a folder to open when the block starts",
      });
      if (typeof picked === "string") {
        setActions((prev) => [
          ...prev,
          { trigger: "onStart", type: "openApp", target: picked },
        ]);
      }
    } catch {
      // dialog unavailable — ignore
    }
  }

  async function browseRow(index: number) {
    try {
      const picked = await openDialog({
        title: "Choose an app or file",
        filters: APP_FILTERS,
      });
      if (typeof picked === "string") updateAction(index, { target: picked });
    } catch {
      // dialog unavailable — ignore
    }
  }

  function toggleDay(d: number) {
    setOneOff(false);
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  function updateAction(index: number, patch: Partial<BlockAction>) {
    setActions((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  }

  function addDistractionPack() {
    setActions((prev) => {
      const existing = new Set(prev.map((a) => `${a.type}|${a.target}`));
      const missing = distractionBlockers().filter(
        (a) => !existing.has(`${a.type}|${a.target}`),
      );
      return [...prev, ...missing];
    });
  }

  function submit() {
    if (toMinutes(endTime) <= toMinutes(startTime)) {
      setError("End time must be after start time (blocks can't cross midnight yet).");
      return;
    }
    if (!oneOff && days.length === 0) {
      setError('Pick at least one day, or choose "Just today".');
      return;
    }
    if (actions.some((a) => !a.target.trim())) {
      setError("Every action needs a target (app name or URL) — or remove the empty row.");
      return;
    }
    onSave({
      ...initial,
      label: label.trim() || "Focus block",
      startTime,
      endTime,
      daysOfWeek: oneOff
        ? [new Date().getDay()]
        : [...days].sort((a, b) => a - b),
      actions: actions.map((a) => ({ ...a, target: a.target.trim() })),
      oneOffDate: oneOff ? todayISO() : null,
    });
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? "New block" : "Edit block"}</h2>

        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={label}
            placeholder="e.g. LeetCode Grind"
            onChange={(e) => setLabel(e.currentTarget.value)}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>From</span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.currentTarget.value)}
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.currentTarget.value)}
            />
          </label>
          <div className="chip-row">
            {DURATION_CHIPS.map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                title={`Set end time to ${m} minutes after start`}
                onClick={() => setEndTime(addMinutes(startTime, m))}
              >
                {m >= 60 ? `${m / 60}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Repeats</span>
          <div className="chip-row">
            <button
              type="button"
              className={`chip ${oneOff ? "on" : ""}`}
              onClick={() => setOneOff(true)}
            >
              Just today
            </button>
            {DAY_SHORTCUTS.map((s) => (
              <button
                key={s.label}
                type="button"
                className="chip"
                onClick={() => {
                  setOneOff(false);
                  setDays(s.days);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="day-row">
            {DAY_LETTERS.map((letter, d) => (
              <button
                key={d}
                type="button"
                className={`day ${!oneOff && days.includes(d) ? "on" : ""}`}
                onClick={() => toggleDay(d)}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>
            Do automatically{" "}
            <em className="muted">— apps/sites opened or closed for you</em>
          </span>
          {actions.length === 0 && (
            <p className="muted small">No actions yet — this block is just a timer.</p>
          )}
          {actions.map((a, i) => (
            <div className="action-row" key={i}>
              <select
                value={a.trigger}
                onChange={(e) =>
                  updateAction(i, {
                    trigger: e.currentTarget.value as BlockAction["trigger"],
                  })
                }
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={a.type}
                onChange={(e) =>
                  updateAction(i, {
                    type: e.currentTarget.value as BlockAction["type"],
                  })
                }
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                list="target-suggestions"
                value={a.target}
                placeholder={
                  a.type === "openTab" || a.type === "closeTab"
                    ? "https://… (paste any link)"
                    : a.type === "closeApp"
                      ? "process name, e.g. Discord.exe"
                      : "app name, full path, or folder"
                }
                onChange={(e) => updateAction(i, { target: e.currentTarget.value })}
              />
              {a.type === "openApp" ? (
                <button
                  type="button"
                  className="icon-btn"
                  title="Browse for an app or file"
                  onClick={() => void browseRow(i)}
                >
                  📁
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="icon-btn"
                title="Remove action"
                onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="chip-row">
            <button type="button" className="chip" onClick={addDistractionPack}>
              🚫 Kill distractions
            </button>
            <button
              type="button"
              className="chip"
              title="Closes the whole browser at block start; your open-website actions then relaunch it showing only your assigned sites"
              onClick={() =>
                setActions((prev) =>
                  prev.some(
                    (a) => a.type === "closeApp" && a.target === freshBrowser().target,
                  )
                    ? prev
                    : [...prev, freshBrowser()],
                )
              }
            >
              🌐 Fresh browser
            </button>
            <button
              type="button"
              className="chip"
              title="Browse your PC for the app to open (e.g. OBS)"
              onClick={() => void pickApp()}
            >
              ＋ App…
            </button>
            <button
              type="button"
              className="chip"
              title="Pick a folder to open in Explorer"
              onClick={() => void pickFolder()}
            >
              ＋ Folder…
            </button>
            <button
              type="button"
              className="chip"
              onClick={() =>
                setActions((prev) => [
                  ...prev,
                  { trigger: "onStart", type: "openTab", target: "https://" },
                ])
              }
            >
              ＋ Website
            </button>
            <button
              type="button"
              className="chip"
              title="Empty row — type an app name like code or chrome"
              onClick={() =>
                setActions((prev) => [
                  ...prev,
                  { trigger: "onStart", type: "openApp", target: "" },
                ])
              }
            >
              ＋ Custom
            </button>
          </div>
          <datalist id="target-suggestions">
            {OPEN_SUGGESTIONS.map((s) => (
              <option key={s.target} value={s.target}>
                {s.label}
              </option>
            ))}
            {DISTRACTIONS.map((d) => (
              <option key={d.process} value={d.process}>
                {d.label}
              </option>
            ))}
            {BROWSERS.map((b) => (
              <option key={b.process} value={b.process}>
                {b.label}
              </option>
            ))}
          </datalist>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-footer">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={submit}>
            {isNew ? "Add block" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
