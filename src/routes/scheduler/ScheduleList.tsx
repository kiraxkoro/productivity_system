// Person A: the scheduler screen. Built for lazy people with ambition:
// one-click Focus Now, prefilled templates, and a schedule that runs itself
// (the Rust loop opens/closes apps — you just show up).

import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ScheduleBlock } from "../../shared/types";
import BlockForm from "./BlockForm";
import {
  activeBlockOf,
  addMinutes,
  appliesToday,
  closeApp,
  createBlock,
  deleteBlock,
  describeDays,
  emergencyPause,
  fmtTime,
  isActiveNow,
  getAllowedBrowser,
  getAutostart,
  hasCommitmentPassword,
  listBrowsers,
  setAllowedBrowser,
  setAutostart,
  setCommitmentPassword,
  verifyCommitmentPassword,
  humanDuration,
  listBlocks,
  nextBlockToday,
  nextFiveMinutes,
  nowHHMM,
  pad,
  setBlockEnabled,
  toMinutes,
  todayISO,
  updateBlock,
} from "./api";
import {
  BROWSERS,
  distractionBlockers,
  siteBlockers,
  TEMPLATES,
  type Template,
} from "./presets";
import "./scheduler.css";

const FOCUS_DURATIONS = [25, 50, 90];
const KILL_KEY = "focusnow.killDistractions";

