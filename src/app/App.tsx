import { ChartColumn, Crosshair, House, Map as MapIcon, MousePointer2, Settings, Swords, Target } from 'lucide-react';
import type { ComponentType } from 'react';
import { store, useAppStore, type Page } from '../hooks/useAppStore';
import { cx } from '../components/ui';
import { HomePage } from '../pages/HomePage';
import { PracticePage } from '../pages/PracticePage';
import { MapsPage } from '../pages/MapsPage';
import { WeaponsPage } from '../pages/WeaponsPage';
import { CrosshairPage } from '../pages/CrosshairPage';
import { SensitivityPage } from '../pages/SensitivityPage';
import { StatisticsPage } from '../pages/StatisticsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { GamePage } from '../pages/GamePage';

const NAV: { id: Page; label: string; icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'practice', label: 'Practice', icon: Target },
  { id: 'maps', label: 'Maps', icon: MapIcon },
  { id: 'weapons', label: 'Weapons', icon: Swords },
  { id: 'crosshair', label: 'Crosshair', icon: Crosshair },
  { id: 'sensitivity', label: 'Sensitivity', icon: MousePointer2 },
  { id: 'statistics', label: 'Statistics', icon: ChartColumn },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 pb-4 pt-4 md:pb-6 md:pt-6">
      <div className="relative grid h-10 w-10 place-items-center border border-accent/60 bg-accent/10">
        <Crosshair size={22} className="text-accent" />
      </div>
      <div className="leading-none">
        <div className="font-display text-xl font-bold uppercase tracking-wider text-ink">Tactical</div>
        <div className="font-display text-xs font-semibold uppercase tracking-[0.35em] text-accent">Aim Lab</div>
      </div>
    </div>
  );
}

export function App() {
  const page = useAppStore((s) => s.page);
  const playing = useAppStore((s) => s.playing);

  if (playing) return <GamePage config={playing} />;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-[#080c11] md:w-56 md:border-b-0 md:border-r">
        <Brand />
        <nav className="flex flex-wrap gap-0.5 px-3 pb-3 md:flex-1 md:flex-col md:flex-nowrap md:space-y-0.5 md:pb-0">
          {NAV.map((n) => {
            const active = n.id === page;
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                onClick={() => store.go(n.id)}
                className={cx(
                  'group relative flex items-center gap-2 px-2.5 py-2 text-left font-display text-sm font-semibold uppercase tracking-wider transition-colors md:w-full md:gap-3 md:px-3 md:py-2.5 md:text-[15px]',
                  active ? 'bg-white/[0.06] text-ink' : 'text-mute hover:bg-white/[0.03] hover:text-ink',
                )}
              >
                <span className={cx('absolute left-0 top-1.5 bottom-1.5 w-[3px]', active ? 'bg-accent' : 'bg-transparent')} />
                <Icon size={18} className={active ? 'text-accent' : 'text-dim group-hover:text-mute'} />
                {n.label}
              </button>
            );
          })}
        </nav>
        <div className="hidden border-t border-line px-5 py-4 text-[11px] leading-relaxed text-dim md:block">
          Keyboard &amp; mouse · Chrome / Edge recommended.
          <br />
          Fan-made training tool, not affiliated with Riot Games.
        </div>
      </aside>
      <main className="bg-grid relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn md:hidden">
          Gameplay needs a keyboard and mouse on a desktop browser. You can still browse settings and stats here.
        </div>
        <div key={page} className="animate-in mx-auto max-w-[1280px] px-4 py-6 md:px-8 md:py-8">
          {page === 'home' && <HomePage />}
          {page === 'practice' && <PracticePage />}
          {page === 'maps' && <MapsPage />}
          {page === 'weapons' && <WeaponsPage />}
          {page === 'crosshair' && <CrosshairPage />}
          {page === 'sensitivity' && <SensitivityPage />}
          {page === 'statistics' && <StatisticsPage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  );
}
