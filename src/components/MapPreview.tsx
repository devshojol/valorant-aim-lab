import { useMemo } from 'react';
import type { Side } from '../types';
import { buildMapData, type MapData } from '../game/maps/MapData';
import { getMapDefinition } from '../game/maps/registry';
import { CELL, greedyMerge, shapeOf } from '../game/maps/GridMap';
import { analysePeekLine } from '../game/bots/perception/visibility';
import { STAND_EYE } from '../game/player/PlayerController';
import { COL_SIGHT } from '../game/physics/CollisionWorld';

const cache = new Map<string, MapData>();
export function mapDataFor(id: string): MapData {
  let d = cache.get(id);
  if (!d) {
    d = buildMapData(getMapDefinition(id));
    cache.set(id, d);
  }
  return d;
}

type CellKind = 'wall' | 'crate' | 'raised' | 'floor';
function kindOf(ch: string): CellKind {
  if (ch === '#' || ch === 'P') return 'wall';
  if (ch === 'c' || ch === 'C' || ch === 'D') return 'crate';
  if (ch === 'w') return 'raised';
  const s = shapeOf(ch);
  if (s.walkable && s.floor > 0) return 'raised';
  if (ch === 'r') return 'raised';
  return 'floor';
}

const FILL: Record<CellKind, string> = {
  wall: '#0b1016',
  crate: '#7a6249',
  raised: '#4a5a6e',
  floor: '#2e3b4b',
};

