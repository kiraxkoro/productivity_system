// Person B: the Progress sub-tab — level ring, XP, and the achievements
// cabinet. Ticks earn XP elsewhere; this is where it all shows off.

import { useCallback, useEffect, useState } from "react";
import type { Achievement } from "../../shared/types";
import Ring from "./Ring";
import {
  ACHIEVEMENTS,
  getXp,
  levelOf,
  listAchievements,
  XP_PER_LEVEL,
  xpIntoLevel,
} from "./progress";

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
        <Ring pct={(into / XP_PER_LEVEL) * 100} size={148} stroke={12}>
          <span className="level-label">LEVEL</span>
          <span className="level-number">{level}</span>
        </Ring>
        <div className="level-info">
          <h3>
            {xp} XP total{" "}
            <span className="muted">
              · every task or habit ticked = +10, unticked = −10
            </span>
          </h3>
          <p className="muted">
            {XP_PER_LEVEL - into} XP to level {level + 1} — that's{" "}
            {Math.ceil((XP_PER_LEVEL - into) / 10)} more wins.
          </p>
        </div>
      </div>

      <section className="card">
        <h3>
          🏆 Achievements{" "}
          <span className="muted">
            {unlocked.length} of {ACHIEVEMENTS.length} unlocked
          </span>
        </h3>
        <ul className="achieve-grid">
          {ACHIEVEMENTS.map((a) => {
            const got = unlockedById.get(a.id);
            return (
              <li
                key={a.id}
                className={`achieve ${got ? "unlocked" : "locked"}`}
                title={got ? `Unlocked ${got.unlockedAt}` : "Locked"}
              >
                <span className="achieve-emoji">{got ? a.emoji : "🔒"}</span>
                <span className="achieve-text">
                  <span className="achieve-title">{a.title}</span>
                  <span className="achieve-desc muted">{a.desc}</span>
                  {got && (
                    <span className="achieve-date">unlocked {got.unlockedAt}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
