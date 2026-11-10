import { Lock, Play, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BotBehavior, BotTuning, Difficulty, PracticeConfig, PracticeMode, Side, WeaponId } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Badge, Button, Card, Field, PageHeader, Segmented, Slider, Toggle, cx } from '../components/ui';
import { MapPreview, mapDataFor } from '../components/MapPreview';
import { MAP_SUMMARIES, getMapDefinition } from '../game/maps/registry';
import { DIFFICULTY_PRESETS } from '../settings/defaults';
import { BEHAVIOR_INFO, DIFFICULTY_LABEL, MODE_INFO, fmtDuration } from '../utils/labels';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS, WEAPONS } from '../game/weapons/weaponConfigs';
import { spotUsableFrom } from '../game/practice/PracticeDirector';

export function usableSpotIds(cfg: PracticeConfig): Set<string> {
  const def = getMapDefinition(cfg.mapId);
  const data = mapDataFor(cfg.mapId);
  const loc = def.locations.find((l) => l.id === cfg.locationId) ?? def.locations[0];
  const setup = loc.sides[cfg.side];
  const sp = setup.playerSpawns.find((s) => s.id === cfg.playerSpawnId) ?? setup.playerSpawns[0];
  const out = new Set<string>();
  for (const s of setup.enemySpots) if (spotUsableFrom(data.world, sp, s)) out.add(s.id);
  return out;
}

/** Normalise a config so spawn/spots always belong to the selected map/location/side. */
export function normaliseConfig(cfg: PracticeConfig): PracticeConfig {
  const def = getMapDefinition(cfg.mapId);
  const loc = def.locations.find((l) => l.id === cfg.locationId) ?? def.locations[0];
  const setup = loc.sides[cfg.side];
  const spawn = setup.playerSpawns.find((s) => s.id === cfg.playerSpawnId) ?? setup.playerSpawns[0];
  const spotIds = cfg.enemySpotIds.filter((id) => setup.enemySpots.some((s) => s.id === id));
  return { ...cfg, mapId: def.id, locationId: loc.id, playerSpawnId: spawn.id, enemySpotIds: spotIds };
}

const DURATIONS = [60, 120, 180, 300, 0];

