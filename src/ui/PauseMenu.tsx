import { useEffect, useState } from 'preact/hooks';
import type { Action, Settings } from '../input/settings';
import { DEFAULT_KEYS } from '../input/settings';

export interface PauseActions {
  resume(): void;
  copyLink(): void;
  applySettings(s: Settings): void;
  save(): void;
  load(): void;
  exportSave(): void;
  importSave(): void;
  newGame(seed: string): void;
}

const ACTION_LABELS: Record<Action, string> = {
  forward: 'Forward',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  jump: 'Jump',
  sprint: 'Sprint',
  crouch: 'Crouch',
  interact: 'Interact',
  build: 'Build mode',
  overview: 'Map / overview',
  pause: 'Pause',
  overlay: 'Overlay',
  speedUp: 'Faster',
  speedDown: 'Slower',
  debug: 'Debug',
  tablet: 'Tablet',
};

const prettyKey = (k: string) =>
  k
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/Left$|Right$/, '');

export function PauseMenu({
  seed,
  settings,
  actions,
}: {
  seed: string;
  settings: Settings;
  actions: PauseActions;
}) {
  const [tab, setTab] = useState<'main' | 'settings' | 'keys'>('main');
  const [s, setS] = useState<Settings>(settings);
  const [rebinding, setRebinding] = useState<Action | null>(null);
  const [newSeed, setNewSeed] = useState(seed);

  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    actions.applySettings(next);
  };

  useEffect(() => {
    if (!rebinding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') update({ keys: { ...s.keys, [rebinding]: [e.code] } });
      setRebinding(null);
    };
    addEventListener('keydown', onKey, { capture: true, once: true });
    return () => removeEventListener('keydown', onKey, { capture: true });
  }, [rebinding]);

  return (
    <div class="modal-backdrop pause" onClick={(e) => e.target === e.currentTarget && actions.resume()}>
      <div class="panel pause-panel">
        <h3>Paused</h3>
        <div class="tabs">
          <button class={tab === 'main' ? 'active' : ''} onClick={() => setTab('main')}>
            Game
          </button>
          <button class={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            Settings
          </button>
          <button class={tab === 'keys' ? 'active' : ''} onClick={() => setTab('keys')}>
            Keys
          </button>
        </div>
        {tab === 'main' && (
          <div class="col">
            <button class="primary" onClick={actions.resume}>
              Resume
            </button>
            <div class="row">
              <span class="dim">Seed</span> <code>{seed}</code>
              <button onClick={actions.copyLink}>Copy link</button>
            </div>
            <div class="row">
              <button onClick={actions.save}>Save</button>
              <button onClick={actions.load}>Load</button>
              <button onClick={actions.exportSave}>Export</button>
              <button onClick={actions.importSave}>Import</button>
            </div>
            <div class="row">
              <input
                aria-label="New seed"
                value={newSeed}
                onInput={(e) => setNewSeed((e.target as HTMLInputElement).value)}
              />
              <button onClick={() => actions.newGame(newSeed)}>New game</button>
            </div>
          </div>
        )}
        {tab === 'settings' && (
          <div class="col">
            <label>
              Look sensitivity <b>{s.sensitivity.toFixed(2)}</b>
              <input
                type="range"
                min="0.2"
                max="3"
                step="0.05"
                value={s.sensitivity}
                onInput={(e) => update({ sensitivity: Number((e.target as HTMLInputElement).value) })}
              />
            </label>
            <label>
              Field of view <b>{s.fov}°</b>
              <input
                type="range"
                min="60"
                max="100"
                step="1"
                value={s.fov}
                onInput={(e) => update({ fov: Number((e.target as HTMLInputElement).value) })}
              />
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={s.invertY}
                onChange={(e) => update({ invertY: (e.target as HTMLInputElement).checked })}
              />
              Invert look Y
            </label>
            <label>
              On-screen touch controls
              <select
                value={s.touchControls}
                onChange={(e) =>
                  update({
                    touchControls: (e.target as HTMLSelectElement).value as Settings['touchControls'],
                  })
                }
              >
                <option value="auto">Auto (touch devices)</option>
                <option value="on">Always</option>
                <option value="off">Off</option>
              </select>
            </label>
          </div>
        )}
        {tab === 'keys' && (
          <div class="keys">
            {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
              <div class="row" key={a}>
                <span>{ACTION_LABELS[a]}</span>
                <button onClick={() => setRebinding(a)}>
                  {rebinding === a ? 'Press a key…' : s.keys[a].map(prettyKey).join(' / ')}
                </button>
              </div>
            ))}
            <button onClick={() => update({ keys: structuredClone(DEFAULT_KEYS) })}>Reset to defaults</button>
          </div>
        )}
      </div>
    </div>
  );
}
