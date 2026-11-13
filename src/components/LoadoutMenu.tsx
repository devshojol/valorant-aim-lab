import type { WeaponId } from '../types';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS, WEAPONS } from '../game/weapons/weaponConfigs';
import { WeaponIcon } from './WeaponIcon';
import { Button, cx } from './ui';

function Tile({ id, active, onPick }: { id: WeaponId; active: boolean; onPick: (id: WeaponId) => void }) {
  const w = WEAPONS[id];
  const d = w.damage[0];
  return (
    <button
      onClick={() => onPick(id)}
      data-active={active}
      className={cx('tal-tile border p-3 text-left', active ? 'border-accent bg-accent/15' : 'border-line bg-bg/60 hover:border-mute')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-dim">{w.category}</span>
        {active && <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">Equipped</span>}
      </div>
      <WeaponIcon id={id} className="my-1 h-10 w-full" color={active ? w.color : '#8a96a5'} />
      <div className="font-display text-xl font-bold uppercase leading-none" style={{ color: active ? w.color : undefined }}>
        {w.name}
      </div>
      <div className="mt-1 text-[11px] text-mute tabular">
        {d.head} / {d.body} dmg · {w.fireRate} rps · {w.magazine} rounds
      </div>
    </button>
  );
}

/** In-session weapon menu (B): pick a primary and a sidearm without leaving the session. */
export function LoadoutMenu({
  primary,
  secondary,
  onPick,
  onClose,
  issue,
}: {
  primary: WeaponId;
  secondary: WeaponId;
  onPick: (slot: 0 | 1, id: WeaponId) => void;
  onClose: () => void;
  issue: 'cooldown' | 'blocked' | null;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-[2px]">
      <div className="tal-card w-[min(980px,94vw)] border border-line bg-panel/95 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-display text-sm font-semibold uppercase tracking-[0.25em] text-accent">Weapon menu</div>
            <div className="font-display text-3xl font-bold uppercase leading-none">Choose your loadout</div>
          </div>
          <div className="text-xs text-dim">The session is paused. Your choice applies when you return.</div>
        </div>

        <div className="mt-5 text-xs uppercase tracking-widest text-dim">Primary · key 1</div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
          {PRIMARY_WEAPONS.map((id) => (
            <Tile key={id} id={id} active={id === primary} onPick={(w) => onPick(0, w)} />
          ))}
        </div>

        <div className="mt-5 text-xs uppercase tracking-widest text-dim">Sidearm · key 2</div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
          {SECONDARY_WEAPONS.map((id) => (
            <Tile key={id} id={id} active={id === secondary} onPick={(w) => onPick(1, w)} />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={onClose}>
            Back to the fight
          </Button>
          <span className="text-xs text-dim">or press B again</span>
          {issue && <span className="text-xs text-warn">The browser needs a moment before it can capture the mouse again. Click the button once more.</span>}
        </div>
      </div>
    </div>
  );
}
