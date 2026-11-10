import type { Vec2 } from '../types';

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
}

/** Minimal responsive SVG line chart (no chart dependency). */
export function LineChart({
  labels,
  series,
  height = 200,
  yMax,
  unit = '',
}: {
  labels: string[];
  series: Series[];
  height?: number;
  yMax?: number;
  unit?: string;
}) {
  const W = 600;
  const H = height;
  const pad = { l: 36, r: 10, t: 12, b: 24 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = yMax ?? Math.max(10, Math.ceil((Math.max(0, ...all) * 1.15) / 10) * 10);
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / n;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  if (labels.length === 0 || all.length === 0) {
    return <div className="flex h-40 items-center justify-center text-sm text-dim">No sessions recorded yet.</div>;
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#222e3c" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t)} fill="#5b6776" fontSize={10} textAnchor="end" dominantBaseline="middle">
              {t}
              {unit}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          labels.length <= 14 || i % Math.ceil(labels.length / 14) === 0 ? (
            <text key={i} x={x(i)} y={H - 6} fill="#5b6776" fontSize={10} textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          return (
            <g key={s.name}>
              <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              {s.values.map((v, i) =>
                v === null ? null : (
                  <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="#0a0f15" stroke={s.color} strokeWidth={2}>
                    <title>{`${s.name}: ${v}${unit} (${labels[i]})`}</title>
                  </circle>
                ),
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-mute">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Plots a recoil pattern as bullet impact points relative to the crosshair. */
export function SprayPattern({ pattern, color, count, className }: { pattern: Vec2[]; color: string; count?: number; className?: string }) {
  const pts = pattern.slice(0, count ?? pattern.length);
  const maxX = Math.max(1.8, ...pts.map((p) => Math.abs(p[0])));
  const maxY = Math.max(1, ...pts.map((p) => p[1]));
  const W = 160;
  const H = 220;
  const sx = (v: number) => W / 2 + (v / (maxX * 1.25)) * (W / 2);
  const sy = (v: number) => H - 20 - (v / (maxY * 1.1)) * (H - 40);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label="Recoil pattern">
      <line x1={W / 2} y1={10} x2={W / 2} y2={H - 10} stroke="#222e3c" />
      <line x1={10} y1={sy(0)} x2={W - 10} y2={sy(0)} stroke="#222e3c" />
      <polyline points={pts.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1.5} />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={sx(p[0])} cy={sy(p[1])} r={3.2} fill={i === 0 ? '#fff' : color} opacity={1 - i / (pts.length * 1.6)} />
          {(i === 0 || (i + 1) % 5 === 0) && (
            <text x={sx(p[0]) + 6} y={sy(p[1])} fill="#8a96a5" fontSize={9} dominantBaseline="middle">
              {i + 1}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
