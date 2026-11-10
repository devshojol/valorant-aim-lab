import { Check, ChevronRight, Crosshair, Flame, Play, RotateCcw, Target, Trophy } from 'lucide-react';
import type { PracticeConfig, PracticeMode } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Badge, Button, Card, Stat, cx } from '../components/ui';
import { MapPreview } from '../components/MapPreview';
import { LineChart, SprayPattern } from '../components/Charts';
import { WEAPONS } from '../game/weapons/weaponConfigs';
import { getMapDefinition } from '../game/maps/registry';
import { DIFFICULTY_LABEL, MODE_INFO, accuracy, avgMs, dayKey, fmtDate, hsPct, locationName } from '../utils/labels';
import { normaliseConfig } from './PracticePage';

const DAILY: { mode: PracticeMode; title: string; target: string; patch: Partial<PracticeConfig> }[] = [
  { mode: 'angle-hold', title: 'Warm-up: hold A Main', target: '2 min angle hold', patch: { locationId: 'a-main', side: 'defend', behavior: 'mixed', durationSec: 120, botCount: 2 } },
  { mode: 'jiggle', title: "Don't take the bait", target: '2 min jiggle drill', patch: { locationId: 'mid', side: 'attack', durationSec: 120, botCount: 2 } },
  { mode: 'deathmatch', title: 'Live fire', target: '5 min deathmatch', patch: { durationSec: 300, botCount: 5 } },
];

