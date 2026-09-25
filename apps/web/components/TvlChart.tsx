import { fmtNum } from "@/lib/format";

export interface Series { label: string; points: { ts: number; sol: number }[]; emphasis?: boolean }

/**
 * Inline SVG line chart, no library. Time on x, SOL on y, one path per series; the total is drawn heavier.
 * Colours come from the theme tokens so it reads in both palettes.
 */
export function TvlChart({ series, height = 220 }: { series: Series[]; height?: number }) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <p className="text-sm text-ink-2">The chart starts once the worker has sampled TVL for a few hours.</p>;
  const w = 720;
  const h = height;
  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const t0 = Math.min(...all.map((p) => p.ts));
  const t1 = Math.max(...all.map((p) => p.ts));
  const yMax = Math.max(1, ...all.map((p) => p.sol)) * 1.08;
  const x = (ts: number) => padL + ((ts - t0) / Math.max(1, t1 - t0)) * (w - padL - padR);
  const y = (v: number) => padT + (1 - v / yMax) * (h - padT - padB);
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => (yMax * i) / ticks);
  const days = (t1 - t0) / 86_400;
  const xTicks = Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4);
  const fmtT = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-GB", days > 60 ? { month: "short", year: "2-digit" } : days > 2 ? { day: "numeric", month: "short" } : { hour: "2-digit", minute: "2-digit" });
  const path = (pts: { ts: number; sol: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.sol).toFixed(1)}`).join(" ");
  const palette = ["var(--color-credit)", "var(--color-ink-2)", "#8a6d3b", "#3b6e8a", "#8a3b6e", "#5b8a3b", "#3b3b8a", "#8a5b3b", "#3b8a7d"];
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="SOL staked over time">
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--color-rule-2)" strokeWidth="1" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-2)" className="num">
              {fmtNum(v, 0)}
            </text>
          </g>
        ))}
        {xTicks.map((ts, i) => (
          <text key={i} x={x(ts)} y={h - 8} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fontSize="11" fill="var(--color-ink-2)">
            {fmtT(ts)}
          </text>
        ))}
        {series.map((s, i) =>
          s.points.length > 1 ? (
            <path key={s.label} d={path(s.points)} fill="none" stroke={s.emphasis ? "var(--color-ink)" : palette[i % palette.length]} strokeWidth={s.emphasis ? 2 : 1.25} strokeLinejoin="round" strokeLinecap="round" />
          ) : null,
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {series.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4" style={{ background: s.emphasis ? "var(--color-ink)" : palette[i % palette.length] }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