export function PracticePage() {
  const raw = useAppStore((s) => s.practice);
  const cfg = useMemo(() => normaliseConfig(raw), [raw]);
  const [advanced, setAdvanced] = useState(cfg.difficulty === 'custom');
  const def = getMapDefinition(cfg.mapId);
  const loc = def.locations.find((l) => l.id === cfg.locationId)!;
  const setup = loc.sides[cfg.side];
  const usable = useMemo(() => usableSpotIds(cfg), [cfg]);
  const selectedSpots = cfg.enemySpotIds.length ? cfg.enemySpotIds : setup.enemySpots.map((s) => s.id);
  const activeSpots = selectedSpots.filter((id) => usable.has(id));
  const maxBots = cfg.mode === 'deathmatch' ? 10 : Math.max(1, activeSpots.length);

  const update = (patch: Partial<PracticeConfig>) => store.updatePractice(normaliseConfig({ ...cfg, ...patch }));

  const toggleSpot = (id: string) => {
    if (!usable.has(id)) return;
    const current = new Set(selectedSpots);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    if (current.size === 0) return;
    const ids = setup.enemySpots.map((s) => s.id).filter((x) => current.has(x));
    update({ enemySpotIds: ids.length === setup.enemySpots.length ? [] : ids });
  };

  const setDifficulty = (d: Difficulty) => {
    if (d === 'custom') {
      update({ difficulty: 'custom' });
      setAdvanced(true);
    } else update({ difficulty: d, tuning: DIFFICULTY_PRESETS[d] });
  };
  const tune = (patch: Partial<BotTuning>) => update({ difficulty: 'custom', tuning: { ...cfg.tuning, ...patch } });

  const start = () => {
    const botCount = Math.min(cfg.botCount, maxBots);
    store.play({ ...cfg, botCount });
  };

  return (
    <div>
      <PageHeader kicker="Practice setup" title="Configure your drill">
        <Button size="lg" onClick={start}>
          <Play size={20} /> Start practice
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
        <div className="space-y-5">
          <Card title="1 · Map">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {MAP_SUMMARIES.map((m) => (
                <button
                  key={m.id}
                  disabled={!m.playable}
                  onClick={() => update({ mapId: m.id })}
                  className={cx(
                    'border p-3 text-left transition-colors',
                    m.id === cfg.mapId ? 'border-accent bg-accent/10' : 'border-line bg-bg/50 hover:border-mute',
                    !m.playable && 'cursor-not-allowed opacity-45 hover:border-line',
                  )}
                >
                  <div className="font-display text-lg font-bold uppercase leading-tight">{m.playable ? m.name : m.inspiredBy}</div>
                  <div className="text-xs text-mute">{m.playable ? `${m.inspiredBy}-inspired` : 'Not built yet'}</div>
                  {!m.playable && <Lock size={12} className="mt-1 text-dim" />}
                </button>
              ))}
            </div>
          </Card>

          <Card title="2 · Location & side">
            <Field label="Location">
              <Segmented
                value={cfg.locationId}
                onChange={(v) => update({ locationId: v, playerSpawnId: '', enemySpotIds: [] })}
                options={def.locations.map((l) => ({ value: l.id, label: l.name }))}
              />
              <p className="mt-2 text-sm text-mute">{loc.description}</p>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Side">
                <Segmented
                  value={cfg.side}
                  onChange={(v: Side) => update({ side: v, playerSpawnId: '', enemySpotIds: [] })}
                  options={[
                    { value: 'attack', label: 'Attacking' },
                    { value: 'defend', label: 'Defending' },
                  ]}
                />
              </Field>
              <Field label="Player spawn">
                <Segmented
                  value={cfg.playerSpawnId}
                  onChange={(v) => update({ playerSpawnId: v, enemySpotIds: [] })}
                  options={setup.playerSpawns.map((s) => ({ value: s.id, label: s.name }))}
                />
              </Field>
            </div>
            <Field label={`Enemy positions (${activeSpots.length} active)`}>
              <div className="flex flex-wrap gap-1.5">
                {setup.enemySpots.map((s) => {
                  const ok = usable.has(s.id);
                  const on = selectedSpots.includes(s.id) && ok;
                  return (
                    <button
                      key={s.id}
                      disabled={!ok}
                      title={ok ? `Toggle ${s.name}` : 'Not peekable from the selected spawn'}
                      onClick={() => toggleSpot(s.id)}
                      className={cx(
                        'border px-3 py-1.5 text-sm transition-colors',
                        on ? 'border-accent/70 bg-accent/15 text-ink' : 'border-line text-mute hover:text-ink',
                        !ok && 'cursor-not-allowed line-through opacity-40',
                      )}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-dim">Click positions here or on the map. Positions that can't see your spawn are disabled.</p>
            </Field>
          </Card>

          <Card title="3 · Mode">
            <div className="grid gap-2 md:grid-cols-3">
              {(Object.keys(MODE_INFO) as PracticeMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => update({ mode: m, botCount: m === 'deathmatch' ? Math.max(cfg.botCount, 4) : Math.min(cfg.botCount, 3) })}
                  className={cx('border p-4 text-left transition-colors', m === cfg.mode ? 'border-accent bg-accent/10' : 'border-line bg-bg/50 hover:border-mute')}
                >
                  <div className="font-display text-lg font-bold uppercase">{MODE_INFO[m].label}</div>
                  <div className="mt-1 text-xs leading-relaxed text-mute">{MODE_INFO[m].desc}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card title="4 · Loadout">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Primary (key 1)">
                <Segmented value={cfg.primary} onChange={(v: WeaponId) => update({ primary: v })} options={PRIMARY_WEAPONS.map((w) => ({ value: w, label: WEAPONS[w].name }))} />
              </Field>
              <Field label="Sidearm (key 2)">
                <Segmented value={cfg.secondary} onChange={(v: WeaponId) => update({ secondary: v })} options={SECONDARY_WEAPONS.map((w) => ({ value: w, label: WEAPONS[w].name }))} />
              </Field>
            </div>
          </Card>

          <Card
            title="5 · Bots"
            right={
              <Button variant="ghost" size="sm" onClick={() => setAdvanced((a) => !a)}>
                <SlidersHorizontal size={14} /> {advanced ? 'Hide tuning' : 'Custom tuning'}
              </Button>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Slider
                label={cfg.mode === 'deathmatch' ? 'Number of bots' : 'Bots peeking at once'}
                value={Math.min(cfg.botCount, maxBots)}
                min={1}
                max={maxBots}
                onChange={(v) => update({ botCount: Math.round(v) })}
              />
              <Field label="Difficulty">
                <Segmented value={cfg.difficulty} onChange={setDifficulty} options={(['easy', 'normal', 'hard', 'radiant', 'custom'] as Difficulty[]).map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))} />
              </Field>
            </div>
            {cfg.mode === 'angle-hold' && (
              <Field label="Bot behaviour">
                <Segmented
                  value={cfg.behavior}
                  onChange={(v: BotBehavior) => update({ behavior: v })}
                  options={(Object.keys(BEHAVIOR_INFO) as BotBehavior[]).map((b) => ({ value: b, label: BEHAVIOR_INFO[b].label, title: BEHAVIOR_INFO[b].desc }))}
                />
                <p className="mt-2 text-sm text-mute">{BEHAVIOR_INFO[cfg.behavior].desc}</p>
              </Field>
            )}
            {cfg.mode === 'jiggle' && <p className="text-sm text-mute">Jiggle training mixes jiggle peeks, shoulder baits and occasional committed peeks/swings.</p>}
            {cfg.mode === 'deathmatch' && <p className="text-sm text-mute">Deathmatch bots navigate the whole map, react to your gunfire and footsteps, and take cover when hurt.</p>}
            {advanced && (
              <div className="mt-3 grid gap-x-6 border-t border-line pt-3 md:grid-cols-2">
                <Slider label="Reaction time (ms)" value={cfg.tuning.reactionMs} min={100} max={1200} step={10} onChange={(v) => tune({ reactionMs: v })} />
                <Slider label="Shooting accuracy" value={cfg.tuning.accuracy} min={0} max={1} step={0.01} onChange={(v) => tune({ accuracy: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Peek frequency" value={cfg.tuning.peekFrequency} min={0} max={1} step={0.01} onChange={(v) => tune({ peekFrequency: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Peek duration (s)" value={cfg.tuning.peekDuration} min={0.2} max={3} step={0.05} onChange={(v) => tune({ peekDuration: v })} />
                <Slider label="Movement speed" value={cfg.tuning.moveSpeed} min={0.5} max={1.2} step={0.01} onChange={(v) => tune({ moveSpeed: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Aggression" value={cfg.tuning.aggression} min={0} max={1} step={0.01} onChange={(v) => tune({ aggression: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Burst length (shots)" value={cfg.tuning.burstLength} min={1} max={12} step={1} onChange={(v) => tune({ burstLength: v })} />
                <Slider label="Crouch frequency" value={cfg.tuning.crouchChance} min={0} max={1} step={0.01} onChange={(v) => tune({ crouchChance: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </div>
            )}
          </Card>

          <Card title="6 · Session">
            <Field label="Duration">
              <Segmented value={cfg.durationSec} onChange={(v: number) => update({ durationSec: v })} options={DURATIONS.map((d) => ({ value: d, label: d === 0 ? 'Unlimited' : fmtDuration(d) }))} />
            </Field>
            <div className="grid gap-x-6 md:grid-cols-2">
              <Toggle
                label="Bots shoot back"
                hint={cfg.mode === 'deathmatch' ? 'Always on in deathmatch' : 'Turn off for pure aim reps'}
                checked={cfg.botsShootBack || cfg.mode === 'deathmatch'}
                onChange={(v) => update({ botsShootBack: v })}
              />
              <Toggle label="Infinite reserve ammo" hint="Magazines still need reloading" checked={cfg.infiniteAmmo} onChange={(v) => update({ infiniteAmmo: v })} />
            </div>
          </Card>
        </div>

        <div className="xl:sticky xl:top-8 xl:self-start">
          <Card title="Top-down preview" right={<Badge tone="accent">{loc.name}</Badge>}>
            <div className="aspect-square w-full border border-line bg-[#0c1218]">
              <MapPreview
                mapId={cfg.mapId}
                locationId={cfg.locationId}
                side={cfg.side}
                spawnId={cfg.playerSpawnId}
                spotIds={activeSpots}
                onToggleSpot={toggleSpot}
                onPickSpawn={(id) => update({ playerSpawnId: id, enemySpotIds: [] })}
                className="h-full w-full"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-info" /> Your spawn & facing
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rotate-45 bg-accent" /> Enemy cover & peek line
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-3 bg-info/30" /> Your field of view
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
              <dt className="text-dim">Mode</dt>
              <dd className="text-right">{MODE_INFO[cfg.mode].label}</dd>
              <dt className="text-dim">Weapon</dt>
              <dd className="text-right">
                {WEAPONS[cfg.primary].name} / {WEAPONS[cfg.secondary].name}
              </dd>
              <dt className="text-dim">Bots</dt>
              <dd className="text-right">
                {Math.min(cfg.botCount, maxBots)} · {DIFFICULTY_LABEL[cfg.difficulty]}
              </dd>
              <dt className="text-dim">Duration</dt>
              <dd className="text-right">{cfg.durationSec ? fmtDuration(cfg.durationSec) : 'Unlimited'}</dd>
            </dl>
            <Button size="lg" className="mt-5 w-full" onClick={start}>
              <Play size={20} /> Start practice
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
