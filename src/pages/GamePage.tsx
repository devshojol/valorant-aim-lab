import { LogOut, MousePointer2, Play, RotateCcw, Square, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EngineStatus, HudState, KillFeedEntry, PauseInfo, PracticeConfig, SessionStats, WeaponId } from '../types';
import { GameEngine } from '../game/engine/GameEngine';
import { store, useAppStore } from '../hooks/useAppStore';
import { Hud } from '../components/hud/Hud';
import { SessionReportBody } from '../components/SessionReport';
import { LoadoutMenu } from '../components/LoadoutMenu';
import { Button, Slider } from '../components/ui';
import { MODE_INFO, locationName, mapName } from '../utils/labels';
import { WEAPONS } from '../game/weapons/weaponConfigs';
import { cmPer360 } from '../settings/defaults';
import { exitGameFullscreen } from '../utils/fullscreen';

declare global {
  interface Window {
    __TAL__?: GameEngine;
  }
}

const PAUSE_TEXT: Record<PauseInfo['reason'], string> = {
  user: 'Paused',
  'pointer-lock': 'Paused — mouse released',
  blur: 'Paused — window lost focus',
  hidden: 'Paused — tab hidden',
  'context-lost': 'Paused — graphics context lost',
  start: 'Ready',
  loadout: 'Weapon menu',
};

