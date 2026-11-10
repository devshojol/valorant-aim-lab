import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PracticeMode, SessionStats, WeaponId } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Badge, Card, ConfirmButton, PageHeader, Segmented, Stat } from '../components/ui';
import { LineChart } from '../components/Charts';
import { SessionReportBody } from '../components/SessionReport';
import { WEAPONS } from '../game/weapons/weaponConfigs';
import { MODE_INFO, accuracy, avgMs, dayKey, fmtDate, fmtDuration, hsPct, locationName } from '../utils/labels';

function aggregate(list: SessionStats[]) {
  const t = list.reduce(
    (a, s) => {
      a.shots += s.shots;
      a.hits += s.hits;
      a.hs += s.headshots;
      a.kills += s.kills;
      a.deaths += s.deaths;
      a.time += s.durationSec;
      a.rt.push(...s.reactionTimes);
      a.fs += s.firstShots;
      a.fsh += s.firstShotHits;
      a.ss += s.sprayShots;
      a.ssh += s.sprayHits;
      a.ms += s.movingShots;
      a.msh += s.movingHits;
      return a;
    },
    { shots: 0, hits: 0, hs: 0, kills: 0, deaths: 0, time: 0, rt: [] as number[], fs: 0, fsh: 0, ss: 0, ssh: 0, ms: 0, msh: 0 },
  );
  return t;
}

