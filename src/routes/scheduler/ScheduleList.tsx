// Person A: the scheduler screen. Built for lazy people with ambition:
// one-click Focus Now, prefilled templates, and a schedule that runs itself
// (the Rust loop opens/closes apps — you just show up).

import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ScheduleBlock } from "../../shared/types";
import BlockForm from "./BlockForm";
import Ring from "../tracker/Ring";
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
import { isMobilePlatform } from "../../shared/platform";
import {
  hasNativeBlocker,
  hasOverlayPermission,
  hasUsageAccess,
  listInstalledApps,
  requestOverlayPermission,
  requestUsageAccess,
  type InstalledApp,
} from "../../shared/native";
import { BLOCKS_CHANGED } from "../../shared/useNativeBlockSync";
import {
  getBlockedPackages,
  MOBILE_DISTRACTIONS,
  mobileAppBlockers,
  setBlockedPackages,
} from "./mobileApps";
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
  // last quick-focus duration — the idle timer face shows it (mock: 00:25:00)
  const [lastMinutes, setLastMinutes] = useState(25);
  const settingsRef = useRef<HTMLElement>(null);

  // ---- mobile app blocking (AppBlockerService via window.FocusOSNative;
  //      the start/stop driving lives app-wide in useNativeBlockSync) ----
  const nativeBlocking = isMobilePlatform && hasNativeBlocker();
  const [blockedPkgs, setBlockedPkgs] = useState<string[]>(getBlockedPackages);
  const [perm, setPerm] = useState({ usage: true, overlay: true });

  const refresh = useCallback(async () => {
    try {
      setBlocks(await listBlocks());
      setLoadError("");
      // nudge the app-wide native sync (Android app blocker) right away
      // instead of waiting for its safety-net poll
      window.dispatchEvent(new Event(BLOCKS_CHANGED));
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

  // Permission checks are cheap sync bridge calls; re-check whenever the app
  // regains focus — that's exactly when the user comes back from Settings.
  useEffect(() => {
    if (!nativeBlocking) return;
    const check = () =>
      setPerm({ usage: hasUsageAccess(), overlay: hasOverlayPermission() });
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [nativeBlocking]);

  useEffect(() => {
    if (isMobilePlatform) setBlockedPackages(blockedPkgs);
  }, [blockedPkgs]);

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
      actions: !killDistractions
        ? []
        : isMobilePlatform
          ? mobileAppBlockers(blockedPkgs)
          : [...distractionBlockers(), ...siteBlockers()],
      enabled: true,
      oneOffDate: todayISO(),
    };
    try {
      await createBlock(block);
      // instant gratification: banner lights up and distraction apps die NOW,
      // instead of waiting for the next 15s scheduler tick (on mobile the
      // native-sync effect starts the blocker service the moment the block
      // lands in state)
      setBlocks((prev) => [...prev, block]);
      if (!isMobilePlatform) {
        for (const a of block.actions) {
          if (a.type === "closeApp") void closeApp(a.target).catch(() => {});
        }
      }
      setFlash(
        `🔒 Locked in — ${minutes} min, ends at ${fmtTime(end)}.` +
          (killDistractions
            ? isMobilePlatform
              ? " Distracting apps are walled off."
              : " Distracting apps closed, sites blocked."
            : ""),
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

  /** Template "Start" button: begin the block right now, no form. */
  async function startTemplate(t: Template) {
    const start = nowHHMM();
    const end = addMinutes(start, t.durationMin);
    const block: ScheduleBlock = {
      id: crypto.randomUUID(),
      label: t.label,
      startTime: start,
      endTime: end,
      daysOfWeek: [new Date().getDay()],
      actions: isMobilePlatform ? [] : t.actions.map((a) => ({ ...a })),
      enabled: true,
      oneOffDate: todayISO(),
    };
    try {
      await createBlock(block);
      setBlocks((prev) => [...prev, block]);
      for (const a of block.actions) {
        if (a.type === "closeApp") void closeApp(a.target).catch(() => {});
      }
      setFlash(
        `🔒 ${t.label} started — ${humanDuration(t.durationMin)}, ends at ${fmtTime(end)}.`,
      );
      setTimeout(() => setFlash(""), 6000);
      await refresh();
    } catch (e) {
      setLoadError(String(e));
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

      {confess && (
        <ConfessionModal
          actionLabel={CONFESS_LABELS[confess.kind]}
          requirePassword={hasPw}
          onConfirm={() => void performConfessed()}
          onCancel={() => setConfess(null)}
        />
      )}

      <div className="sched-grid2">
      <div className="sched-col">
      <FocusTimerCard
        active={active}
        next={next}
        idleMinutes={lastMinutes}
        onPick={(m) => {
          setLastMinutes(m);
          void focusNow(m);
        }}
        killDistractions={killDistractions}
        onKillChange={setKillDistractions}
        nativeBlocking={nativeBlocking}
        onStop={(b) => setConfess({ kind: "stop", block: b })}
        onEmergency={() => setConfess({ kind: "pause" })}
        onGear={() =>
          settingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      />

      {nativeBlocking && !(perm.usage && perm.overlay) && (
        <PermissionsCard perm={perm} />
      )}

      {isMobilePlatform && (
        <MobileAppsCard
          nativeAvailable={nativeBlocking}
          selected={blockedPkgs}
          onChange={setBlockedPkgs}
        />
      )}

      {/* Templates open apps & sites — desktop territory. The mobile
          scheduler is blocking-only. */}
      {!isMobilePlatform && (
      <section className="card">
        <h3>
          📦 Templates{" "}
          <span className="muted">start instantly, or click a card to tweak</span>
        </h3>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <div
              key={t.label}
              className="tpl tpl-card"
              role="button"
              tabIndex={0}
              onClick={() => openNewForm(t)}
              onKeyDown={(e) => e.key === "Enter" && openNewForm(t)}
            >
              <span className="tpl-emoji">{t.emoji}</span>
              <span className="tpl-label">{t.label}</span>
              <span className="tpl-hint">
                {humanDuration(t.durationMin)} · {t.hint}
              </span>
              <button
                className="primary tpl-start"
                title={`Start ${t.label} right now for ${humanDuration(t.durationMin)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void startTemplate(t);
                }}
              >
                Start
              </button>
            </div>
          ))}
          <button className="tpl custom" onClick={() => openNewForm()}>
            <span className="tpl-emoji">＋</span>
            <span className="tpl-label">From scratch</span>
            <span className="tpl-hint">build your own block</span>
          </button>
        </div>
      </section>
      )}
      </div>

      <div className="sched-col">
      <section className="card planner">
        <h3>
          🗓 Daily Planner
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
        <p className="planner-date">
          Today,{" "}
          {new Date().toLocaleDateString("en", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
        {todayBlocks.length === 0 ? (
          <p className="muted">
            {isMobilePlatform
              ? "Nothing planned today. Add a lockdown block — future you says thanks."
              : "Nothing planned today. Hit a template — future you says thanks."}
          </p>
        ) : (
          <Timeline
            blocks={todayBlocks}
            onEdit={handleEdit}
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
        )}
        {isMobilePlatform && (
          <>
            <button className="chip" onClick={() => openNewForm()}>
              ＋ Schedule a lockdown block
            </button>
            <p className="muted small">
              Once a session starts, blocking runs on its own — but a scheduled
              block can only arm itself while Focus OS is open.
            </p>
          </>
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

      {autostart !== null && !isMobilePlatform && (
        <section className="card" ref={settingsRef}>
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

/** The Focus Timer hero — everything the old NowBanner + "Focus now" card did,
 *  in one place: live countdown ring, stop/pause (confessed), 5-min emergency
 *  pause, next-up line, one-click quick focus, and the lockdown toggle. */
function FocusTimerCard({
  active,
  next,
  idleMinutes,
  onPick,
  killDistractions,
  onKillChange,
  nativeBlocking,
  onStop,
  onEmergency,
  onGear,
}: {
  active: ScheduleBlock | null;
  next: ScheduleBlock | null;
  idleMinutes: number;
  onPick: (minutes: number) => void;
  killDistractions: boolean;
  onKillChange: (on: boolean) => void;
  nativeBlocking: boolean;
  onStop: (b: ScheduleBlock) => void;
  onEmergency: () => void;
  onGear: () => void;
}) {
  let pct = 100;
  let clock = `${pad(Math.floor(idleMinutes / 60))}:${pad(idleMinutes % 60)}:00`;
  if (active) {
    const now = new Date();
    const nowSec =
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const startSec = toMinutes(active.startTime) * 60;
    const endSec = toMinutes(active.endTime) * 60;
    const rem = Math.max(0, endSec - nowSec);
    pct = Math.min(100, Math.max(0, (rem / (endSec - startSec)) * 100));
    clock = `${pad(Math.floor(rem / 3600))}:${pad(Math.floor((rem % 3600) / 60))}:${pad(rem % 60)}`;
  }

  return (
    <section className="card focus-card">
      <div className="focus-hero">
        <div className="focus-hero-top">
          <h3>⏱ Focus Timer</h3>
          {!isMobilePlatform && (
            <button
              className="hero-gear"
              title="Scheduler settings (autostart, commitment password, browser)"
              onClick={onGear}
            >
              ⚙️
            </button>
          )}
        </div>
        {active && (
          <div className="hero-eyebrow">● focus mode — {active.label}</div>
        )}
        <div className="hero-ring">
          <Ring pct={pct} size={190} stroke={11}>
            <span className="hero-clock">{clock}</span>
            {active && (
              <span className="hero-range">
                {fmtTime(active.startTime)} – {fmtTime(active.endTime)}
              </span>
            )}
          </Ring>
        </div>
        {active && (
          <div className="hero-actions">
            <button
              className="hero-btn"
              title="5-minute emergency pause — you'll have to type the weakness phrase"
              onClick={onEmergency}
            >
              🆘 5 min
            </button>
            <button className="hero-btn" onClick={() => onStop(active)}>
              {active.oneOffDate ? "Stop" : "Pause"}
            </button>
          </div>
        )}
      </div>

      <div className="hero-chips">
        {FOCUS_DURATIONS.map((m) => (
          <button key={m} className="chip big" onClick={() => onPick(m)}>
            {m} min
          </button>
        ))}
      </div>
      {!active && (
        <p className="hero-next muted">
          {next ? (
            <>
              😌 Next up: <b>{next.label}</b> at {fmtTime(next.startTime)} (in{" "}
              {humanDuration(toMinutes(next.startTime) - toMinutes(nowHHMM()))})
            </>
          ) : (
            <>😴 Nothing scheduled — one click above and you're in.</>
          )}
        </p>
      )}

      {isMobilePlatform && !nativeBlocking ? (
        <p className="muted small">
          📱 This build can't block apps yet — blocks run as timers with
          notifications. Update the app (or use the desktop version) for
          Lockdown Mode.
        </p>
      ) : (
        <div className="hero-lockdown">
          <label className="switch" title="Lockdown for quick-focus sessions">
            <input
              type="checkbox"
              checked={killDistractions}
              onChange={(e) => onKillChange(e.currentTarget.checked)}
            />
            <span className="slider" />
          </label>
          <span>
            {isMobilePlatform
              ? "Lockdown Mode — block distracting apps during the session"
              : "Lockdown — distracting apps closed & sites blocked"}
          </span>
        </div>
      )}
    </section>
  );
}

const fmtHour = (h: number) =>
  `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

/** Today's blocks laid out on a real timeline: hour gutter, proportional
 *  purple blocks, gray "Break" fillers in the gaps. Every BlockRow control
 *  survives — click to edit, plus pause/resume, edit, and delete buttons. */
function Timeline({
  blocks,
  onEdit,
  onToggle,
  onDelete,
}: {
  blocks: ScheduleBlock[];
  onEdit: (b: ScheduleBlock) => void;
  onToggle: (b: ScheduleBlock) => void;
  onDelete: (b: ScheduleBlock) => void;
}) {
  const PX = 76; // pixels per hour
  const sorted = [...blocks].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  const startHour = Math.floor(
    Math.min(...sorted.map((b) => toMinutes(b.startTime))) / 60,
  );
  const endHour = Math.ceil(
    Math.max(...sorted.map((b) => toMinutes(b.endTime))) / 60,
  );
  const span = Math.max(endHour - startHour, 1);
  const y = (hhmm: string) => ((toMinutes(hhmm) - startHour * 60) / 60) * PX;

  // gaps ≥ 10 min between consecutive enabled blocks render as "Break"
  const enabled = sorted.filter((b) => b.enabled);
  const breaks: { start: string; end: string }[] = [];
  for (let i = 0; i + 1 < enabled.length; i++) {
    const gapStart = enabled[i].endTime;
    const gapEnd = enabled[i + 1].startTime;
    if (toMinutes(gapEnd) - toMinutes(gapStart) >= 10) {
      breaks.push({ start: gapStart, end: gapEnd });
    }
  }

  const hours = Array.from({ length: span + 1 }, (_, i) => startHour + i);

  return (
    <div className="tl" style={{ height: span * PX + 18 }}>
      {hours.map((h) => (
        <div key={h} className="tl-hour" style={{ top: (h - startHour) * PX }}>
          <span className="tl-hour-label">{fmtHour(h)}</span>
          <span className="tl-hour-line" />
        </div>
      ))}
      {breaks.map((g) => (
        <div
          key={g.start}
          className="tl-break"
          style={{
            top: y(g.start) + 2,
            height: Math.max(y(g.end) - y(g.start) - 4, 20),
          }}
        >
          Break · {fmtTime(g.start)} – {fmtTime(g.end)}
        </div>
      ))}
      {sorted.map((b) => {
        const h = Math.max(y(b.endTime) - y(b.startTime) - 4, 30);
        return (
          <div
            key={b.id}
            className={`tl-block ${b.enabled ? "" : "off"} ${
              isActiveNow(b) ? "live" : ""
            } ${h < 52 ? "slim" : ""}`}
            style={{ top: y(b.startTime) + 2, height: h }}
            title={`${describeDays(b)}${
              b.actions.length
                ? ` · ${b.actions.length} auto-action${b.actions.length > 1 ? "s" : ""}`
                : ""
            } — click to edit`}
            role="button"
            tabIndex={0}
            onClick={() => onEdit(b)}
            onKeyDown={(e) => e.key === "Enter" && onEdit(b)}
          >
            <div className="tl-block-main">
              <span className="tl-block-label">
                {b.label}
                {!b.enabled && <span className="pill paused">paused</span>}
              </span>
              <span className="tl-block-time">
                {fmtTime(b.startTime)} – {fmtTime(b.endTime)}
              </span>
            </div>
            <div
              className="tl-block-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="tl-icon"
                title={b.enabled ? "Pause" : "Resume"}
                onClick={() => onToggle(b)}
              >
                {b.enabled ? "⏸" : "▶"}
              </button>
              <button className="tl-icon" title="Edit" onClick={() => onEdit(b)}>
                ✎
              </button>
              <button
                className="tl-icon"
                title="Delete"
                onClick={() => onDelete(b)}
              >
                🗑
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Mobile one-time setup: the two special permissions Android demands before
 *  an app may watch the foreground app and draw over it. Hidden once granted. */
function PermissionsCard({
  perm,
}: {
  perm: { usage: boolean; overlay: boolean };
}) {
  return (
    <section className="card perm-card">
      <h3>
        🔐 One-time setup{" "}
        <span className="muted">so Lockdown Mode can actually block</span>
      </h3>
      <div className="perm-row">
        <span className="perm-text">
          {perm.usage ? "✅" : "1️⃣"} <b>Usage access</b>
          <small className="muted">
            {" "}
            — lets Focus OS see which app is in front
          </small>
        </span>
        {!perm.usage && (
          <button className="chip" onClick={requestUsageAccess}>
            Grant
          </button>
        )}
      </div>
      <div className="perm-row">
        <span className="perm-text">
          {perm.overlay ? "✅" : "2️⃣"} <b>Display over other apps</b>
          <small className="muted"> — shows the blocking screen</small>
        </span>
        {!perm.overlay && (
          <button className="chip" onClick={requestOverlayPermission}>
            Grant
          </button>
        )}
      </div>
    </section>
  );
}

/** Mobile block list editor: presets first, plus anything installed on the
 *  phone. Selection persists locally and applies to every lockdown session. */
function MobileAppsCard({
  nativeAvailable,
  selected,
  onChange,
}: {
  nativeAvailable: boolean;
  selected: string[];
  onChange: (pkgs: string[]) => void;
}) {
  // null = not asked yet; the installed list only loads on demand
  const [installed, setInstalled] = useState<InstalledApp[] | null>(null);

  const toggle = (pkg: string) =>
    onChange(
      selected.includes(pkg)
        ? selected.filter((p) => p !== pkg)
        : [...selected, pkg],
    );

  const presetPkgs = new Set(MOBILE_DISTRACTIONS.map((d) => d.pkg));
  const extras = (installed ?? [])
    .filter((a) => !presetPkgs.has(a.package))
    .sort((a, b) => a.label.localeCompare(b.label));
  // still render selections we can't resolve to a label (picked on an earlier
  // run) so they can always be unticked
  const unknownSelected = selected.filter(
    (p) => !presetPkgs.has(p) && !extras.some((a) => a.package === p),
  );

  return (
    <section className="card">
      <h3>
        🚫 Apps to block{" "}
        <span className="muted">during lockdown sessions</span>
      </h3>
      <div className="app-pick-list">
        {MOBILE_DISTRACTIONS.map((d) => (
          <label key={d.pkg} className="check">
            <input
              type="checkbox"
              checked={selected.includes(d.pkg)}
              onChange={() => toggle(d.pkg)}
            />
            {d.label}
          </label>
        ))}
        {unknownSelected.map((pkg) => (
          <label key={pkg} className="check">
            <input type="checkbox" checked onChange={() => toggle(pkg)} />
            {pkg}
          </label>
        ))}
        {extras.map((a) => (
          <label key={a.package} className="check">
            <input
              type="checkbox"
              checked={selected.includes(a.package)}
              onChange={() => toggle(a.package)}
            />
            {a.label}
          </label>
        ))}
      </div>
      {nativeAvailable && installed === null && (
        <button className="chip" onClick={() => setInstalled(listInstalledApps())}>
          ＋ Pick from installed apps
        </button>
      )}
      {installed !== null && installed.length === 0 && (
        <p className="muted small">
          Couldn't read the installed app list on this device.
        </p>
      )}
    </section>
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
