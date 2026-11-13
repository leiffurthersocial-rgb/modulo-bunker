import { Hud } from './Hud';
import type { HudActions } from './Hud';
import { PauseMenu } from './PauseMenu';
import type { PauseActions } from './PauseMenu';
import { BuildPanel } from './BuildPanel';
import type { BuildAction } from '../app/buildMode';
import { ui, useStore } from './store';
import type { Settings } from '../input/settings';

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
}) {
  const paused = useStore(ui, (s) => s.paused);
  const build = useStore(ui, (s) => s.build);
  return (
    <>
      <Hud actions={props.hud} />
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
      {paused && <PauseMenu seed={props.seed} settings={props.getSettings()} actions={props.pause} />}
    </>
  );
}
