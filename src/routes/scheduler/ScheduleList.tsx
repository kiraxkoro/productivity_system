// Person A: the scheduler screen. Built for lazy people with ambition:
// one-click Focus Now, prefilled templates, and a schedule that runs itself
// (the Rust loop opens/closes apps — you just show up).

import { useCallback, useEffect, useMemo, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ScheduleBlock } from "../../shared/types";
import BlockForm from "./BlockForm";
import {
  activeBlockOf,
  addMinutes,
  appliesToday,
  createBlock,
  deleteBlock,
  describeDays,
  fmtTime,
  getAutostart,
  setAutostart,
  humanDuration,
  listBlocks,
  nextBlockToday,
  nextFiveMinutes,
  nowHHMM,
  setBlockEnabled,
  toMinutes,
  todayISO,
  updateBlock,
} from "./api";
import { distractionBlockers, TEMPLATES, type Template } from "./presets";
import "./scheduler.css";

const FOCUS_DURATIONS = [25, 50, 90];
const KILL_KEY = "focusnow.killDistractions";

export default function ScheduleList() {
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [draft, setDraft] = useState<ScheduleBlock | null>(null);
  const [isNewDraft, setIsNewDraft] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [killDistractions, setKillDistractions] = useState(
    () => localStorage.getItem(KILL_KEY) !== "0",
  );
  // null = backend doesn't support it (e.g. old build) -> card stays hidden
  const [autostart, setAutostartState] = useState<boolean | null>(null);
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
  }, []);

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

  const active = useMemo(() => activeBlockOf(blocks), [blocks, nowHHMM()]);
  const next = useMemo(() => nextBlockToday(blocks), [blocks, nowHHMM()]);

  const todayBlocks = blocks
    .filter(appliesToday)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const otherBlocks = blocks
    .filter((b) => !appliesToday(b))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  async function focusNow(minutes: number) {
    const start = nowHHMM();
    const block: ScheduleBlock = {
      id: crypto.randomUUID(),
      label: `Quick Focus (${minutes} min)`,
      startTime: start,
      endTime: addMinutes(start, minutes),
      daysOfWeek: [new Date().getDay()],
      actions: killDistractions ? distractionBlockers() : [],
      enabled: true,
      oneOffDate: todayISO(),
    };
    try {
      await createBlock(block);
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

  async function remove(block: ScheduleBlock) {
    if (!confirm(`Delete "${block.label}"?`)) return;
    await deleteBlock(block.id).catch((e) => setLoadError(String(e)));
    await refresh();
  }

  async function stopActive(block: ScheduleBlock) {
    if (block.oneOffDate) {
      await deleteBlock(block.id).catch((e) => setLoadError(String(e)));
    } else if (
      confirm(`Pause "${block.label}"? It won't run again until you re-enable it.`)
    ) {
      await setBlockEnabled(block.id, false).catch((e) =>
        setLoadError(String(e)),
      );
    }
    await refresh();
  }

  return (
    <div className="sched">
      {loadError && (
        <div className="banner error">
          Backend not reachable ({loadError}). Run the desktop app with{" "}
          <code>npm run tauri dev</code>.
        </div>
      )}

      <NowBanner active={active} next={next} onStop={stopActive} />

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
            auto-close distractions (Discord, Steam, Spotify…)
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

      <section className="card">
        <h3>📅 Today</h3>
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
                onEdit={openEditForm}
                onToggle={toggleEnabled}
                onDelete={remove}
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
                onEdit={openEditForm}
                onToggle={toggleEnabled}
                onDelete={remove}
              />
            ))}
          </ul>
        </section>
      )}

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

function NowBanner({
  active,
  next,
  onStop,
}: {
  active: ScheduleBlock | null;
  next: ScheduleBlock | null;
  onStop: (b: ScheduleBlock) => void;
}) {
  if (active) {
    const now = new Date();
    const nowSec =
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const startSec = toMinutes(active.startTime) * 60;
    const endSec = toMinutes(active.endTime) * 60;
    const raw = ((nowSec - startSec) / (endSec - startSec)) * 100;
    const pct = Math.min(100, Math.max(0, raw));
    const minsLeft = Math.max(0, Math.ceil((endSec - nowSec) / 60));
    return (
      <div className="now-card active">
        <div className="now-main">
          <div className="now-eyebrow">● focus mode</div>
          <h2>{active.label}</h2>
          <div className="now-sub">
            {fmtTime(active.startTime)} – {fmtTime(active.endTime)} ·{" "}
            <b>{minsLeft} min left</b>
          </div>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button className="ghost" onClick={() => onStop(active)}>
          {active.oneOffDate ? "Stop" : "Pause"}
        </button>
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
