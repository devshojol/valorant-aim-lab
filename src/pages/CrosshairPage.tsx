import { Copy, Download, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import type { CrosshairLineSettings, CrosshairSettings } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Button, Card, Field, PageHeader, Segmented, Slider, Toggle, cx } from '../components/ui';
import { CrosshairPreview } from '../components/CrosshairPreview';
import { CROSSHAIR_COLORS, DEFAULT_CROSSHAIR } from '../settings/defaults';
import { exportCrosshairCode, importCrosshairCode } from '../game/hud/crosshairRenderer';

function LineEditor({ title, l, onChange }: { title: string; l: CrosshairLineSettings; onChange: (l: CrosshairLineSettings) => void }) {
  const set = (p: Partial<CrosshairLineSettings>) => onChange({ ...l, ...p });
  return (
    <Card title={title} right={<Toggle label="" checked={l.show} onChange={(v) => set({ show: v })} />}>
      <div className={cx('grid gap-x-6 md:grid-cols-2', !l.show && 'pointer-events-none opacity-40')}>
        <Slider label="Opacity" value={l.opacity} min={0} max={1} step={0.01} onChange={(v) => set({ opacity: v })} />
        <Slider label="Length" value={l.length} min={0} max={20} step={1} onChange={(v) => set({ length: v })} />
        <Slider label="Thickness" value={l.thickness} min={0} max={10} step={1} onChange={(v) => set({ thickness: v })} />
        <Slider label="Offset" value={l.offset} min={0} max={40} step={1} onChange={(v) => set({ offset: v })} />
        <Toggle label="Movement error" checked={l.movementError} onChange={(v) => set({ movementError: v })} />
        <Slider label="Movement error multiplier" value={l.movementMult} min={0} max={3} step={0.1} onChange={(v) => set({ movementMult: v })} />
        <Toggle label="Firing error" checked={l.firingError} onChange={(v) => set({ firingError: v })} />
        <Slider label="Firing error multiplier" value={l.firingMult} min={0} max={3} step={0.1} onChange={(v) => set({ firingMult: v })} />
      </div>
    </Card>
  );
}

