import { Play } from 'lucide-react';
import { useState } from 'react';
import type { Side } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Badge, Button, Card, PageHeader, Segmented, cx } from '../components/ui';
import { MapPreview } from '../components/MapPreview';
import { MAP_DEFINITIONS, getMapDefinition } from '../game/maps/registry';
import { normaliseConfig } from './PracticePage';

export function MapsPage() {
  const practice = useAppStore((s) => s.practice);
  const [mapId, setMapId] = useState(practice.mapId);
  const def = getMapDefinition(mapId);
  const [locId, setLocId] = useState(def.locations[0].id);
  const [side, setSide] = useState<Side>('attack');
  const location = def.locations.find((l) => l.id === locId) ?? def.locations[0];
  const setup = location.sides[side];

  const pickMap = (id: string) => {
    setMapId(id);
    setLocId(getMapDefinition(id).locations[0].id);
  };

  return (
    <div>
      <PageHeader kicker="Maps" title="Tactical environments" />
      <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        {MAP_DEFINITIONS.map((m) => (
          <button
            key={m.id}
            onClick={() => pickMap(m.id)}
            className={cx('border p-2 text-left transition-colors', m.id === def.id ? 'border-accent bg-accent/10' : 'border-line bg-panel hover:border-mute')}
          >
            <div className="aspect-[52/48] w-full border border-line/60">
              <MapPreview mapId={m.id} focus={false} showSight={false} className="h-full w-full" />
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2 px-1">
              <span className="font-display text-lg font-bold uppercase">{m.name}</span>
              <span className="text-xs text-mute">{m.inspiredBy}-inspired</span>
            </div>
            <div className="px-1 text-xs text-dim">{m.theme}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card title={`${def.name}: ${def.inspiredBy}-inspired`} right={<Badge tone="ok">{def.locations.length} locations</Badge>}>
          <p className="mb-4 max-w-3xl text-sm text-mute">{def.description}</p>
          <div className="aspect-[52/48] w-full border border-line">
            <MapPreview mapId={def.id} locationId={location.id} side={side} focus={false} className="h-full w-full" />
          </div>
        </Card>
        <div className="space-y-6">
          <Card title="Locations">
            <Segmented value={location.id} onChange={setLocId} options={def.locations.map((l) => ({ value: l.id, label: l.name }))} />
            <div className="mt-3">
              <Segmented
                value={side}
                onChange={setSide}
                options={[
                  { value: 'attack', label: 'Attack' },
                  { value: 'defend', label: 'Defend' },
                ]}
              />
            </div>
            <p className="mt-3 text-sm text-mute">{location.description}</p>
            <div className="mt-3 aspect-square border border-line">
              <MapPreview mapId={def.id} locationId={location.id} side={side} className="h-full w-full" />
            </div>
            <div className="mt-3 text-xs text-dim">
              {setup.playerSpawns.length} player spawns · {setup.enemySpots.length} enemy positions: {setup.enemySpots.map((s) => s.name).join(', ')}
            </div>
            <Button
              className="mt-4 w-full"
              onClick={() => {
                store.updatePractice(normaliseConfig({ ...practice, mapId: def.id, locationId: location.id, side, playerSpawnId: '', enemySpotIds: [] }));
                store.go('practice');
              }}
            >
              <Play size={16} /> Practice here
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