export default function ScheduleList() {
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [draft, setDraft] = useState<ScheduleBlock | null>(null);
  const [isNewDraft, setIsNewDraft] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [flash, setFlash] = useState("");
  // Any escape from an ACTIVE block goes through the confession modal:
  // pause, stop, delete, disable, or edit. Inactive blocks are free.
  const [confess, setConfess] = useState<{
    kind: "pause" | "stop" | "delete" | "toggle" | "edit";
    block?: ScheduleBlock;
  } | null>(null);
  const [hasPw, setHasPw] = useState(false);
  const [pwDraft, setPwDraft] = useState("");
  const [killDistractions, setKillDistractions] = useState(
    () => localStorage.getItem(KILL_KEY) !== "0",
  );
  // null = backend doesn't support it (e.g. old build) -> card stays hidden
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [browser, setBrowserState] = useState("chrome.exe");
  // scanned from the machine at startup; static list is the fallback
  const [browserList, setBrowserList] = useState(
    BROWSERS.map((b) => ({ name: b.label, exe: b.process })),
  );
  const [, setTick] = useState(0); // 1s heartbeat so countdowns stay live

  const refresh = useCallback(async () => {
    try {
      setBlocks(await listBlocks());
      setLoadError("");
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    // safety net: one-offs get auto-cleaned in Rust, re-sync once a minute
    const resync = setInterval(() => void refresh(), 60_000);
    let unlisten: UnlistenFn | undefined;
    listen("active-block-changed", () => void refresh())
      .then((fn) => (unlisten = fn))
      .catch(() => {});
    return () => {
      clearInterval(tick);
      clearInterval(resync);
      unlisten?.();
    };
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem(KILL_KEY, killDistractions ? "1" : "0");
  }, [killDistractions]);

  useEffect(() => {
    getAutostart()
      .then(setAutostartState)
      .catch(() => setAutostartState(null));
    getAllowedBrowser().then(setBrowserState).catch(() => {});
    listBrowsers()
      .then((found) => found.length > 0 && setBrowserList(found))
      .catch(() => {});
    hasCommitmentPassword().then(setHasPw).catch(() => {});
  }, []);

  async function savePassword() {
    try {
      await setCommitmentPassword(pwDraft);
      setHasPw(pwDraft.trim().length > 0);
      setPwDraft("");
      setFlash(
        pwDraft.trim()
          ? "🔑 Commitment password set — breaking a running block now needs the phrase AND the password."
          : "Commitment password removed.",
      );
      setTimeout(() => setFlash(""), 6000);
    } catch (e) {
      setLoadError(String(e));
      setTimeout(() => setLoadError(""), 6000);
    }
  }

  async function changeBrowser(exe: string) {
    try {
      await setAllowedBrowser(exe);
      setBrowserState(exe);
    } catch (e) {
      setLoadError(String(e));
    }
  }

  async function toggleAutostart() {
    if (autostart === null) return;
    const next = !autostart;
    try {
      await setAutostart(next);
      setAutostartState(next);
    } catch (e) {
      setLoadError(String(e));
    }
  }


  // derived fresh each render — the 1s tick keeps these current
  const active = activeBlockOf(blocks);
  const next = nextBlockToday(blocks);

  const todayBlocks = blocks
    .filter(appliesToday)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const otherBlocks = blocks
    .filter((b) => !appliesToday(b))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  async function focusNow(minutes: number) {
    const start = nowHHMM();
    const end = addMinutes(start, minutes);
    // No freshBrowser here: quick focus has nothing to reopen, and killing
    // the browser someone is about to work in feels like a bug, not a feature.
    const block: ScheduleBlock = {
      id: crypto.randomUUID(),
      label: `Quick Focus (${minutes} min)`,
      startTime: start,
      endTime: end,
      daysOfWeek: [new Date().getDay()],
      actions: killDistractions
        ? [...distractionBlockers(), ...siteBlockers()]
        : [],
      enabled: true,
      oneOffDate: todayISO(),
    };
    try {
      await createBlock(block);
      // instant gratification: banner lights up and distraction apps die NOW,
      // instead of waiting for the next 15s scheduler tick
      setBlocks((prev) => [...prev, block]);
      for (const a of block.actions) {
        if (a.type === "closeApp") void closeApp(a.target).catch(() => {});
      }
      setFlash(
        `🔒 Locked in — ${minutes} min, ends at ${fmtTime(end)}.` +
          (killDistractions ? " Distracting apps closed, sites blocked." : ""),
      );
      setTimeout(() => setFlash(""), 6000);
      await refresh();
    } catch (e) {
      setLoadError(String(e));
    }
  }

  function openNewForm(template?: Template) {
    const start = nextFiveMinutes();
    setDraft({
      id: crypto.randomUUID(),
      label: template?.label ?? "",
      startTime: start,
      endTime: addMinutes(start, template?.durationMin ?? 60),
      daysOfWeek: [new Date().getDay()],
      actions: template ? template.actions.map((a) => ({ ...a })) : [],
      enabled: true,
      oneOffDate: null,
    });
    setIsNewDraft(true);
  }

  function openEditForm(block: ScheduleBlock) {
    setDraft({ ...block, actions: block.actions.map((a) => ({ ...a })) });
    setIsNewDraft(false);
  }

  /** Calendar entry point: pick a date on the Today card, get a one-off
   *  block editor pre-set to that day (birthday, exam, one-shot plan). */
  function openNewFormOn(date: string) {
    const [y, m, d] = date.split("-").map(Number);
    const start = nextFiveMinutes();
    setDraft({
      id: crypto.randomUUID(),
      label: "",
      startTime: start,
      endTime: addMinutes(start, 60),
      daysOfWeek: [new Date(y, m - 1, d).getDay()],
      actions: [],
      enabled: true,
      oneOffDate: date,
    });
    setIsNewDraft(true);
  }

  async function saveDraft(block: ScheduleBlock) {
    try {
      await (isNewDraft ? createBlock(block) : updateBlock(block));
      setDraft(null);
      await refresh();
    } catch (e) {
      setLoadError(String(e));
    }
  }

  async function toggleEnabled(block: ScheduleBlock) {
    await setBlockEnabled(block.id, !block.enabled).catch((e) =>
      setLoadError(String(e)),
    );
    await refresh();
  }

  async function performConfessed() {
    const c = confess;
    setConfess(null);
    if (!c) return;
    try {
      switch (c.kind) {
        case "pause": {
          const resumeAt = await emergencyPause(5);
          setFlash(
            `😮‍💨 5 minutes of weakness granted. Everything unblocks shortly and locks back down at ${fmtTime(resumeAt)}.`,
          );
          setTimeout(() => setFlash(""), 8000);
          break;
        }
        case "stop": {
          const b = c.block!;
          if (b.oneOffDate) await deleteBlock(b.id);
          else await setBlockEnabled(b.id, false);
          break;
        }
        case "delete":
          await deleteBlock(c.block!.id);
          break;
        case "toggle":
          await setBlockEnabled(c.block!.id, false);
          break;
        case "edit":
          openEditForm(c.block!);
          break;
      }
      await refresh();
    } catch (e) {
      setLoadError(String(e));
    }
  }

  const CONFESS_LABELS: Record<NonNullable<typeof confess>["kind"], string> = {
    pause: "I confess — give me 5 minutes",
    stop: "I confess — end the block",
    delete: "I confess — delete it",
    toggle: "I confess — switch it off",
    edit: "I confess — let me edit it",
  };

  function handleEdit(block: ScheduleBlock) {
    if (isActiveNow(block)) setConfess({ kind: "edit", block });
    else openEditForm(block);
  }

  function handleToggle(block: ScheduleBlock) {
    if (block.enabled && isActiveNow(block)) setConfess({ kind: "toggle", block });
    else void toggleEnabled(block);
  }

  function handleDelete(block: ScheduleBlock) {
    if (isActiveNow(block)) setConfess({ kind: "delete", block });
    else if (confirm(`Delete "${block.label}"?`)) {
      void deleteBlock(block.id)
        .then(refresh)
        .catch((e) => setLoadError(String(e)));
    }
  }

  return (
    <div className="sched">
      {loadError && (
        <div className="banner error">
          Backend not reachable ({loadError}). Run the desktop app with{" "}
          <code>npm run tauri dev</code>.
        </div>
      )}

      {flash && <div className="banner ok">{flash}</div>}

      <NowBanner
        active={active}
        next={next}
        onStop={(b) => setConfess({ kind: "stop", block: b })}
        onEmergency={() => setConfess({ kind: "pause" })}
      />

      {confess && (
        <ConfessionModal
          actionLabel={CONFESS_LABELS[confess.kind]}
          requirePassword={hasPw}
          onConfirm={() => void performConfessed()}
          onCancel={() => setConfess(null)}
        />
      )}

      <div className="sched-grid">
      <aside className="sched-rail">
      <section className="card">
        <h3>
          ⚡ Focus now{" "}
          <span className="muted">zero setup — one click and you're in</span>
        </h3>
        <div className="focus-row">
          {FOCUS_DURATIONS.map((m) => (
            <button key={m} className="chip big" onClick={() => void focusNow(m)}>
              {m} min
            </button>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={killDistractions}
              onChange={(e) => setKillDistractions(e.currentTarget.checked)}
            />
            lockdown — distracting apps closed & kept closed, sites blocked
          </label>
        </div>
      </section>

      <section className="card">
        <h3>
          📦 Templates{" "}
          <span className="muted">prefilled — just hit save</span>
        </h3>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.label} className="tpl" onClick={() => openNewForm(t)}>
              <span className="tpl-emoji">{t.emoji}</span>
              <span className="tpl-label">{t.label}</span>
              <span className="tpl-hint">
                {humanDuration(t.durationMin)} · {t.hint}
              </span>
            </button>
          ))}
          <button className="tpl custom" onClick={() => openNewForm()}>
            <span className="tpl-emoji">＋</span>
            <span className="tpl-label">From scratch</span>
            <span className="tpl-hint">build your own block</span>
          </button>
        </div>
      </section>
      </aside>

      <div className="sched-main">
      <section className="card">
        <h3>
          📅 Today
          <label className="plan-day">
            <span className="muted small">plan another day →</span>
            <input
              type="date"
              min={todayISO()}
              value=""
              title="Pick any date to schedule a one-day block (like a calendar event)"
              onChange={(e) => {
                const date = e.currentTarget.value;
                if (date) openNewFormOn(date);
              }}
            />
          </label>
        </h3>
        {todayBlocks.length === 0 ? (
          <p className="muted">
            Nothing planned today. Hit a template above — future you says thanks.
          </p>
        ) : (
          <ul className="block-list">
            {todayBlocks.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                onEdit={handleEdit}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </section>

      {otherBlocks.length > 0 && (
        <section className="card">
          <h3>🗓 Other days</h3>
          <ul className="block-list">
            {otherBlocks.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                onEdit={handleEdit}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        </section>
      )}

      </div>
      </div>

      {autostart !== null && (
        <section className="card">
          <h3>
            ⚙️ Runs by itself{" "}
            <span className="muted">so day-2 laziness can't win</span>
          </h3>
          <p className="muted small">
            Closing the window doesn't quit Focus OS — it keeps running in the
            system tray (bottom-right of the taskbar) so your schedule always
            fires. Right-click the tray icon to quit completely.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={autostart}
              onChange={() => void toggleAutostart()}
            />
            start automatically with Windows (recommended)
          </label>
          <label className="check pw-row">
            🔑 commitment password {hasPw ? "(set)" : "(not set)"}:
            <input
              type="password"
              value={pwDraft}
              placeholder={hasPw ? "new password (empty = remove)" : "set one"}
              onChange={(e) => setPwDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void savePassword();
              }}
            />
            <button className="chip" onClick={() => void savePassword()}>
              save
            </button>
            <span className="muted small">
              — also required to break a running block; can't be changed
              mid-block
            </span>
          </label>
          <label className="check browser-pick">
            your browser:
            <select
              value={browser}
              onChange={(e) => void changeBrowser(e.currentTarget.value)}
            >
              {(browserList.some((b) => b.exe === browser)
                ? browserList
                : [...browserList, { name: browser, exe: browser }]
              ).map((b) => (
                <option key={b.exe} value={b.exe}>
                  {b.name}
                </option>
              ))}
            </select>
            <span className="muted small">
              — this one survives lockdown blocks (put the extension here and
              enable "Allow in Incognito"); all others get closed & kept closed
            </span>
          </label>
        </section>
      )}

      {draft && (
        <BlockForm
          initial={draft}
          isNew={isNewDraft}
          onSave={(b) => void saveDraft(b)}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  );
}

const WEAKNESS_PHRASE = "I am mentally weak and I choose distraction over my future";

function ConfessionModal({
  actionLabel,
  requirePassword,
  onConfirm,
  onCancel,
}: {
  actionLabel: string;
  requirePassword: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState("");
  const matches =
    text.trim().replace(/\s+/g, " ").toLowerCase() ===
    WEAKNESS_PHRASE.toLowerCase();
  const ready = matches && (!requirePassword || pw.length > 0);

  async function attempt() {
    if (!ready) return;
    if (requirePassword) {
      const ok = await verifyCommitmentPassword(pw).catch(() => false);
      if (!ok) {
        setPwError("Wrong password. The block stays.");
        return;
      }
    }
    onConfirm();
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confession" onClick={(e) => e.stopPropagation()}>
        <h2>🆘 Breaking a running block</h2>
        <p className="muted">
          The block is live. If you really want out, type this — word for word:
        </p>
        <blockquote className="weakness-phrase">{WEAKNESS_PHRASE}</blockquote>
        <input
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder="type it — every word, with your own fingers"
          onChange={(e) => {
            setText(e.currentTarget.value);
            setPwError("");
          }}
          onPaste={(e) => {
            // pasting the confession defeats the entire point
            e.preventDefault();
            setText("");
            setPwError("Nice try. Pasting doesn't count — type it.");
          }}
          onDrop={(e) => {
            e.preventDefault();
            setText("");
            setPwError("Dragging text in doesn't count either — type it.");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void attempt();
          }}
        />
        {requirePassword && (
          <input
            type="password"
            value={pw}
            placeholder="commitment password"
            onChange={(e) => {
              setPw(e.currentTarget.value);
              setPwError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void attempt();
            }}
          />
        )}
        {pwError && <p className="form-error">{pwError}</p>}
        <div className="modal-footer">
          <button type="button" className="primary" onClick={onCancel}>
            Never mind — back to work
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!ready}
            onClick={() => void attempt()}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function NowBanner({
  active,
  next,
  onStop,
  onEmergency,
}: {
  active: ScheduleBlock | null;
  next: ScheduleBlock | null;
  onStop: (b: ScheduleBlock) => void;
  onEmergency: () => void;
}) {
  if (active) {
    const now = new Date();
    const nowSec =
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const startSec = toMinutes(active.startTime) * 60;
    const endSec = toMinutes(active.endTime) * 60;
    const raw = ((nowSec - startSec) / (endSec - startSec)) * 100;
    const pct = Math.min(100, Math.max(0, raw));
    const rem = Math.max(0, endSec - nowSec);
    const timer =
      rem >= 3600
        ? `${Math.floor(rem / 3600)}:${pad(Math.floor((rem % 3600) / 60))}:${pad(rem % 60)}`
        : `${Math.floor(rem / 60)}:${pad(rem % 60)}`;
    return (
      <div className="now-card active">
        <div className="now-main">
          <div className="now-eyebrow">● focus mode</div>
          <h2>{active.label}</h2>
          <div className="now-timer">{timer}</div>
          <div className="now-sub">
            {fmtTime(active.startTime)} – {fmtTime(active.endTime)}
          </div>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="now-buttons">
          <button
            className="ghost"
            title="5-minute emergency pause — you'll have to type the weakness phrase"
            onClick={onEmergency}
          >
            🆘 5 min
          </button>
          <button className="ghost" onClick={() => onStop(active)}>
            {active.oneOffDate ? "Stop" : "Pause"}
          </button>
        </div>
      </div>
    );
  }
  if (next) {
    const minsUntil = toMinutes(next.startTime) - toMinutes(nowHHMM());
    return (
      <div className="now-card idle">
        <span>
          😌 Free time. Next up: <b>{next.label}</b> at {fmtTime(next.startTime)}{" "}
          (in {humanDuration(minsUntil)})
        </span>
      </div>
    );
  }
  return (
    <div className="now-card idle">
      <span>😴 Nothing scheduled. Start a quick focus below 👇</span>
    </div>
  );
}

function BlockRow({
  block,
  onEdit,
  onToggle,
  onDelete,
}: {
  block: ScheduleBlock;
  onEdit: (b: ScheduleBlock) => void;
  onToggle: (b: ScheduleBlock) => void;
  onDelete: (b: ScheduleBlock) => void;
}) {
  const t = nowHHMM();
  const today = appliesToday(block);
  let status = "";
  let statusClass = "";
  if (!block.enabled) {
    status = "paused";
    statusClass = "paused";
  } else if (today && block.startTime <= t && t < block.endTime) {
    status = "now";
    statusClass = "live";
  } else if (today && block.endTime <= t) {
    status = "done ✓";
    statusClass = "done";
  } else if (today && block.startTime > t) {
    status = `in ${humanDuration(toMinutes(block.startTime) - toMinutes(t))}`;
    statusClass = "soon";
  }
  const autoCount = block.actions.length;

  return (
    <li className={`block-row ${block.enabled ? "" : "disabled"}`}>
      <div className="block-time">
        {fmtTime(block.startTime)}
        <span className="muted"> – {fmtTime(block.endTime)}</span>
      </div>
      <div className="block-info">
        <div className="block-label">
          {block.label}
          {status && <span className={`pill ${statusClass}`}>{status}</span>}
        </div>
        <div className="block-meta muted">
          {describeDays(block)}
          {autoCount > 0 &&
            ` · ${autoCount} auto-action${autoCount > 1 ? "s" : ""}`}
        </div>
      </div>
      <div className="block-actions">
        <label className="switch" title={block.enabled ? "Pause" : "Resume"}>
          <input
            type="checkbox"
            checked={block.enabled}
            onChange={() => onToggle(block)}
          />
          <span className="slider" />
        </label>
        <button className="icon-btn" title="Edit" onClick={() => onEdit(block)}>
          ✎
        </button>
        <button
          className="icon-btn danger"
          title="Delete"
          onClick={() => onDelete(block)}
        >
          🗑
        </button>
      </div>
    </li>
  );
}
