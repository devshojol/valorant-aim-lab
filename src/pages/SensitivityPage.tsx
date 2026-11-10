import { MousePointer2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SensitivitySettings } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Button, Card, PageHeader, Slider, Stat, Toggle } from '../components/ui';
import { YAW_DEG_PER_COUNT, cmPer360, edpi } from '../settings/defaults';

const GAMES: { name: string; yaw: number }[] = [
  { name: 'Valorant', yaw: 0.07 },
  { name: 'CS2 / Apex', yaw: 0.022 },
  { name: 'Overwatch 2', yaw: 0.0066 },
  { name: 'Fortnite', yaw: 0.5555 },
];

function TurnTest({ s }: { s: SensitivitySettings }) {
  const ref = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(false);
  const [deg, setDeg] = useState(0);
  const counts = useRef(0);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== ref.current) return;
      counts.current += e.movementX;
      setDeg(counts.current * s.sensitivity * YAW_DEG_PER_COUNT * s.horizontalMult);
    };
    const onLock = () => setLocked(document.pointerLockElement === ref.current);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onLock);
    };
  }, [s.sensitivity, s.horizontalMult]);
  return (
    <div>
      <div
        ref={ref}
        onClick={() => {
          counts.current = 0;
          setDeg(0);
          const el = ref.current as HTMLDivElement & { requestPointerLock(o?: unknown): Promise<void> | void };
          try {
            const r = el.requestPointerLock(s.rawInput ? { unadjustedMovement: true } : undefined);
            if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => el.requestPointerLock());
          } catch {
            el.requestPointerLock();
          }
        }}
        className="relative grid h-56 cursor-crosshair place-items-center overflow-hidden border border-line bg-bg"
      >
        <div className="absolute inset-x-0 top-3 text-center text-xs uppercase tracking-widest text-dim">
          {locked ? 'Move your mouse — Esc to release' : 'Click to capture the mouse'}
        </div>
        <svg viewBox="-100 -100 200 200" className="h-40 w-40">
          <circle r="90" fill="none" stroke="#222e3c" strokeWidth="2" />
          {[0, 90, 180, 270].map((a) => (
            <text key={a} x={Math.sin((a * Math.PI) / 180) * 74} y={-Math.cos((a * Math.PI) / 180) * 74} fill="#5b6776" fontSize="12" textAnchor="middle" dominantBaseline="middle">
              {a}°
            </text>
          ))}
          <g transform={`rotate(${deg})`}>
            <line x1="0" y1="0" x2="0" y2="-80" stroke="#ff4655" strokeWidth="4" />
            <circle r="6" fill="#ff4655" />
          </g>
        </svg>
        <div className="absolute bottom-3 font-display text-2xl font-bold tabular">
          {deg.toFixed(1)}° · {(deg / 360).toFixed(2)} turns
        </div>
      </div>
      <p className="mt-2 text-xs text-dim">
        Uses the exact formula the game camera uses: degrees = mouse counts × sensitivity × {YAW_DEG_PER_COUNT}°. Swipe your usual 360° distance to confirm it matches.
      </p>
    </div>
  );
}

