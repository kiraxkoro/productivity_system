// Person A: create/edit a schedule block. Lazy-first: the lockdown defaults
// (fresh browser + close apps + block sites) are ON for new blocks — the user
// flips OFF what they don't want instead of having to know what to add.

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { BlockAction, ScheduleBlock } from "../../shared/types";
import {
  addMinutes,
  DAY_LETTERS,
  getAllowedBrowser,
  todayISO,
  toMinutes,
} from "./api";
import {
  BROWSERS,
  DISTRACTIONS,
  DISTRACTION_SITES,
  distractionBlockers,
  freshBrowser,
  OPEN_SUGGESTIONS,
  siteBlockers,
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
  { value: "closeTab", label: "block website" },
] as const;

const DURATION_CHIPS = [30, 60, 90, 120];

const DAY_SHORTCUTS: { label: string; days: number[] }[] = [
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekend", days: [0, 6] },
];

const keyOf = (a: BlockAction) =>
  `${a.trigger}|${a.type}|${a.target.trim().toLowerCase()}`;

/** If every action of `pack` is present, report it and strip one copy of each. */
function extractPack(
  actions: BlockAction[],
  pack: BlockAction[],
): { present: boolean; rest: BlockAction[] } {
  const present = pack.every((p) => actions.some((a) => keyOf(a) === keyOf(p)));
  if (!present) return { present: false, rest: actions };
  const toRemove = new Set(pack.map(keyOf));
  const rest = actions.filter((a) => {
    const k = keyOf(a);
    if (toRemove.has(k)) {
      toRemove.delete(k);
      return false;
    }
    return true;
  });
  return { present: true, rest };
}

/** Fix the classic typos so "youtube,com" can never break a block again. */
function normalizeCustom(a: BlockAction): BlockAction {
  let t = a.target.trim();
  if (a.type === "openTab" || a.type === "closeTab") {
    t = t.replace(/,/g, "."); // commas in web addresses are always dot typos
  }
  if (a.type === "closeTab") {
    // store bare domains: "https://www.YouTube.com/watch" -> "youtube.com"
    t = t
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0];
  }
  if (a.type === "openTab" && t && !/^[a-z][a-z0-9+.-]*:/i.test(t)) {
    t = "https://" + t;
  }
  return { ...a, target: t };
}

