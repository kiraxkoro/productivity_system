// Person B: circular progress ring — the perimeter fills clockwise from
// 12 o'clock as the percentage rises. Center content is passed as children
// (kept in text tokens; the ring stroke alone carries the color).

import type { ReactNode } from "react";

interface Props {
  pct: number; // 0–100
  size?: number; // outer box in px
  stroke?: number; // ring thickness in px
  tone?: "accent" | "ok"; // ok = completed (green)
  children?: ReactNode;
}

export default function Ring({
  pct,
  size = 96,
  stroke = 8,
  tone = "accent",
  children,
}: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = c * (1 - clamped / 100);
  const mid = size / 2;

  return (
    <div className={`ring ${tone}`} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${clamped.toFixed(0)} percent complete`}
      >
        <circle
          className="ring-track"
          cx={mid}
          cy={mid}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        {clamped > 0 && (
          <circle
            className="ring-fill"
            cx={mid}
            cy={mid}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${mid} ${mid})`}
          />
        )}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