export function MapPreview({
  mapId,
  locationId,
  side,
  spawnId,
  spotIds,
  onToggleSpot,
  onPickSpawn,
  focus = true,
  showSight = true,
  className,
}: {
  mapId: string;
  locationId?: string;
  side?: Side;
  spawnId?: string;
  spotIds?: string[];
  onToggleSpot?: (id: string) => void;
  onPickSpawn?: (id: string) => void;
  focus?: boolean;
  showSight?: boolean;
  className?: string;
}) {
  const data = mapDataFor(mapId);
  const def = data.def;
  const rects = useMemo(() => {
    const rows = def.grid.length;
    const cols = def.grid[0].length;
    return greedyMerge(cols, rows, (c, r) => kindOf(def.grid[r][c])).map((rc) => ({
      x: data.space.x(rc.c0) - CELL / 2,
      y: -(data.space.z(rc.r0) + CELL / 2),
      w: (rc.c1 - rc.c0 + 1) * CELL,
      h: (rc.r1 - rc.r0 + 1) * CELL,
      kind: rc.key as CellKind,
    }));
  }, [def, data]);

  const location = def.locations.find((l) => l.id === locationId);
  const setup = location && side ? location.sides[side] : null;
  const spawn = setup?.playerSpawns.find((s) => s.id === spawnId) ?? setup?.playerSpawns[0];

  const eye = spawn ? ([spawn.pos[0], spawn.pos[1] + STAND_EYE, spawn.pos[2]] as [number, number, number]) : null;

  const sight = useMemo(() => {
    if (!eye || !showSight) return null;
    const pts: string[] = [];
    const yaw = ((spawn?.yaw ?? 0) * Math.PI) / 180;
    const half = (103 / 2) * (Math.PI / 180);
    const N = 90;
    pts.push(`${eye[0]},${-eye[2]}`);
    for (let i = 0; i <= N; i++) {
      const a = yaw - half + (2 * half * i) / N;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const hit = data.world.raycast(eye[0], eye[1], eye[2], dx, 0, dz, 70, COL_SIGHT);
      const t = hit ? hit.t : 70;
      pts.push(`${eye[0] + dx * t},${-(eye[2] + dz * t)}`);
    }
    return pts.join(' ');
  }, [eye?.[0], eye?.[1], eye?.[2], spawn?.yaw, showSight, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const spotState = useMemo(() => {
    if (!setup || !eye) return new Map<string, boolean>();
    const m = new Map<string, boolean>();
    for (const s of setup.enemySpots) {
      const info = analysePeekLine(data.world, eye, s.cover[0], s.cover[1], s.cover[2], s.peekDir[0], s.peekDir[1], s.maxPeek);
      m.set(s.id, info.exposeAt !== null && info.hideAt !== null);
    }
    return m;
  }, [setup, eye?.[0], eye?.[1], eye?.[2], data]); // eslint-disable-line react-hooks/exhaustive-deps

  const b = data.bounds;
  let vb = { x: b.minX, y: -b.maxZ, w: b.maxX - b.minX, h: b.maxZ - b.minZ };
  if (focus && location) {
    const f = location.focus;
    vb = { x: f.minX - 2, y: -f.maxZ - 2, w: f.maxX - f.minX + 4, h: f.maxZ - f.minZ + 4 };
  }
  const labelSize = Math.max(1.4, vb.w / (focus && location ? 38 : 56));

  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className={className} preserveAspectRatio="xMidYMid meet" shapeRendering="crispEdges" role="img" aria-label={`${def.name} top-down map`}>
      <rect x={b.minX} y={-b.maxZ} width={b.maxX - b.minX} height={b.maxZ - b.minZ} fill="#0c1218" />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={FILL[r.kind]} stroke={r.kind === 'crate' ? '#8b7458' : 'none'} strokeWidth={0.15} />
      ))}
      {def.siteMarks.map((m) => (
        <text key={m.letter} x={data.space.x(m.c)} y={-data.space.z(m.r)} fontSize={6} fill="rgba(255,255,255,0.12)" textAnchor="middle" dominantBaseline="middle" fontFamily="Barlow Condensed, Arial Narrow, Arial, sans-serif" fontWeight={800}>
          {m.letter}
        </text>
      ))}
      {sight && <polygon points={sight} fill="rgba(92,200,255,0.12)" stroke="rgba(92,200,255,0.35)" strokeWidth={0.15} />}
      {def.callouts.map((c) => (
        <text
          key={c.name}
          x={data.space.x(c.c)}
          y={-data.space.z(c.r)}
          fontSize={labelSize}
          fill="rgba(236,232,225,0.55)"
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="Barlow Condensed, Arial Narrow, Arial, sans-serif"
          fontWeight={600}
          style={{ textTransform: 'uppercase', letterSpacing: '0.05em', pointerEvents: 'none' }}
        >
          {c.name}
        </text>
      ))}
      {setup?.enemySpots.map((s) => {
        const usable = spotState.get(s.id) ?? true;
        const selected = !spotIds || spotIds.length === 0 || spotIds.includes(s.id);
        const x = s.cover[0];
        const y = -s.cover[2];
        const ex = x + s.peekDir[0] * s.maxPeek;
        const ey = y - s.peekDir[1] * s.maxPeek;
        const color = !usable ? '#5b6776' : selected ? '#ff4655' : '#8a4650';
        return (
          <g key={s.id} style={{ cursor: onToggleSpot ? 'pointer' : 'default' }} onClick={() => onToggleSpot?.(s.id)}>
            <title>{`${s.name}${usable ? '' : ' — not visible from this spawn'}`}</title>
            <line x1={x} y1={y} x2={ex} y2={ey} stroke={color} strokeWidth={0.3} strokeDasharray="0.8 0.5" opacity={0.8} />
            <rect x={x - 0.8} y={y - 0.8} width={1.6} height={1.6} transform={`rotate(45 ${x} ${y})`} fill={selected && usable ? color : '#0c1218'} stroke={color} strokeWidth={0.35} />
            <circle cx={x} cy={y} r={2.6} fill="transparent" />
          </g>
        );
      })}
      {setup?.playerSpawns.map((sp) => {
        const active = sp.id === spawn?.id;
        const x = sp.pos[0];
        const y = -sp.pos[2];
        const yaw = (sp.yaw * Math.PI) / 180;
        const ax = x + Math.sin(yaw) * 2.6;
        const ay = y - Math.cos(yaw) * 2.6;
        return (
          <g key={sp.id} style={{ cursor: onPickSpawn ? 'pointer' : 'default' }} onClick={() => onPickSpawn?.(sp.id)}>
            <title>{sp.name}</title>
            <line x1={x} y1={y} x2={ax} y2={ay} stroke={active ? '#5cc8ff' : '#3c6a85'} strokeWidth={0.45} />
            <circle cx={x} cy={y} r={1.1} fill={active ? '#5cc8ff' : '#0c1218'} stroke={active ? '#e6f7ff' : '#3c6a85'} strokeWidth={0.35} />
            <circle cx={x} cy={y} r={2.6} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}
