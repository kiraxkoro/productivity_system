// Person B: the Progress sub-tab — level ring, rank, XP, and the badge
// cabinet. Ticks earn XP elsewhere; this is where it all shows off.

import { useCallback, useEffect, useState } from "react";
import type { Achievement } from "../../shared/types";
import Ring from "./Ring";
import {
  ACHIEVEMENTS,
  getXp,
  levelOf,
  listAchievements,
  rankOf,
  xpIntoLevel,
  xpNeededFor,
} from "./progress";
import "./tracker.css";

export default function ProgressPanel() {
  const [xp, setXp] = useState(0);
  const [unlocked, setUnlocked] = useState<Achievement[]>([]);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [x, a] = await Promise.all([getXp(), listAchievements()]);
      setXp(x);
      setUnlocked(a);
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

      <div className="level-card card">
        <Ring pct={(into / needed) * 100} size={148} stroke={12}>
          <span className="level-label">LEVEL</span>
          <span className="level-number">{level}</span>
          <span className="level-rank">{rank}</span>
        </Ring>
        <div className="level-info">
          <h3>
            {rank} · {xp} XP total{" "}
            <span className="muted">
              · every task or habit ticked = +10, unticked = −10
            </span>
          </h3>
          <p className="muted">
            {into} / {needed} XP this level — {needed - into} more to level{" "}
            {level + 1}. Each level costs 50 XP more than the last; every 10
            levels is a new rank.
          </p>
        </div>
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
                  <span className="badge-emoji">{got ? a.emoji : "🔒"}</span>
                </span>
                <span className="badge-ribbon">{a.title}</span>
                <span className="badge-desc muted">{a.desc}</span>
                {got && <span className="badge-date">earned {got.unlockedAt}</span>}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
