import { ui, useStore } from './store';

export interface HudActions {
  pickFloor(f: number): void;
  closePicker(): void;
  resume(): void;
}

export function Hud({ actions }: { actions: HudActions }) {
  const prompt = useStore(ui, (s) => s.prompt);
  const picker = useStore(ui, (s) => s.floorPicker);
  const notices = useStore(ui, (s) => s.notices);
  const mode = useStore(ui, (s) => s.mode);
  const locked = useStore(ui, (s) => s.locked);
  const plSupported = useStore(ui, (s) => s.pointerLockSupported);
  const touch = useStore(ui, (s) => s.showTouch);
  return (
    <div class="hud">
      {mode === 'player' && <div class="crosshair" />}
      {mode === 'player' && prompt && <div class="prompt">{prompt}</div>}
      {mode === 'player' && plSupported && !locked && !touch && !picker && (
        <div class="click-hint" onClick={actions.resume}>
          Click to look around · WASD move · E interact · Tab map
        </div>
      )}
      <div class="notices">
        {notices.map((n) => (
          <div key={n.id} class={`notice ${n.severity}`}>
            {n.text}
          </div>
        ))}
      </div>
      {picker && (
        <div class="modal-backdrop" onClick={actions.closePicker}>
          <div class="panel floor-picker" onClick={(e) => e.stopPropagation()}>
            <h3>Elevator</h3>
            <div class="floor-grid">
              {picker.floors.map((f) => (
                <button
                  key={f.index}
                  disabled={!f.open}
                  class={f.index === picker.current ? 'current' : ''}
                  onClick={() => actions.pickFloor(f.index)}
                >
                  {f.index + 1}
                  {!f.open && <small>sealed</small>}
                </button>
              ))}
            </div>
            <button class="close" onClick={actions.closePicker}>
              Close (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