export function GamePage({ config }: { config: PracticeConfig }) {
  const settings = useAppStore((s) => s.settings);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>('loading');
  const [pause, setPause] = useState<PauseInfo | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [feed, setFeed] = useState<KillFeedEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SessionStats | null>(null);
  const [renderer, setRenderer] = useState('');
  const [startIssue, setStartIssue] = useState<'cooldown' | 'blocked' | null>(null);
  /** Weapons in hand; the weapon menu (B) changes them mid-session. */
  const [loadout, setLoadout] = useState({ primary: config.primary, secondary: config.secondary });

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setReport(null);
    setHud(null);
    setFeed([]);
    setError(null);
    setLoadout({ primary: config.primary, secondary: config.secondary });
    // One engine per mount. It can be disposed while still loading (React StrictMode mounts
    // effects twice in dev, and Quit/Restart can happen mid-load) — dispose() cancels the build.
    const engine = GameEngine.create({ container: hostRef.current!, overlay: overlayRef.current!, config, settings: store.get().settings });
    engineRef.current = engine;
    window.__TAL__ = engine;
    engine.on((ev) => {
      switch (ev.type) {
        case 'status':
          setStatus(ev.status);
          setPause(ev.pause ?? null);
          break;
        case 'hud':
          setHud(ev.hud);
          break;
        case 'killfeed':
          setFeed((f) => [...f.slice(-4), ev.entry]);
          setTimeout(() => setFeed((f) => f.filter((x) => x.id !== ev.entry.id)), 4500);
          break;
        case 'notice':
          setNotice(ev.message);
          break;
        case 'ended':
          if (ev.stats.shots > 0 || ev.stats.durationSec >= 10) store.addSession(ev.stats);
          setReport(ev.stats);
          break;
        case 'error':
          setError(ev.message);
          break;
      }
    });
    engine.ready
      .then(() => {
        if (cancelled) return;
        setRenderer(engine.rendererLabel);
        setStatus(engine.status);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
      if (window.__TAL__ === engine) window.__TAL__ = undefined;
    };
  }, [config]);

  useEffect(() => {
    engineRef.current?.updateSettings(settings);
  }, [settings]);

  // Resuming needs a click: browsers only grant pointer lock inside a user gesture.
  const resume = async (freeMouse = false) => {
    const e = engineRef.current;
    if (!e) return;
    try {
      const ok = await e.start({ freeMouse });
      setStartIssue(ok ? null : e.startIssue ?? 'blocked');
    } catch {
      setStartIssue('blocked');
    }
  };

  const pickWeapon = async (slot: 0 | 1, id: WeaponId) => {
    const e = engineRef.current;
    if (!e) return;
    await e.setWeapon(slot, id);
    if (engineRef.current !== e) return;
    setLoadout(e.loadout);
    // remembered as the default loadout for the next session
    store.updatePractice(slot === 0 ? { primary: id } : { secondary: id });
  };
  const inLoadout = status === 'paused' && pause?.reason === 'loadout' && !report;

  // B closes the weapon menu again (the key press is a user gesture, so the mouse can be re-captured)
  useEffect(() => {
    if (!inLoadout) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === 'KeyB' && !ev.repeat) void resume();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inLoadout]);

  const endSession = () => engineRef.current?.end();
  const quit = () => {
    const e = engineRef.current;
    if (e && e.status !== 'ended' && e.status !== 'loading') e.end();
    exitGameFullscreen();
    store.stopPlaying();
  };
  const restart = () => {
    const e = engineRef.current;
    if (e && e.status !== 'ended' && e.status !== 'loading') e.end();
    store.play({ ...config, ...loadout });
  };

  const sens = settings.sensitivity;

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* the shared 3D canvas is mounted in here by the engine */}
      <div ref={hostRef} className="absolute inset-0" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {hud && status !== 'loading' && !report && <Hud hud={hud} flags={settings.hud} feed={feed} renderer={renderer} />}

      {notice && status === 'running' && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 max-w-xl -translate-x-1/2 border border-warn/40 bg-black/70 px-4 py-2 text-center text-sm text-warn">
          {notice}
        </div>
      )}

      {status === 'loading' && !error && (
        <div className="absolute inset-0 grid place-items-center bg-bg">
          <div className="w-72 text-center">
            <div className="font-display text-xs font-semibold uppercase tracking-[0.35em] text-accent">{MODE_INFO[config.mode].label}</div>
            <div className="mt-1 font-display text-4xl font-bold uppercase leading-none">{mapName(config.mapId)}</div>
            <div className="tal-loadbar mt-5" />
            <div className="mt-3 text-xs uppercase tracking-widest text-dim">Building the map…</div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-bg/95 p-8">
          <div className="max-w-lg border border-accent/40 bg-panel p-6">
            <div className="flex items-center gap-2 font-display text-2xl font-bold uppercase text-accent">
              <TriangleAlert /> Can't start the 3D engine
            </div>
            <p className="mt-3 text-mute">{error}</p>
            <p className="mt-2 text-sm text-dim">Tactical Aim Lab needs WebGL 2 (or WebGL). Make sure hardware acceleration is enabled in your browser settings.</p>
            <Button className="mt-5" onClick={() => store.stopPlaying()}>
              Back to menu
            </Button>
          </div>
        </div>
      )}

      {inLoadout && <LoadoutMenu primary={loadout.primary} secondary={loadout.secondary} onPick={(slot, id) => void pickWeapon(slot, id)} onClose={() => void resume()} issue={startIssue} />}

      {(status === 'ready' || status === 'paused') && !report && !inLoadout && (
        <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[2px]">
          <div className="tal-card w-[min(560px,92vw)] border border-line bg-panel/95 p-7">
            <div className="font-display text-sm font-semibold uppercase tracking-[0.25em] text-accent">
              {status === 'ready' ? 'Ready' : PAUSE_TEXT[pause?.reason ?? 'user']}
            </div>
            <div className="font-display text-3xl font-bold uppercase">
              {MODE_INFO[config.mode].label}
            </div>
            <div className="mt-1 text-sm text-mute">
              {mapName(config.mapId)} · {locationName(config.mapId, config.locationId)} · {config.side === 'attack' ? 'Attacking' : 'Defending'} ·{' '}
              {WEAPONS[loadout.primary].name}
            </div>
            <button
              onClick={() => void resume()}
              className="tal-primary clip-angle mt-6 flex w-full items-center justify-center gap-3 bg-accent py-5 font-display text-2xl font-bold uppercase tracking-widest text-white hover:bg-[#ff5d6a]"
            >
              {status === 'ready' ? <Play size={24} /> : <MousePointer2 size={22} />}
              {status === 'ready' ? 'Click to start' : 'Click to resume'}
            </button>
            {startIssue === 'cooldown' && <p className="mt-2 text-xs text-warn">The browser needs a moment after Esc before it can re-capture the mouse — click again.</p>}
            {startIssue === 'blocked' && (
              <div className="mt-2 text-xs text-warn">
                The browser didn't capture the mouse. Click the button again. If it keeps failing, check that this tab isn't blocking mouse
                lock in the address-bar site settings, or{' '}
                <button className="underline underline-offset-2 hover:text-ink" onClick={() => void resume(true)}>
                  play with the free cursor
                </button>{' '}
                (less precise).
              </div>
            )}

            {status === 'paused' && (
              <div className="mt-5 border-t border-line pt-4">
                <Slider
                  label="Sensitivity"
                  value={sens.sensitivity}
                  min={0.05}
                  max={3}
                  step={0.001}
                  onChange={(v) => store.updateSettings((s) => ({ ...s, sensitivity: { ...s.sensitivity, sensitivity: v } }))}
                  hint={`eDPI ${Math.round(sens.dpi * sens.sensitivity)} · ${cmPer360(sens.dpi, sens.sensitivity).toFixed(1)} cm/360°`}
                />
                <Slider
                  label="Master volume"
                  value={settings.audio.master}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => store.updateSettings((s) => ({ ...s, audio: { ...s.audio, master: v } }))}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </div>
            )}

            <div className="mt-5 grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={restart}>
                <RotateCcw size={14} /> Restart
              </Button>
              <Button variant="outline" size="sm" onClick={endSession} disabled={status === 'ready'}>
                <Square size={14} /> End session
              </Button>
              <Button variant="danger" size="sm" onClick={quit}>
                <LogOut size={14} /> Quit
              </Button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-dim">
              <span>WASD move · Shift walk</span>
              <span>Ctrl / C crouch · Space jump</span>
              <span>LMB fire · RMB aim / burst</span>
              <span>R reload · 1 / 2 or wheel weapons</span>
              <span>B weapon menu</span>
              <span>Esc pause</span>
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="absolute inset-0 overflow-y-auto bg-bg/95 p-8">
          <div className="mx-auto max-w-4xl animate-in">
            <div className="font-display text-sm font-semibold uppercase tracking-[0.25em] text-accent">Session complete</div>
            <div className="mb-4 font-display text-5xl font-bold uppercase">Session report</div>
            <SessionReportBody s={report} />
            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={() => store.play({ ...config, ...loadout })}>
                <RotateCcw size={16} /> Play again
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  store.stopPlaying();
                  store.go('practice');
                }}
              >
                Change setup
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  store.stopPlaying();
                  store.go('statistics');
                }}
              >
                View statistics
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
