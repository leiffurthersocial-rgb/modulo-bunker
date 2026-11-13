import { Hud } from './Hud';
import type { HudActions } from './Hud';
import { PauseMenu } from './PauseMenu';
import type { PauseActions } from './PauseMenu';
import { BuildPanel } from './BuildPanel';
import type { BuildAction } from '../app/buildMode';
import { ui, useStore } from './store';
import { ResourceBar } from './ResourceBar';
import { DebugPanel } from './DebugPanel';
import type { Sample } from '../app/metrics';
import type { Settings } from '../input/settings';
import { Tablet } from './Tablet';
import type { TabletActions } from './tabletTypes';

export interface BuildUiActions {
  select(id: string): void;
  action(a: BuildAction): void;
  close(): void;
}

export function App(props: {
  hud: HudActions;
  pause: PauseActions;
  build: BuildUiActions;
  seed: string;
  getSettings: () => Settings;
  bar: { setSpeed(s: number): void; cycleOverlay(): void; openTablet(): void };
  debug: { run(cmd: string): string; samples(): Sample[] };
  tablet: TabletActions;
}) {
  const paused = useStore(ui, (s) => s.paused);
  const build = useStore(ui, (s) => s.build);
  const tablet = useStore(ui, (s) => s.tablet);
  const overlay = useStore(ui, (s) => s.resources?.overlay ?? 'none');
  return (
    <>
      <Hud actions={props.hud} />
      <ResourceBar {...props.bar} />
      {overlay === 'heat' && (
        <div class="legend">
          <span>
            <i style="background:#2f5bd8" />
            ≤0°
          </span>
          <span>
            <i style="background:#3fbfbf" />
            12°
          </span>
          <span>
            <i style="background:#3fbf5f" />
            20°
          </span>
          <span>
            <i style="background:#e0b73a" />
            30°
          </span>
          <span>
            <i style="background:#d24b3a" />
            40°+
          </span>
        </div>
      )}
      {overlay === 'power' && (
        <div class="legend">
          <span>
            <i style="background:#4fd1ff" />
            generator
          </span>
          <span>
            <i style="background:#3fbf5f" />
            powered
          </span>
          <span>
            <i style="background:#e0b73a" />
            brownout
          </span>
          <span>
            <i style="background:#d24b3a" />
            shed
          </span>
          <span>
            <i style="background:#555" />
            off/damaged
          </span>
        </div>
      )}
      <DebugPanel {...props.debug} />
      {build && !paused && (
        <BuildPanel
          options={build.options}
          selected={build.selected}
          target={build.target}
          onSelect={props.build.select}
          onAction={props.build.action}
          onClose={props.build.close}
        />
      )}
      {tablet && !paused && <Tablet view={tablet} actions={props.tablet} />}
      {paused && <PauseMenu seed={props.seed} settings={props.getSettings()} actions={props.pause} />}
    </>
  );
}
