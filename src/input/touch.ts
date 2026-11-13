import type { InputManager } from './input';
import type { Action } from './settings';

/**
 * On-screen touch controls: floating left stick (movement), right-half drag (look), buttons.
 * Multi-touch via pointer events with pointerId tracking (stick + look at the same time).
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private stickId = -1;
  private lookId = -1;
  private stickOrigin = { x: 0, y: 0 };
  private lastLook = { x: 0, y: 0 };
  private lookStart = { x: 0, y: 0, t: 0 };
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private crouchOn = false;
  private sprintOn = false;

  constructor(private input: InputManager) {
    const root = document.createElement('div');
    root.id = 'touch-controls';
    root.innerHTML = `
      <div class="tc-look"></div>
      <div class="tc-stick-zone"></div>
      <div class="tc-base"><div class="tc-knob"></div></div>
      <div class="tc-buttons">
        <button data-a="interact" class="tc-big">E</button>
        <button data-a="jump">Jump</button>
        <button data-a="crouch" data-toggle="crouch">Crouch</button>
        <button data-a="sprint" data-toggle="sprint">Run</button>
        <button data-a="build">Build</button>
        <button data-a="overview">Map</button>
        <button data-a="pause" class="tc-menu">☰</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.base = root.querySelector('.tc-base')!;
    this.knob = root.querySelector('.tc-knob')!;
    const zone = root.querySelector<HTMLDivElement>('.tc-stick-zone')!;
    const look = root.querySelector<HTMLDivElement>('.tc-look')!;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== -1) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.display = 'block';
      this.base.style.left = `${e.clientX - 60}px`;
      this.base.style.top = `${e.clientY - 60}px`;
      this.moveKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const r = Math.min(1, Math.hypot(dx, dy) / 55);
      const a = Math.atan2(dy, dx);
      const mx = Math.cos(a) * r;
      const my = Math.sin(a) * r;
      this.input.virtual.moveX = Math.abs(mx) < 0.12 ? 0 : mx;
      this.input.virtual.moveZ = Math.abs(my) < 0.12 ? 0 : -my;
      this.moveKnob(mx * 45, my * 45);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.input.virtual.moveX = 0;
      this.input.virtual.moveZ = 0;
      this.base.style.display = 'none';
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    look.addEventListener('pointerdown', (e) => {
      if (this.lookId !== -1) return;
      this.lookId = e.pointerId;
      look.setPointerCapture(e.pointerId);
      this.lastLook = { x: e.clientX, y: e.clientY };
      this.lookStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.input.virtual.lookX += (e.clientX - this.lastLook.x) * 1.6;
      this.input.virtual.lookY += (e.clientY - this.lastLook.y) * 1.6;
      this.lastLook = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId !== this.lookId) return;
      this.lookId = -1;
      // A short tap without dragging is a click (select / interact target in overview & build).
      const d = Math.abs(e.clientX - this.lookStart.x) + Math.abs(e.clientY - this.lookStart.y);
      if (e.type === 'pointerup' && d < 10 && performance.now() - this.lookStart.t < 350)
        this.input.clickAt(e.clientX, e.clientY);
    };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    root.querySelectorAll<HTMLButtonElement>('.tc-buttons button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const a = b.dataset.a as Action;
        if (b.dataset.toggle === 'crouch') {
          this.crouchOn = !this.crouchOn;
          this.input.virtual.crouch = this.crouchOn;
          b.classList.toggle('on', this.crouchOn);
        } else if (b.dataset.toggle === 'sprint') {
          this.sprintOn = !this.sprintOn;
          this.input.virtual.sprint = this.sprintOn;
          b.classList.toggle('on', this.sprintOn);
        } else if (a === 'jump') this.input.virtual.jump = true;
        else this.input.pressVirtual(a);
      });
    });
  }

  private moveKnob(x: number, y: number): void {
    this.knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }
}
