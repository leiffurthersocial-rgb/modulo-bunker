import type { BuildOption, BuildTargetInfo } from '../app/buildMode';
import { useEffect, useState } from 'preact/hooks';

/** Minimal observable store for UI state (no framework lock-in, testable). */
export class Store<T extends object> {
  private subs = new Set<() => void>();
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  set(patch: Partial<T>): void {
    this.value = { ...this.value, ...patch };
    this.subs.forEach((f) => f());
  }
  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}

export function useStore<T extends object, R>(store: Store<T>, sel: (v: T) => R): R {
  const [val, setVal] = useState(() => sel(store.get()));
  useEffect(() => store.subscribe(() => setVal(() => sel(store.get()))), [store]);
  return val;
}

export interface Notice {
  id: number;
  text: string;
  severity: 'info' | 'warn' | 'danger';
  at: number;
}

export interface UiState {
  prompt: string | null;
  /** Elevator floor picker: list of selectable floors. */
  floorPicker: { floors: { index: number; open: boolean }[]; current: number } | null;
  notices: Notice[];
  mode: 'player' | 'overview';
  locked: boolean;
  pointerLockSupported: boolean;
  showTouch: boolean;
  paused: boolean;
  build: { options: BuildOption[]; selected: string; target: BuildTargetInfo | null } | null;
}

export const ui = new Store<UiState>({
  prompt: null,
  floorPicker: null,
  notices: [],
  mode: 'player',
  locked: false,
  pointerLockSupported: true,
  showTouch: false,
  paused: false,
  build: null,
});

let noticeId = 1;
export function pushNotice(text: string, severity: Notice['severity'] = 'info'): void {
  const n: Notice = { id: noticeId++, text, severity, at: performance.now() };
  ui.set({ notices: [...ui.get().notices.slice(-4), n] });
  setTimeout(() => ui.set({ notices: ui.get().notices.filter((x) => x.id !== n.id) }), 5000);
}
