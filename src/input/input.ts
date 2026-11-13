import type { Action, Settings } from './settings';

/** Per-frame player intent, produced from keyboard/mouse/touch. */
export interface Intent {
  moveX: number; // strafe -1..1
  moveZ: number; // forward +1 .. back -1
  lookDX: number; // radians this frame
  lookDY: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  /** Primary click this frame: while pointer-locked = screen centre; otherwise pointer position (NDC). */
  click: { x: number; y: number } | null;
}

/**
 * Collects input. Desktop: keys + Pointer Lock (click to capture). Where pointer lock is missing
 * (iPadOS Safari) or refused: drag-to-look with mouse/trackpad. Touch controls feed `virtual`.
 */
export class InputManager {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private dragging = false;
  private dragId = -1;
  readonly pointerLockSupported: boolean;
  /** Set by the touch layer. */
  virtual = { moveX: 0, moveZ: 0, lookX: 0, lookY: 0, jump: false, sprint: false, crouch: false };
  /** Blocks gameplay input (menus, text fields). */
  enabled = true;
  private virtualPressed = new Set<Action>();
  /** When false (overview/menus), clicking does not capture the pointer; drag pans/looks instead. */
  lockOnClick = true;
  private click: { x: number; y: number } | null = null;
  private downAt: { x: number; y: number; t: number; id: number } | null = null;
  private moved = 0;

  constructor(
    private canvas: HTMLElement,
    public settings: Settings,
  ) {
    this.pointerLockSupported = 'requestPointerLock' in canvas && !/iPad|iPhone/.test(navigator.userAgent);
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Tab', 'Space', 'F3', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return; // touch layer handles touch
      if (this.locked) {
        if (e.button === 0) this.click = { x: 0, y: 0 };
        return;
      }
      if (this.lockOnClick && this.pointerLockSupported) {
        this.requestLock();
        return;
      }
      this.dragging = true;
      this.dragId = e.pointerId;
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      this.moved = 0;
    });
    addEventListener('pointermove', (e) => {
      if (this.dragging && e.pointerId === this.dragId) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
        this.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      }
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.dragId) return;
      this.dragging = false;
      if (this.downAt && this.moved < 8 && performance.now() - this.downAt.t < 500)
        this.clickAt(e.clientX, e.clientY);
      this.downAt = null;
    });
  }

  /** Register a click/tap at client coordinates (also used by the touch layer). */
  clickAt(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.click = { x: ((clientX - r.left) / r.width) * 2 - 1, y: -((clientY - r.top) / r.height) * 2 + 1 };
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    if (!this.pointerLockSupported) return;
    const el = this.canvas as HTMLElement & {
      requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && 'catch' in p) p.catch(() => el.requestPointerLock());
    } catch {
      el.requestPointerLock();
    }
  }
  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  private isDown(a: Action): boolean {
    return this.settings.keys[a].some((k) => this.down.has(k));
  }
  /** True once per key press (edge). */
  wasPressed(a: Action): boolean {
    return this.settings.keys[a].some((k) => this.pressed.has(k)) || this.virtualPressed.has(a);
  }
  /** Raw key edge (for number keys etc.). */
  codePressed(code: string): boolean {
    return this.pressed.has(code);
  }
  /** Touch buttons call this. */
  pressVirtual(a: Action): void {
    this.virtualPressed.add(a);
  }

  /** Builds this frame's intent. Call once per frame, then `endFrame()`. */
  intent(): Intent {
    const s = this.settings;
    const sens = 0.0022 * s.sensitivity;
    const v = this.virtual;
    const on = this.enabled;
    const ax = on ? (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0) + v.moveX : 0;
    const az = on ? (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0) + v.moveZ : 0;
    const len = Math.hypot(ax, az);
    const k = len > 1 ? 1 / len : 1;
    const lx = on ? (this.lookX + v.lookX) * sens : 0;
    const ly = on ? (this.lookY + v.lookY) * sens * (s.invertY ? -1 : 1) : 0;
    return {
      moveX: ax * k,
      moveZ: az * k,
      lookDX: lx,
      lookDY: ly,
      jump: on && (this.wasPressed('jump') || v.jump),
      sprint: on && (this.isDown('sprint') || v.sprint),
      crouch: on && (this.isDown('crouch') || v.crouch),
      click: on ? this.click : null,
    };
  }

  endFrame(): void {
    this.pressed.clear();
    this.virtualPressed.clear();
    this.click = null;
    this.lookX = 0;
    this.lookY = 0;
    this.virtual.lookX = 0;
    this.virtual.lookY = 0;
    this.virtual.jump = false;
  }
}
