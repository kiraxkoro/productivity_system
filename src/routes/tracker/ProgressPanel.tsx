// Person B: the Progress sub-tab — level ring, rank, XP, and the badge
// cabinet. Ticks earn XP elsewhere; this is where it all shows off.

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Achievement } from "../../shared/types";
import Ring from "./Ring";
import {
  ACHIEVEMENTS,
  checkAchievements,
  getXp,
  levelOf,
  listAchievements,
  RANKS,
  rankOf,
  xpForLevel,
  xpIntoLevel,
  xpNeededFor,
} from "./progress";
import "./tracker.css";

// one signature color per tier, Iron -> Legend
const RANK_COLORS = [
  "#8d99ae", // Iron
  "#d97706", // Bronze
  "#d1d5db", // Silver
  "#fbbf24", // Gold
  "#67e8f9", // Platinum
  "#818cf8", // Diamond
  "#d946ef", // Master
  "#f43f5e", // Grandmaster
  "#a855f7", // Legend
];

export default function ProgressPanel() {
  const [xp, setXp] = useState(0);
  const [unlocked, setUnlocked] = useState<Achievement[]>([]);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const x = await getXp();
      // xp-based badges (the rank ones) unlock passively — no tick required
      await checkAchievements({ xp: x });
      setXp(x);
      setUnlocked(await listAchievements());
      setLoadError("");
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const level = levelOf(xp);
  const into = xpIntoLevel(xp);
  const needed = xpNeededFor(level);
  const rank = rankOf(level);
  const unlockedById = new Map(unlocked.map((a) => [a.id, a]));

  return (
    <>
      {loadError && (
        <div className="banner error">
          Something went wrong ({loadError}). Run the desktop app with{" "}
          <code>npm run tauri dev</code>.
        </div>
      )}

      <div className="prog-grid">
        <div className="prog-main">
          <div className="level-card card level-hero">
            <Ring pct={(into / needed) * 100} size={210} stroke={14}>
              <span className="level-rank">{rank}</span>
              <span className="level-number">Level {level}</span>
              <span className="level-xp muted">{xp} XP</span>
            </Ring>
            <h3 className="level-headline">
              {rank} · {xp} XP total
            </h3>
            <p className="muted level-sub">
              Every task or habit ticked = +10, unticked = −10
            </p>
            <p className="muted level-sub">
              {into} / {needed} XP this level — {needed - into} more to level{" "}
              {level + 1}. Each level costs 50 XP more than the last; every 10
              levels is a new rank.
            </p>
          </div>

          <section className="card">
            <h3>
              🏆 Badges{" "}
              <span className="muted">
                {unlocked.length} of {ACHIEVEMENTS.length} earned
              </span>
            </h3>
            <ul className="badge-grid">
              {ACHIEVEMENTS.map((a) => {
                const got = unlockedById.get(a.id);
                return (
                  <li
                    key={a.id}
                    className={`badge-item ${got ? "unlocked" : "locked"}`}
                    title={got ? `Unlocked ${got.unlockedAt}` : a.desc}
                  >
                    <span className="badge-medal">
                      <span className="badge-emoji">{a.emoji}</span>
                    </span>
                    <span className="badge-name">{a.title}</span>
                    {got ? (
                      <span className="badge-earned">
                        earned {got.unlockedAt}
                      </span>
                    ) : (
                      <span className="badge-desc muted">{a.desc}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="prog-rail">
          <RankLadder level={level} />
        </aside>
      </div>
    </>
  );
}

// The full rank ladder, Legend on top like a game ranking. Each layer shows
// its level range and the XP it takes to get in; your tier carries a
// 10-segment bar — one segment per level climbed inside the rank.
function RankLadder({ level }: { level: number }) {
  const currentIdx = Math.min(Math.floor((level - 1) / 10), RANKS.length - 1);
  const [open, setOpen] = useState(
    () => localStorage.getItem("rankLadder.open") !== "0",
  );

  function toggle() {
    const next = !open;
    setOpen(next);
    localStorage.setItem("rankLadder.open", next ? "1" : "0");
  }

  return (
    <section className="card">
      <div className="section-head">
        <h3>
          🪜 Rank ladder{" "}
          <span className="muted">every 10 levels is a new rank</span>
        </h3>
        <button className="chip" onClick={toggle}>
          {open ? "▾ Hide" : "▸ Show"}
        </button>
      </div>
      {open && (
      <ul className="rank-ladder">
        {RANKS.map((name, i) => {
          const startLevel = i * 10 + 1;
          const isTop = i === RANKS.length - 1;
          const endLevel = isTop ? null : (i + 1) * 10;
          const state =
            i < currentIdx ? "passed" : i === currentIdx ? "current" : "upcoming";
          const enterXp = xpForLevel(startLevel);
          const climbed = level - startLevel; // levels completed inside this rank
          return (
            <li
              key={name}
              className={`rank-row ${state}`}
              style={{ "--rank-color": RANK_COLORS[i] } as CSSProperties}
            >
              <span className="rank-medal" aria-hidden="true" />
              <span className="rank-text">
                <span className="rank-name">{name}</span>
                <span className="rank-range muted">
                  {endLevel ? `Levels ${startLevel}–${endLevel}` : `Level ${startLevel}+`}
                  {" · "}
                  {i === 0 ? "the starting tier" : `from ${enterXp.toLocaleString()} XP`}
                </span>
              </span>
              {state === "current" && (
                <span className="rank-progress">
                  <span className="rank-you">YOU · LV {level}</span>
                  <span className="rank-segments">
                    {Array.from({ length: 10 }, (_, s) => (
                      <span
                        key={s}
                        className={`rank-seg ${s < climbed ? "on" : ""}`}
                      />
                    ))}
                  </span>
                </span>
              )}
              {state === "passed" && <span className="rank-done">✓</span>}
              {state === "upcoming" && <span className="rank-lock">🔒</span>}
            </li>
          );
        }).reverse()}
      </ul>
      )}
    </section>
  );
}