export function SensitivityPage() {
  const s = useAppStore((st) => st.settings.sensitivity);
  const set = (p: Partial<SensitivitySettings>) => store.updateSettings((x) => ({ ...x, sensitivity: { ...x.sensitivity, ...p } }));
  const [src, setSrc] = useState(GAMES[1]);
  const [srcSens, setSrcSens] = useState(1.5);
  const converted = (srcSens * src.yaw) / YAW_DEG_PER_COUNT;

  return (
    <div>
      <PageHeader kicker="Input" title="Sensitivity" />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Card title="Mouse">
            <div className="grid gap-x-6 md:grid-cols-2">
              <Slider label="In-game sensitivity (Valorant scale)" value={s.sensitivity} min={0.01} max={5} step={0.001} onChange={(v) => set({ sensitivity: v })} />
              <Slider label="Mouse DPI" value={s.dpi} min={100} max={6400} step={50} onChange={(v) => set({ dpi: Math.round(v) })} />
              <Slider label="Horizontal multiplier" value={s.horizontalMult} min={0.1} max={3} step={0.01} onChange={(v) => set({ horizontalMult: v })} />
              <Slider label="Vertical multiplier" value={s.verticalMult} min={0.1} max={3} step={0.01} onChange={(v) => set({ verticalMult: v })} />
              <Slider label="ADS sensitivity multiplier" value={s.adsMult} min={0.1} max={3} step={0.01} onChange={(v) => set({ adsMult: v })} hint="Applied while aiming down sights" />
              <Slider label="Scoped sensitivity multiplier" value={s.scopedMult} min={0.1} max={3} step={0.01} onChange={(v) => set({ scopedMult: v })} hint="Reserved for sniper scopes (Operator/Marshal not in the MVP)" />
            </div>
            <div className="grid gap-x-6 md:grid-cols-2">
              <Toggle label="Invert Y axis" checked={s.invertY} onChange={(v) => set({ invertY: v })} />
              <Toggle
                label="Raw input (unadjusted movement)"
                hint="Bypasses OS pointer acceleration where the browser supports it (Chrome/Edge)"
                checked={s.rawInput}
                onChange={(v) => set({ rawInput: v })}
              />
            </div>
          </Card>
          <Card title="Import from another game">
            <p className="mb-3 text-sm text-mute">
              Valorant players: enter your in-game sensitivity directly above — this lab uses the same 0.07°/count scale, so it is 1:1. For other games, convert here:
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs uppercase tracking-widest text-dim">Game</span>
                <select
                  value={src.name}
                  onChange={(e) => setSrc(GAMES.find((g) => g.name === e.target.value) ?? GAMES[0])}
                  className="border border-line bg-bg px-3 py-2 text-ink outline-none"
                >
                  {GAMES.map((g) => (
                    <option key={g.name}>{g.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs uppercase tracking-widest text-dim">Their sensitivity</span>
                <input
                  type="number"
                  step="0.001"
                  value={srcSens}
                  onChange={(e) => setSrcSens(parseFloat(e.target.value) || 0)}
                  className="w-32 border border-line bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
              <div className="pb-2 text-sm">
                = <span className="font-display text-2xl font-bold tabular text-accent">{converted.toFixed(3)}</span> here
              </div>
              <Button size="sm" onClick={() => set({ sensitivity: Math.round(converted * 1000) / 1000 })}>
                Use this
              </Button>
            </div>
          </Card>
          <Card title="Turn test">
            <TurnTest s={s} />
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Summary">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="eDPI" value={Math.round(edpi(s.dpi, s.sensitivity))} sub="DPI × sensitivity" accent />
              <Stat label="cm / 360°" value={cmPer360(s.dpi, s.sensitivity).toFixed(1)} sub={`${(cmPer360(s.dpi, s.sensitivity) / 2.54).toFixed(1)} in`} />
              <Stat label="Deg / count" value={(s.sensitivity * YAW_DEG_PER_COUNT).toFixed(4)} />
              <Stat label="ADS cm / 360°" value={cmPer360(s.dpi, s.sensitivity * s.adsMult).toFixed(1)} />
            </div>
            <div className="mt-4 text-xs leading-relaxed text-dim">
              Typical pro range is roughly 200–400 eDPI (≈ 30–60 cm/360°). Sensitivity is applied to raw Pointer Lock deltas in the 3D camera — not to
              the desktop cursor — and is independent of frame rate.
            </div>
          </Card>
          <Card title="Presets">
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Low (400 DPI)', 400, 0.6],
                ['Typical (800 DPI)', 800, 0.35],
                ['Low (1600 DPI)', 1600, 0.18],
                ['High (800 DPI)', 800, 0.6],
              ].map(([name, dpi, sens]) => (
                <Button key={name as string} variant="outline" size="sm" onClick={() => set({ dpi: dpi as number, sensitivity: sens as number })}>
                  {name as string}
                </Button>
              ))}
            </div>
          </Card>
          <div className="flex items-center gap-2 text-xs text-dim">
            <MousePointer2 size={14} /> Changes apply instantly, including mid-session from the pause menu.
          </div>
        </div>
      </div>
    </div>
  );
}