export default function BlockForm({ initial, isNew, onSave, onCancel }: Props) {
  const [label, setLabel] = useState(initial.label);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  // null = repeats weekly; "YYYY-MM-DD" = runs once on that date (any date,
  // not just today — birthdays, exams, one-shot plans)
  const [oneOffDate, setOneOffDate] = useState<string | null>(initial.oneOffDate);
  const [days, setDays] = useState<number[]>(initial.daysOfWeek);
  const [error, setError] = useState("");

  // The user's chosen browser (others get locked out during blocks).
  const [allowedBrowser, setAllowedBrowserState] = useState("chrome.exe");
  useEffect(() => {
    getAllowedBrowser().then(setAllowedBrowserState).catch(() => {});
  }, []);

  // Split the incoming actions into the three lockdown packs + custom rows.
  // Brand-new empty blocks get full lockdown ON — that's the whole point.
  // Any closeApp aimed at a browser counts as the fresh-browser flag,
  // regardless of WHICH browser an older block targeted.
  const [initialSplit] = useState(() => {
    const browserProcs = BROWSERS.map((b) => b.process.toLowerCase());
    const isBrowserClose = (a: BlockAction) =>
      a.type === "closeApp" &&
      browserProcs.includes(a.target.trim().toLowerCase());
    const blank = isNew && initial.actions.length === 0;
    const withoutFresh = initial.actions.filter((a) => !isBrowserClose(a));
    const a = extractPack(withoutFresh, distractionBlockers());
    const s = extractPack(a.rest, siteBlockers());
    return {
      fresh: blank || initial.actions.some(isBrowserClose),
      apps: blank || a.present,
      sites: blank || s.present,
      custom: s.rest.map((x) => ({ ...x })),
    };
  });
  const [fresh, setFresh] = useState(initialSplit.fresh);
  const [apps, setApps] = useState(initialSplit.apps);
  const [sites, setSites] = useState(initialSplit.sites);
  const [actions, setActions] = useState<BlockAction[]>(initialSplit.custom);

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

  function toggleDay(d: number) {
    setOneOffDate(null);
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  /** Local-timezone day-of-week for a "YYYY-MM-DD" string. */
  function dayOfDate(iso: string): number {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).getDay();
  }

  function updateAction(index: number, patch: Partial<BlockAction>) {
    setActions((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  }

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

  function submit() {
    if (toMinutes(endTime) <= toMinutes(startTime)) {
      setError("End time must be after start time (blocks can't cross midnight yet).");
      return;
    }
    if (!oneOffDate && days.length === 0) {
      setError('Pick at least one day, or choose "One day only".');
      return;
    }
    if (oneOffDate && oneOffDate < todayISO()) {
      setError("That date is in the past — pick today or later.");
      return;
    }
    const custom = actions.map(normalizeCustom);
    if (custom.some((a) => !a.target)) {
      setError("Every row needs a target (app, URL or domain) — or remove the empty row.");
      return;
    }
    const badWeb = custom.find(
      (a) =>
        (a.type === "openTab" || a.type === "closeTab") && !a.target.includes("."),
    );
    if (badWeb) {
      setError(`"${badWeb.target}" doesn't look like a web address — it needs a dot, e.g. youtube.com`);
      return;
    }
    onSave({
      ...initial,
      label: label.trim() || "Focus block",
      startTime,
      endTime,
      daysOfWeek: oneOffDate
        ? [dayOfDate(oneOffDate)]
        : [...days].sort((a, b) => a - b),
      actions: [
        ...(fresh ? [freshBrowser(allowedBrowser)] : []),
        ...(apps ? distractionBlockers() : []),
        ...(sites ? siteBlockers() : []),
        ...custom,
      ],
      oneOffDate,
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
              className={`chip ${oneOffDate ? "on" : ""}`}
              onClick={() => setOneOffDate(oneOffDate ?? todayISO())}
            >
              📅 One day only
            </button>
            {DAY_SHORTCUTS.map((s) => (
              <button
                key={s.label}
                type="button"
                className="chip"
                onClick={() => {
                  setOneOffDate(null);
                  setDays(s.days);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          {oneOffDate ? (
            <div className="chip-row oneoff-date">
              <input
                type="date"
                value={oneOffDate}
                min={todayISO()}
                onChange={(e) => setOneOffDate(e.currentTarget.value || todayISO())}
              />
              <span className="muted small">
                runs once on this date, then cleans itself up
              </span>
            </div>
          ) : (
            <div className="day-row">
              {DAY_LETTERS.map((letter, d) => (
                <button
                  key={d}
                  type="button"
                  className={`day ${days.includes(d) ? "on" : ""}`}
                  onClick={() => toggleDay(d)}
                >
                  {letter}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <span>
            Lockdown{" "}
            <em className="muted">— on by default, flip off what you don't want</em>
          </span>
          <label className="lockdown-row">
            <span className="lockdown-text">
              <b>🌐 Browser lockdown</b>
              <small>
                {BROWSERS.find((b) => b.process === allowedBrowser)?.label ??
                  "Your browser"}{" "}
                restarts clean (old tabs gone) — every other browser is closed
                and kept closed for the whole block
              </small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={fresh}
                onChange={(e) => setFresh(e.currentTarget.checked)}
              />
              <span className="slider" />
            </span>
          </label>
          <label className="lockdown-row">
            <span className="lockdown-text">
              <b>🚫 Close distracting apps</b>
              <small>
                {DISTRACTIONS.map((d) => d.label).join(", ")} — killed at start
                and re-killed if you reopen them
              </small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={apps}
                onChange={(e) => setApps(e.currentTarget.checked)}
              />
              <span className="slider" />
            </span>
          </label>
          <label className="lockdown-row">
            <span className="lockdown-text">
              <b>🔒 Block distracting sites</b>
              <small>
                {DISTRACTION_SITES.join(", ")} — walled for the whole block
                (needs the browser extension)
              </small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={sites}
                onChange={(e) => setSites(e.currentTarget.checked)}
              />
              <span className="slider" />
            </span>
          </label>
        </div>

        <div className="field">
          <span>
            Also do this{" "}
            <em className="muted">— open your work, block extra sites, anything</em>
          </span>
          {actions.length === 0 && (
            <p className="muted small">
              Nothing custom yet — add your work sites/apps below.
            </p>
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
                  a.type === "openTab"
                    ? "https://… (paste any link)"
                    : a.type === "closeTab"
                      ? "domain, e.g. youtube.com"
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
              ＋ Open website
            </button>
            <button
              type="button"
              className="chip"
              title="Wall off one more site during this block"
              onClick={() =>
                setActions((prev) => [
                  ...prev,
                  { trigger: "onStart", type: "closeTab", target: "" },
                ])
              }
            >
              ＋ Block a site
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