const pc = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function StatisticsPage() {
  const sessions = useAppStore((s) => s.sessions);
  const [range, setRange] = useState<'daily' | 'weekly'>('daily');
  const [modeFilter, setModeFilter] = useState<PracticeMode | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const filtered = modeFilter === 'all' ? sessions : sessions.filter((s) => s.mode === modeFilter);
  const t = aggregate(filtered);

  const buckets = useMemo(() => {
    const map = new Map<string, SessionStats[]>();
    for (const s of [...filtered].reverse()) {
      let key = dayKey(s.startedAt);
      if (range === 'weekly') {
        const d = new Date(s.startedAt);
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        key = 'wk ' + dayKey(monday.getTime()).slice(5);
      } else key = key.slice(5);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].slice(-20);
  }, [filtered, range]);

  const weapons = useMemo(() => {
    const m = new Map<WeaponId, { shots: number; hits: number; hs: number; kills: number }>();
    for (const s of filtered)
      for (const [id, w] of Object.entries(s.perWeapon)) {
        const cur = m.get(id as WeaponId) ?? { shots: 0, hits: 0, hs: 0, kills: 0 };
        cur.shots += w!.shots;
        cur.hits += w!.hits;
        cur.hs += w!.headshots;
        cur.kills += w!.kills;
        m.set(id as WeaponId, cur);
      }
    return [...m.entries()];
  }, [filtered]);

  const byMode = (Object.keys(MODE_INFO) as PracticeMode[]).map((m) => {
    const list = sessions.filter((s) => s.mode === m);
    const a = aggregate(list);
    return { m, n: list.length, acc: pc(a.hits, a.shots), hs: pc(a.hs, a.hits), rt: avgMs(a.rt), best: Math.max(0, ...list.map((s) => s.score)) };
  });

  return (
    <div>
      <PageHeader kicker="Analytics" title="Statistics">
        <div className="flex items-center gap-2">
          <Segmented
            value={modeFilter}
            onChange={setModeFilter}
            options={[{ value: 'all' as const, label: 'All modes' }, ...(Object.keys(MODE_INFO) as PracticeMode[]).map((m) => ({ value: m, label: MODE_INFO[m].short }))]}
          />
          {sessions.length > 0 && (
            <ConfirmButton confirmLabel="Delete all sessions?" onConfirm={() => store.clearSessions()}>
              <Trash2 size={14} /> Clear
            </ConfirmButton>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Sessions" value={filtered.length} sub={`${Math.round(t.time / 60)} min trained`} />
        <Stat label="Accuracy" value={`${pc(t.hits, t.shots)}%`} sub={`${t.hits}/${t.shots}`} accent />
        <Stat label="Headshot %" value={`${pc(t.hs, t.hits)}%`} />
        <Stat label="Avg reaction" value={t.rt.length ? `${avgMs(t.rt)}` : '—'} sub="ms" />
        <Stat label="K / D" value={t.deaths ? (t.kills / t.deaths).toFixed(2) : t.kills} sub={`${t.kills} kills`} />
        <Stat label="First-shot" value={`${pc(t.fsh, t.fs)}%`} />
        <Stat label="Spray" value={`${pc(t.ssh, t.ss)}%`} />
        <Stat label="Moving" value={`${pc(t.msh, t.ms)}%`} sub="lower is better discipline" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card title="Improvement" right={<Segmented value={range} onChange={setRange} options={[{ value: 'daily' as const, label: 'Daily' }, { value: 'weekly' as const, label: 'Weekly' }]} />}>
          <LineChart
            labels={buckets.map(([k]) => k)}
            series={[
              { name: 'Accuracy %', color: '#ff4655', values: buckets.map(([, l]) => { const a = aggregate(l); return pc(a.hits, a.shots); }) },
              { name: 'Headshot %', color: '#f2c14e', values: buckets.map(([, l]) => { const a = aggregate(l); return pc(a.hs, a.hits); }) },
            ]}
            yMax={100}
            unit="%"
          />
          <div className="mt-4">
            <LineChart
              labels={buckets.map(([k]) => k)}
              series={[{ name: 'Avg reaction (ms)', color: '#5cc8ff', values: buckets.map(([, l]) => { const v = avgMs(aggregate(l).rt); return v || null; }) }]}
              height={160}
            />
          </div>
        </Card>
        <div className="space-y-6">
          <Card title="By mode">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-dim">
                  <th className="py-1">Mode</th>
                  <th>N</th>
                  <th>Acc</th>
                  <th>HS</th>
                  <th>RT</th>
                  <th>Best</th>
                </tr>
              </thead>
              <tbody>
                {byMode.map((r) => (
                  <tr key={r.m} className="border-t border-line">
                    <td className="py-1.5">{MODE_INFO[r.m].short}</td>
                    <td className="tabular">{r.n}</td>
                    <td className="tabular">{r.acc}%</td>
                    <td className="tabular">{r.hs}%</td>
                    <td className="tabular">{r.rt || '—'}</td>
                    <td className="tabular">{r.n ? r.best : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="By weapon">
            {weapons.length === 0 && <div className="text-sm text-dim">No shots recorded yet.</div>}
            {weapons.map(([id, w]) => (
              <div key={id} className="flex items-center justify-between border-t border-line py-2 text-sm first:border-0">
                <span className="font-display text-lg font-bold uppercase" style={{ color: WEAPONS[id].color }}>
                  {WEAPONS[id].name}
                </span>
                <span className="tabular text-mute">
                  {pc(w.hits, w.shots)}% acc · {pc(w.hs, w.hits)}% HS · {w.kills} kills
                </span>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <Card title="Session history" className="mt-6">
        {filtered.length === 0 && <div className="text-sm text-dim">Finish a practice session to see it here.</div>}
        <div className="divide-y divide-line">
          {filtered.slice(0, 60).map((s) => (
            <div key={s.id}>
              <button className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 py-2.5 text-left text-sm hover:bg-white/[0.02]" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span className="w-32 text-mute">{fmtDate(s.startedAt)}</span>
                <span className="w-40 font-semibold">{MODE_INFO[s.mode].label}</span>
                <span className="w-28 text-mute">{locationName(s.mapId, s.locationId)}</span>
                <Badge>{WEAPONS[s.primary]?.name}</Badge>
                <span className="tabular">{fmtDuration(s.durationSec)}</span>
                <span className="tabular">
                  {s.kills}K/{s.deaths}D
                </span>
                <span className="tabular">{accuracy(s)}% acc</span>
                <span className="tabular">{hsPct(s)}% HS</span>
                <span className="tabular text-mute">{avgMs(s.reactionTimes) || '—'} ms</span>
                <span className="ml-auto font-display text-lg font-bold tabular text-accent">{s.score}</span>
              </button>
              {open === s.id && (
                <div className="border-t border-line bg-bg/40 p-4">
                  <SessionReportBody s={s} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
