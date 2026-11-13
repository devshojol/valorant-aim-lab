import { useState } from 'react';
import type { WeaponId } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Badge, Button, Card, PageHeader, Slider, cx } from '../components/ui';
import { SprayPattern } from '../components/Charts';
import { ALL_WEAPONS, WEAPONS } from '../game/weapons/weaponConfigs';
import { RUN_SPEED } from '../game/player/PlayerController';
import { WeaponIcon } from '../components/WeaponIcon';

/** 0..1 ratings for the comparison bars, relative to the strongest gun in each column. */
function ratings(id: WeaponId) {
  const w = WEAPONS[id];
  const near = w.damage[0];
  const far = w.damage[w.damage.length - 1];
  return [
    ['Damage', Math.min(1, near.body / 150)],
    ['Fire rate', Math.min(1, w.fireRate / 13.33)],
    ['Range', far.body / near.body],
    ['Mobility', Math.max(0, Math.min(1, (w.runSpeedMult - 0.9) / 0.14))],
    ['Magazine', Math.min(1, w.magazine / 30)],
  ] as [string, number][];
}

const ORDER: WeaponId[] = ALL_WEAPONS;

export function WeaponsPage() {
  const practice = useAppStore((s) => s.practice);
  const sessions = useAppStore((s) => s.sessions);
  const [sel, setSel] = useState<WeaponId>(practice.primary);
  const [bullets, setBullets] = useState(WEAPONS[practice.primary].magazine);
  const w = WEAPONS[sel];
  const usage = sessions.reduce(
    (acc, s) => {
      const l = s.perWeapon[sel];
      if (l) {
        acc.shots += l.shots;
        acc.hits += l.hits;
        acc.hs += l.headshots;
        acc.kills += l.kills;
      }
      return acc;
    },
    { shots: 0, hits: 0, hs: 0, kills: 0 },
  );
  const equipped = practice.primary === sel || practice.secondary === sel;

  return (
    <div>
      <PageHeader kicker="Arsenal" title="Weapons" />
      <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        {ORDER.map((id) => {
          const x = WEAPONS[id];
          return (
            <button
              key={id}
              onClick={() => {
                setSel(id);
                setBullets(x.magazine);
              }}
              data-active={id === sel}
              className={cx('tal-tile border p-4 text-left', id === sel ? 'border-accent bg-accent/10' : 'border-line bg-panel hover:border-mute')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs uppercase tracking-widest text-dim">{x.category}</div>
                <WeaponIcon id={id} className="h-7 w-20 shrink-0 opacity-80" color={id === sel ? x.color : '#5b6776'} />
              </div>
              <div className="font-display text-3xl font-bold uppercase leading-tight" style={{ color: x.color }}>
                {x.name}
              </div>
              <div className="text-xs text-mute">
                {x.fireRate} rps · {x.magazine} rounds
              </div>
            </button>
          );
        })}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card title={`${w.name} profile`} right={equipped ? <Badge tone="ok">Equipped</Badge> : undefined}>
          <div className="grid items-center gap-6 md:grid-cols-[1fr_260px]">
            <div>
              <p className="text-sm text-mute">{w.description}</p>
              <div className="mt-4 space-y-2">
                {ratings(sel).map(([label, v]) => (
                  <div key={label} className="flex items-center gap-3 text-xs">
                    <span className="w-20 uppercase tracking-widest text-dim">{label}</span>
                    <div className="h-1.5 flex-1 bg-bg">
                      <div className="h-full transition-[width] duration-300" style={{ width: `${Math.round(v * 100)}%`, background: w.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid place-items-center border border-line bg-bg/50 p-4">
              <WeaponIcon id={sel} className="h-24 w-full" color={w.color} />
            </div>
          </div>
          <div className="mt-5 grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
            {[
              ['Fire rate', `${w.fireRate} rounds/s${w.auto ? ' · full-auto' : ' · semi-auto'}`],
              ['Magazine / reserve', `${w.magazine} / ${w.reserve}`],
              ['Reload', `${w.reloadTime}s`],
              ['Equip', `${w.equipTime}s`],
              ['First-shot spread (hip / ADS)', `${w.spread.base}° / ${w.spread.ads}°`],
              ['Spray spread growth', `+${w.spread.firingPerShot}°/shot (max ${w.spread.firingMax}°)`],
              ['Running inaccuracy', `${w.spread.moveMax}° (accurate below ${(w.spread.accurateSpeedFraction * RUN_SPEED).toFixed(1)} m/s)`],
              ['Airborne inaccuracy', `${w.spread.air}°`],
              ['Right click', w.altFire === 'ads' ? w.ads.scope ? `Scope: click to cycle ${w.ads.zoom}×${w.ads.zoom2 ? ` → ${w.ads.zoom2}×` : ''} → off` : `Aim down sights (${w.ads.zoom}× zoom)` : `${w.burst?.count}-round burst`],
              ['Recoil recovery', `${w.recoil.recoveryRate} bullets/s after ${w.recoil.recoveryDelay}s`],
              ['View kick', `${Math.round(w.recoil.viewKick * 100)}% of bullet recoil`],
              ['Tracers', w.tracer ? 'Visible' : 'Hidden (suppressed)'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line/60 py-1.5">
                <span className="text-dim">{k}</span>
                <span className="text-right tabular">{v}</span>
              </div>
            ))}
          </div>
          <h3 className="mt-6 font-display text-lg font-semibold uppercase tracking-wider">Damage by range</h3>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-dim">
                <th className="py-1.5">Range</th>
                <th>Head</th>
                <th>Body</th>
                <th>Legs</th>
                <th>Body shots to kill (150 HP)</th>
              </tr>
            </thead>
            <tbody>
              {w.damage.map((d, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5">{i === 0 ? '0' : w.damage[i - 1].maxRange}–{d.maxRange > 500 ? '∞' : d.maxRange} m</td>
                  <td className="tabular text-warn">{d.head}</td>
                  <td className="tabular">{d.body}</td>
                  <td className="tabular">{d.legs}</td>
                  <td className="tabular">{Math.ceil(150 / d.body)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6 flex flex-wrap gap-2">
            {w.slot === 'primary' ? (
              <Button variant={practice.primary === sel ? 'outline' : 'primary'} onClick={() => store.updatePractice({ primary: sel })}>
                {practice.primary === sel ? 'Primary weapon' : 'Set as primary'}
              </Button>
            ) : (
              <Button variant={practice.secondary === sel ? 'outline' : 'primary'} onClick={() => store.updatePractice({ secondary: sel })}>
                {practice.secondary === sel ? 'Sidearm' : 'Set as sidearm'}
              </Button>
            )}
          </div>
        </Card>
        <div className="space-y-6">
          <Card title="Spray pattern">
            <div className="flex justify-center bg-bg/60 py-2">
              <SprayPattern pattern={w.recoil.pattern} color={w.color} count={bullets} className="h-80 w-56" />
            </div>
            <Slider label="Bullets shown" value={bullets} min={1} max={w.recoil.pattern.length} onChange={(v) => setBullets(Math.round(v))} />
            <p className="mt-1 text-xs text-dim">
              Where bullets land relative to your crosshair with zero mouse input. Pull down and against the sway to compensate.
            </p>
          </Card>
          <Card title="Your history">
            <div className="grid grid-cols-2 gap-y-1 text-sm">
              <span className="text-dim">Shots</span>
              <span className="text-right tabular">{usage.shots}</span>
              <span className="text-dim">Accuracy</span>
              <span className="text-right tabular">{usage.shots ? Math.round((usage.hits / usage.shots) * 100) : 0}%</span>
              <span className="text-dim">Headshot %</span>
              <span className="text-right tabular">{usage.hits ? Math.round((usage.hs / usage.hits) * 100) : 0}%</span>
              <span className="text-dim">Kills</span>
              <span className="text-right tabular">{usage.kills}</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
