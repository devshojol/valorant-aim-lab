import { Heart, Shield, Skull } from 'lucide-react';
import type { HudSettings, HudState, KillFeedEntry } from '../../types';
import { cx } from '../ui';
import { WeaponIcon } from '../WeaponIcon';

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1.5 w-40 bg-black/50">
      <div className="h-full transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </div>
  );
}

export function Hud({ hud, flags, feed, renderer }: { hud: HudState; flags: HudSettings; feed: KillFeedEntry[]; renderer: string }) {
  const low = hud.health <= 30;
  return (
    <div className="pointer-events-none absolute inset-0 select-none text-ink" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}>
      {/* top-left: performance */}
      {(flags.showFps || flags.showPerfMetrics) && (
        <div className="absolute top-3 font-mono text-xs leading-5 text-white/80" style={{ left: flags.showMinimap ? 244 : 12 }}>
          {flags.showFps && (
            <div>
              <span className={cx('font-bold', hud.fps >= 55 ? 'text-ok' : hud.fps >= 40 ? 'text-warn' : 'text-accent')}>{hud.fps}</span> FPS
            </div>
          )}
          {flags.showPerfMetrics && (
            <>
              <div>{hud.frameMs.toFixed(1)} ms frame</div>
              <div>{hud.drawCalls} draw calls</div>
              <div>{renderer}</div>
              <div>{hud.speed.toFixed(1)} m/s</div>
            </>
          )}
        </div>
      )}

      {/* top-center: timer + score */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-stretch gap-0.5">
        {flags.showKills && (
          <div className="flex min-w-20 flex-col items-center justify-center bg-black/45 px-4 py-1">
            <div className="font-display text-2xl font-bold leading-none tabular">{hud.kills}</div>
            <div className="text-[10px] uppercase tracking-widest text-white/60">Kills</div>
          </div>
        )}
        {flags.showTimer && (
          <div className="flex min-w-28 flex-col items-center justify-center border-b-2 border-accent bg-black/60 px-5 py-1">
            <div className="font-display text-3xl font-bold leading-none tabular">
              {hud.timeLeft >= 0
                ? `${Math.floor(hud.timeLeft / 60)}:${String(hud.timeLeft % 60).padStart(2, '0')}`
                : `${Math.floor(hud.elapsed / 60)}:${String(hud.elapsed % 60).padStart(2, '0')}`}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-accent">{hud.modeLabel}</div>
          </div>
        )}
        {flags.showKills && (
          <div className="flex min-w-20 flex-col items-center justify-center bg-black/45 px-4 py-1">
            <div className="font-display text-2xl font-bold leading-none tabular">{hud.deaths}</div>
            <div className="text-[10px] uppercase tracking-widest text-white/60">Deaths</div>
          </div>
        )}
      </div>
      <div className="absolute left-1/2 top-[74px] -translate-x-1/2 text-center text-xs text-white/75">
        <span className="tabular">ACC {hud.accuracy}%</span>
        <span className="mx-2 text-white/30">|</span>
        <span className="tabular">HS {hud.headshotPct}%</span>
        <span className="mx-2 text-white/30">|</span>
        <span className="tabular">RT {hud.avgReaction ? `${hud.avgReaction}ms` : '—'}</span>
        <span className="mx-2 text-white/30">|</span>
        <span className="tabular">Score {hud.score}</span>
        {hud.escapes > 0 && (
          <>
            <span className="mx-2 text-white/30">|</span>
            <span className="tabular text-warn">Escaped {hud.escapes}</span>
          </>
        )}
      </div>

      {/* top-right: kill feed */}
      {flags.showKillFeed && (
        <div className="absolute right-3 top-3 flex w-72 flex-col items-end gap-1">
          {feed.map((k) => (
            <div
              key={k.id}
              className={cx('kill-pop flex items-center gap-2 px-3 py-1 text-sm', k.byPlayer ? 'border-r-2 border-ok bg-black/55' : 'border-r-2 border-accent bg-accent/25')}
            >
              <span className="font-semibold">{k.byPlayer ? 'You' : k.weapon.split(' · ')[0]}</span>
              <span className="text-xs text-white/60">{k.byPlayer ? k.weapon : k.weapon.split(' · ')[1]}</span>
              {k.headshot && <Skull size={13} className="text-warn" />}
              <span className={cx('font-semibold', k.byPlayer ? 'text-accent' : 'text-ink')}>{k.victim}</span>
            </div>
          ))}
        </div>
      )}

      {/* bottom-left: health */}
      {flags.showHealth && (
        <div className="absolute bottom-5 left-5 flex items-end gap-4 border-l-2 border-accent bg-gradient-to-r from-black/60 to-black/25 px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <Heart size={16} className={low ? 'text-accent' : 'text-white/80'} />
              <span className={cx('font-display text-4xl font-bold leading-none tabular', low && 'text-accent')}>{hud.health}</span>
            </div>
            <div className="mt-1.5">
              <Bar value={hud.health} max={100} color={low ? '#ff4655' : '#ece8e1'} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Shield size={14} className="text-info" />
              <span className="font-display text-xl font-bold leading-none tabular">{hud.armor}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-14 bg-black/50">
              <div className="h-full bg-info" style={{ width: `${(hud.armor / 50) * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* bottom-right: weapon + ammo */}
      {flags.showAmmo && (
        <div className="absolute bottom-5 right-5 min-w-52 border-r-2 border-accent bg-gradient-to-l from-black/60 to-black/25 px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-3">
            <WeaponIcon id={hud.weaponId} className="h-6 w-[72px] opacity-80" color="#ece8e1" />
            <div className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-white/70">{hud.weaponName}</div>
          </div>
          <div className="flex items-baseline justify-end gap-2">
            <span className={cx('font-display text-5xl font-bold leading-none tabular', hud.ammo === 0 && 'text-accent')}>{hud.ammo}</span>
            <span className="font-display text-xl text-white/55 tabular">/ {hud.reserve < 0 ? '∞' : hud.reserve}</span>
          </div>
          {hud.reloading && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-warn">Reloading</div>
              <div className="h-1 w-full bg-black/50">
                <div className="h-full bg-warn" style={{ width: `${hud.reloadProgress * 100}%` }} />
              </div>
            </div>
          )}
          {hud.ads && <div className="mt-1 text-[10px] uppercase tracking-widest text-info">{hud.scopeZoom ? `Scoped ${hud.scopeZoom}×` : 'ADS'}</div>}
        </div>
      )}

      {hud.dead && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'radial-gradient(ellipse at center, rgba(120,0,10,0.15), rgba(120,0,10,0.55))' }}>
          <div className="text-center">
            <div className="font-display text-5xl font-bold uppercase tracking-widest text-accent">Eliminated</div>
            <div className="mt-1 text-sm text-white/70">Respawning…</div>
          </div>
        </div>
      )}
    </div>
  );
}
