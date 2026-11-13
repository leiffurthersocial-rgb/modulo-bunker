/** Player-facing input/view settings, persisted per device in localStorage (try/catch guarded). */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'interact'
  | 'build'
  | 'overview'
  | 'pause'
  | 'overlay'
  | 'speedUp'
  | 'speedDown'
  | 'debug'
  | 'tablet';

export interface Settings {
  sensitivity: number;
  fov: number;
  invertY: boolean;
  touchControls: 'auto' | 'on' | 'off';
  keys: Record<Action, string[]>;
}

export const DEFAULT_KEYS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft'],
  interact: ['KeyE'],
  build: ['KeyB'],
  overview: ['Tab'],
  pause: ['KeyP', 'Escape'],
  overlay: ['KeyO'],
  speedUp: ['Period'],
  speedDown: ['Comma'],
  debug: ['F3', 'Backquote'],
  tablet: ['KeyT'],
};

const KEY = 'modulo.settings.v1';

export function defaultSettings(): Settings {
  return { sensitivity: 1, fov: 75, invertY: false, touchControls: 'auto', keys: structuredClone(DEFAULT_KEYS) };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...s, keys: { ...d.keys, ...(s.keys ?? {}) } };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode): settings last for the session only */
  }
}

export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
