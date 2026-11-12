import type { SessionStats } from '../types';
import { WEAPONS } from '../game/weapons/weaponConfigs';
import { Stat } from './ui';
import { DIFFICULTY_LABEL, MODE_INFO, accuracy, avgMs, fmtDuration, hsPct, locationName, mapName } from '../utils/labels';

const p = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function SessionReportBody({ s }: { s: SessionStats }) {
  const rt = avgMs(s.reactionTimes);
  const kt = avgMs(s.killTimes);
  return (
    <div>
      <div className="mb-4 text-sm text-mute">
        {MODE_INFO[s.mode].label} · {mapName(s.mapId)} / {locationName(s.mapId, s.locationId)} ({s.side === 'attack' ? 'Attacking' : 'Defending'}) ·{' '}
        {DIFFICULTY_LABEL[s.difficulty]} · {fmtDuration(s.durationSec)}
      </div>
      {s.mode === 'spray' && (
        <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Avg spray score" value={s.spray ? Math.round(s.spray.avgScore) : '—'} sub="0 = no control, 100 = perfect" accent />
          <Stat label="Best spray" value={s.spray ? s.spray.bestScore : '—'} sub={`${s.spray?.sprays ?? 0} sprays scored`} />
          <Stat label="Avg error" value={s.spray ? `${s.spray.avgErrorDeg.toFixed(2)}°` : '—'} sub="from the first-shot point" />
          <Stat label="Tight bullets" value={s.spray ? `${Math.round(s.spray.avgTightPct)}%` : '—'} sub="within 0.6° (a head at 15 m)" />
        </div>
      )}
      <div className={s.mode === 'spray' ? 'hidden' : 'grid grid-cols-2 gap-2 md:grid-cols-4'}>
        <Stat label="Score" value={s.score} accent />
        <Stat label="Kills / Deaths" value={`${s.kills} / ${s.deaths}`} />
        <Stat label="Accuracy" value={`${accuracy(s)}%`} sub={`${s.hits} hits / ${s.shots} shots`} />
        <Stat label="Headshot %" value={`${hsPct(s)}%`} sub={`${s.headshots} head · ${s.bodyshots} body · ${s.legshots} legs`} />
        <Stat label="Avg reaction" value={rt ? `${rt} ms` : '—'} sub={`${s.reactionTimes.length} samples`} />
        <Stat label="Avg time to kill" value={kt ? `${kt} ms` : '—'} sub="from first sight" />
        <Stat label="First-shot acc." value={p(s.firstShotHits, s.firstShots)} sub={`${s.firstShots} first bullets`} />
        <Stat label="Spray acc." value={p(s.sprayHits, s.sprayShots)} sub="bullet 4+" />
        <Stat label="Moving-shot acc." value={p(s.movingHits, s.movingShots)} sub={`${s.movingShots} shots while moving`} />
        <Stat label="Damage" value={`${s.damageDealt}`} sub={`taken ${s.damageTaken}`} />
        {s.mode !== 'deathmatch' && <Stat label="Escapes" value={s.escapes} sub="bots that peeked & lived" />}
        {s.mode === 'jiggle' && <Stat label="Baited shots" value={s.baitedShots} sub="missed shots at jiggles" />}
      </div>
      {Object.keys(s.perWeapon).length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest text-dim">
              <th className="py-1.5">Weapon</th>
              <th>Shots</th>
              <th>Hits</th>
              <th>Acc.</th>
              <th>HS</th>
              <th>Kills</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(s.perWeapon).map(([id, w]) => (
              <tr key={id} className="border-t border-line">
                <td className="py-1.5 font-semibold">{WEAPONS[id as keyof typeof WEAPONS]?.name ?? id}</td>
                <td className="tabular">{w!.shots}</td>
                <td className="tabular">{w!.hits}</td>
                <td className="tabular">{p(w!.hits, w!.shots)}</td>
                <td className="tabular">{w!.headshots}</td>
                <td className="tabular">{w!.kills}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
