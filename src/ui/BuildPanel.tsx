import type { BuildAction, BuildOption, BuildTargetInfo } from '../app/buildMode';
import type { ItemStack } from '../data/types';

export interface BuildPanelProps {
  options: BuildOption[];
  selected: string;
  target: BuildTargetInfo | null;
  onSelect(id: string): void;
  onAction(a: BuildAction): void;
  onClose(): void;
}

const fmtCost = (c: ItemStack[]) =>
  c.length ? c.map((s) => `${Math.round(s.qty)} ${s.item}`).join(' · ') : 'free';

export function BuildPanel(p: BuildPanelProps) {
  return (
    <div class="build-panel panel" data-testid="build-panel">
      <div class="build-head">
        <h3>Build</h3>
        <span class="dim">E / tap: primary action · wheel or 1-9: room type</span>
        <button class="close-x" onClick={p.onClose} aria-label="Close build mode">
          ✕
        </button>
      </div>
      <div class="build-options">
        {p.options.map((o, i) => (
          <button
            key={o.id}
            class={`build-opt${o.id === p.selected ? ' sel' : ''}${o.affordable ? '' : ' poor'}`}
            style={{ borderColor: o.id === p.selected ? o.color : undefined }}
            onClick={() => p.onSelect(o.id)}
            title={`${o.name}: ${fmtCost(o.cost)}`}
          >
            <b style={{ color: o.color }}>{o.short}</b>
            <small>{i < 9 ? i + 1 : ''}</small>
          </button>
        ))}
      </div>
      <div class="build-target">
        {p.target ? (
          <>
            <div>
              <b>{p.target.title}</b> <span class="dim">{p.target.subtitle}</span>
            </div>
            <div class="row">
              {p.target.actions.length === 0 && <span class="dim">Nothing to do here</span>}
              {p.target.actions.map((a) => (
                <button
                  key={a.id}
                  class={`act${a.danger ? ' danger' : ''}`}
                  disabled={!a.ok}
                  onClick={() => p.onAction(a)}
                  title={a.reason ?? ''}
                >
                  <span>
                    {a.label} <kbd>{a.key}</kbd>
                  </span>
                  <small>{a.ok ? fmtCost(a.cost) : a.reason}</small>
                </button>
              ))}
            </div>
          </>
        ) : (
          <span class="dim">Aim at a cell (or tap one on the map)</span>
        )}
      </div>
    </div>
  );
}