export function HomePage() {
  const practice = useAppStore((s) => s.practice);
  const sessions = useAppStore((s) => s.sessions);
  const last = sessions[0];
  const today = dayKey(Date.now());
  const todays = sessions.filter((s) => dayKey(s.startedAt) === today);
  const recent = sessions.slice(0, 10).reverse();
  const weaponId = last?.primary ?? practice.primary;
  const weapon = WEAPONS[weaponId];
  const def = getMapDefinition(practice.mapId);

  const quick = () => store.play(normaliseConfig(practice));

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden border border-line bg-gradient-to-br from-[#1a0f14] via-panel to-panel p-8">
        <div className="absolute -right-10 -top-10 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_340px]">
          <div>
            <Badge tone="accent">Valorant-inspired · Browser · No install</Badge>
            <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[0.95] md:text-6xl">
              Win the gunfight
              <br />
              <span className="text-accent">before the round.</span>
            </h1>
            <p className="mt-4 max-w-xl text-mute">
              Hold real angles against bots that jiggle, shoulder-peek, wide-swing, counter-strafe and crouch-spray, on eight original maps
              inspired by Ascent, Bind, Haven, Split, Lotus, Icebox, Breeze and Sunset. You use your own sensitivity and crosshair.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={quick}>
                <Play size={20} /> Quick practice
              </Button>
              <Button size="lg" variant="outline" onClick={() => store.go('practice')}>
                <Target size={20} /> Custom setup
              </Button>
            </div>
          </div>
          <div className="border border-line bg-bg/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-sm font-semibold uppercase tracking-widest text-mute">Next drill</span>
              <Badge>{DIFFICULTY_LABEL[practice.difficulty]}</Badge>
            </div>
            <div className="font-display text-2xl font-bold uppercase">{MODE_INFO[practice.mode].label}</div>
            <div className="text-sm text-mute">
              {def.name} · {locationName(practice.mapId, practice.locationId)} · {practice.side === 'attack' ? 'Attacking' : 'Defending'} · {WEAPONS[practice.primary].name}
            </div>
            <div className="mt-3 aspect-[4/3] border border-line">
              <MapPreview
                mapId={practice.mapId}
                locationId={practice.locationId}
                side={practice.side}
                spawnId={practice.playerSpawnId}
                spotIds={practice.enemySpotIds}
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Continue" right={<RotateCcw size={16} className="text-dim" />}>
          {last ? (
            <div>
              <div className="font-display text-xl font-bold uppercase">{MODE_INFO[last.mode].label}</div>
              <div className="text-sm text-mute">
                {locationName(last.mapId, last.locationId)} · {fmtDate(last.startedAt)}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat label="Score" value={last.score} />
                <Stat label="Acc" value={`${accuracy(last)}%`} />
                <Stat label="HS" value={`${hsPct(last)}%`} />
              </div>
              <Button className="mt-4 w-full" variant="outline" onClick={quick}>
                <Play size={16} /> Continue previous drill
              </Button>
            </div>
          ) : (
            <div className="text-sm text-mute">
              No sessions yet. Start with <span className="text-ink">Quick practice</span> — your history and improvement charts build up automatically.
            </div>
          )}
        </Card>

        <Card title="Daily training" right={<Flame size={16} className="text-accent" />}>
          <div className="space-y-2">
            {DAILY.map((d) => {
              const done = todays.some((s) => s.mode === d.mode);
              return (
                <button
                  key={d.mode}
                  onClick={() => store.play(normaliseConfig({ ...practice, ...d.patch, mode: d.mode, playerSpawnId: '', enemySpotIds: [] }))}
                  className={cx('flex w-full items-center gap-3 border px-3 py-2.5 text-left transition-colors', done ? 'border-ok/30 bg-ok/5' : 'border-line hover:border-mute')}
                >
                  <span className={cx('grid h-6 w-6 shrink-0 place-items-center border', done ? 'border-ok text-ok' : 'border-line text-dim')}>
                    {done ? <Check size={14} /> : <Crosshair size={13} />}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{d.title}</span>
                    <span className="block text-xs text-mute">{d.target}</span>
                  </span>
                  <ChevronRight size={16} className="text-dim" />
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-dim">{todays.length} session{todays.length === 1 ? '' : 's'} today</div>
        </Card>

        <Card title="Last used weapon" right={<Badge>{weapon.category}</Badge>}>
          <div className="flex gap-4">
            <SprayPattern pattern={weapon.recoil.pattern} color={weapon.color} className="h-40 w-28 shrink-0" />
            <div>
              <div className="font-display text-3xl font-bold uppercase" style={{ color: weapon.color }}>
                {weapon.name}
              </div>
              <div className="mt-1 text-sm text-mute">{weapon.description}</div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-dim">Fire rate</span>
                <span className="tabular">{weapon.fireRate} /s</span>
                <span className="text-dim">Magazine</span>
                <span className="tabular">{weapon.magazine}</span>
                <span className="text-dim">Head dmg</span>
                <span className="tabular">{weapon.damage[0].head}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card title="Recent performance" right={<Trophy size={16} className="text-warn" />}>
          <LineChart
            labels={recent.map((s, i) => `#${sessions.length - recent.length + i + 1}`)}
            series={[
              { name: 'Accuracy %', color: '#ff4655', values: recent.map((s) => accuracy(s)) },
              { name: 'Headshot %', color: '#f2c14e', values: recent.map((s) => hsPct(s)) },
            ]}
            yMax={100}
            unit="%"
          />
        </Card>
        <Card title="Map selection" right={<Badge>{def.name}</Badge>}>
          <div className="space-y-2">
            {def.locations.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  store.updatePractice(normaliseConfig({ ...practice, locationId: l.id, playerSpawnId: '', enemySpotIds: [] }));
                  store.go('practice');
                }}
                className="flex w-full items-center justify-between border border-line px-3 py-2.5 text-left hover:border-mute"
              >
                <span>
                  <span className="block font-display text-lg font-bold uppercase">{l.name}</span>
                  <span className="block text-xs text-mute">{l.description}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-dim" />
              </button>
            ))}
          </div>
          {sessions.length > 0 && <div className="mt-3 text-xs text-dim">Avg reaction (last 10): {avgMs(recent.flatMap((s) => s.reactionTimes)) || '—'} ms</div>}
        </Card>
      </div>
    </div>
  );
}