export function CrosshairPage() {
  const ch = useAppStore((s) => s.settings.crosshair);
  const presets = useAppStore((s) => s.presets);
  const [bg, setBg] = useState<'scene' | 'dark' | 'light'>('scene');
  const [sim, setSim] = useState<'still' | 'moving' | 'firing'>('still');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');

  const set = (p: Partial<CrosshairSettings>) => store.updateSettings((s) => ({ ...s, crosshair: { ...s.crosshair, ...p } }));
  const replace = (c: CrosshairSettings) => store.updateSettings((s) => ({ ...s, crosshair: c }));
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };
  const isCustom = !CROSSHAIR_COLORS.some((c) => c.hex.toLowerCase() === ch.color.toLowerCase());

  return (
    <div>
      <PageHeader kicker="HUD" title="Crosshair editor">
        <Button variant="outline" onClick={() => replace(DEFAULT_CROSSHAIR)}>
          <RotateCcw size={16} /> Reset to default
        </Button>
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Card title="Primary">
            <Field label="Color">
              <div className="flex flex-wrap items-center gap-2">
                {CROSSHAIR_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    title={c.name}
                    onClick={() => set({ color: c.hex })}
                    className={cx('h-8 w-8 border-2', ch.color.toLowerCase() === c.hex ? 'border-white' : 'border-transparent')}
                    style={{ background: c.hex }}
                  />
                ))}
                <label className={cx('flex items-center gap-2 border px-2 py-1 text-sm', isCustom ? 'border-white' : 'border-line')}>
                  Custom
                  <input type="color" value={ch.color} onChange={(e) => set({ color: e.target.value })} className="h-6 w-8 cursor-pointer border-0 bg-transparent" />
                  <input
                    value={ch.color}
                    onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && set({ color: e.target.value })}
                    className="w-20 bg-bg px-1 font-mono text-xs uppercase outline-none"
                  />
                </label>
              </div>
            </Field>
            <div className="grid gap-x-6 md:grid-cols-2">
              <div>
                <Toggle label="Outlines" checked={ch.outlines} onChange={(v) => set({ outlines: v })} />
                <Slider label="Outline opacity" value={ch.outlineOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ outlineOpacity: v })} />
                <Slider label="Outline thickness" value={ch.outlineThickness} min={1} max={6} step={1} onChange={(v) => set({ outlineThickness: v })} />
              </div>
              <div>
                <Toggle label="Center dot" checked={ch.centerDot} onChange={(v) => set({ centerDot: v })} />
                <Slider label="Center dot opacity" value={ch.centerDotOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ centerDotOpacity: v })} />
                <Slider label="Center dot thickness" value={ch.centerDotThickness} min={1} max={6} step={1} onChange={(v) => set({ centerDotThickness: v })} />
              </div>
            </div>
            <Toggle
              label="Dynamic crosshair"
              hint="Off = static: movement/firing error never move the lines, regardless of per-line toggles"
              checked={ch.dynamic}
              onChange={(v) => set({ dynamic: v })}
            />
          </Card>
          <LineEditor title="Inner lines" l={ch.inner} onChange={(inner) => set({ inner })} />
          <LineEditor title="Outer lines" l={ch.outer} onChange={(outer) => set({ outer })} />
        </div>

        <div className="space-y-5 xl:sticky xl:top-8 xl:self-start">
          <Card title="Live preview">
            <CrosshairPreview
              settings={ch}
              background={bg}
              className="aspect-video w-full border border-line"
              movementPx={sim === 'moving' ? 14 : 0}
              firingPx={sim === 'firing' ? 10 : 0}
            />
            <CrosshairPreview settings={ch} background={bg} className="mt-2 aspect-[3/1] w-full border border-line" zoom={4} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Segmented
                value={bg}
                onChange={setBg}
                options={[
                  { value: 'scene', label: 'Scene' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
              />
              <Segmented
                value={sim}
                onChange={setSim}
                options={[
                  { value: 'still', label: 'Still' },
                  { value: 'moving', label: 'Moving' },
                  { value: 'firing', label: 'Firing' },
                ]}
              />
            </div>
            <p className="mt-2 text-xs text-dim">Second preview is 4× zoomed. The in-game HUD uses the same renderer, so what you see here is pixel-identical in game.</p>
          </Card>
          <Card title="Presets">
            <div className="flex gap-2">
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name"
                className="flex-1 border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <Button
                size="sm"
                onClick={() => {
                  const name = presetName.trim() || `Preset ${presets.length + 1}`;
                  store.savePresets([...presets, { id: Date.now().toString(36), name, settings: ch }]);
                  setPresetName('');
                  flash(`Saved “${name}”`);
                }}
              >
                <Save size={14} /> Save
              </Button>
            </div>
            <div className="mt-3 space-y-1.5">
              {presets.length === 0 && <div className="text-sm text-dim">No saved presets yet.</div>}
              {presets.map((p) => (
                <div key={p.id} className="flex items-center gap-2 border border-line px-2 py-1.5">
                  <CrosshairPreview settings={p.settings} background="dark" className="h-10 w-10 shrink-0" />
                  <span className="flex-1 text-sm">{p.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => replace(p.settings)}>
                    Load
                  </Button>
                  <button className="p-1 text-dim hover:text-accent" title="Delete" onClick={() => store.savePresets(presets.filter((x) => x.id !== p.id))}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Import / export">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste a TAL1- crosshair code or JSON"
              className="h-20 w-full resize-none border border-line bg-bg p-2 font-mono text-xs outline-none focus:border-accent"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const c = exportCrosshairCode(ch);
                  setCode(c);
                  navigator.clipboard?.writeText(c).then(
                    () => flash('Code copied to clipboard'),
                    () => flash('Code ready below'),
                  );
                }}
              >
                <Copy size={14} /> Export code
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const parsed = importCrosshairCode(code);
                  if (parsed) {
                    replace({ ...DEFAULT_CROSSHAIR, ...parsed, inner: { ...DEFAULT_CROSSHAIR.inner, ...parsed.inner }, outer: { ...DEFAULT_CROSSHAIR.outer, ...parsed.outer } });
                    flash('Crosshair imported');
                  } else flash('That code could not be read');
                }}
              >
                <Upload size={14} /> Import
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const blob = new Blob([JSON.stringify({ v: 1, crosshair: ch, presets }, null, 2)], { type: 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = 'crosshair.json';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                }}
              >
                <Download size={14} /> Download JSON
              </Button>
            </div>
            {msg && <div className="mt-2 text-xs text-ok">{msg}</div>}
          </Card>
        </div>
      </div>
    </div>
  );
}
