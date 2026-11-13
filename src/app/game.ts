import * as THREE from 'three';
import { render, h } from 'preact';
import { loadDefs } from '../data';
import { validateDefs } from '../data/validate';
import { newWorld } from '../sim';
import type { Command, World } from '../sim';
import { SimRunner } from './simRunner';
import { SceneRig } from '../render/scene';
import { BunkerView } from '../render/bunkerView';
import { ActorsView } from '../render/actorsView';
import { PanelsView } from '../render/panelsView';
import { OverviewCamera } from '../render/overviewCamera';
import { PhysicsWorld } from '../player/physics';
import { FirstPersonController } from '../player/controller';
import { Interactor } from '../player/interact';
import type { Target } from '../player/interact';
import { InputManager } from '../input/input';
import { TouchControls } from '../input/touch';
import { isTouchDevice, loadSettings } from '../input/settings';
import { Hud } from '../ui/Hud';
import { pushNotice, ui } from '../ui/store';
import { cellsXRange, floorY } from '../sim/core/geometry';
import { GEO } from '../sim/core/state';
import { GENERATED_FLOORS } from '../gen/bunker';
import { checkCommand } from '../sim';

export const DEFAULT_SEED = 'ember-07';
export type CameraMode = 'overview' | 'player';

/** Owns the world, runner, views, player and UI; drives the frame loop. */
export class Game {
  readonly world: World;
  readonly runner: SimRunner;
  readonly rig: SceneRig;
  readonly bunker: BunkerView;
  readonly actors: ActorsView;
  readonly panels: PanelsView;
  readonly overview = new OverviewCamera();
  readonly input: InputManager;
  readonly touch: TouchControls;
  readonly player: FirstPersonController;
  readonly interactor: Interactor;
  target: Target = null;
  mode: CameraMode = 'player';
  frameMs = 0;
  private last = performance.now();
  private frameHooks: ((dt: number) => void)[] = [];
  private lastCarY = 0;
  private lastHoldTick = -1;
  private tmpBox = new THREE.Box3();

  static async create(container: HTMLElement, seed: string): Promise<Game> {
    const phys = await PhysicsWorld.create();
    return new Game(container, seed, phys);
  }

  private constructor(
    container: HTMLElement,
    readonly seed: string,
    readonly phys: PhysicsWorld,
  ) {
    const defs = loadDefs();
    if (import.meta.env.DEV) {
      const errs = validateDefs(defs);
      if (errs.length) console.warn('Content validation:', errs);
    }
    this.world = newWorld(seed, defs);
    this.runner = new SimRunner(this.world);
    this.rig = new SceneRig(container);
    this.bunker = new BunkerView(this.world);
    this.bunker.onFloorBuilt = (f, boxes) => this.phys.setFloorBoxes(f, boxes);
    for (const [f, boxes] of this.bunker.colliders) this.phys.setFloorBoxes(f, boxes);
    this.actors = new ActorsView(this.world);
    this.panels = new PanelsView(this.world);
    this.interactor = new Interactor(this.world);
    this.rig.scene.add(this.bunker.root, this.actors.root, this.panels.root, this.interactor.highlight);

    const settings = loadSettings();
    this.input = new InputManager(this.rig.renderer.domElement, settings);
    this.touch = new TouchControls(this.input);
    const showTouch = settings.touchControls === 'on' || (settings.touchControls === 'auto' && isTouchDevice());
    this.touch.setVisible(showTouch);
    ui.set({ showTouch, pointerLockSupported: this.input.pointerLockSupported });
    document.addEventListener('pointerlockchange', () => ui.set({ locked: this.input.locked }));

    this.player = new FirstPersonController(this.phys);
    this.player.teleport(0.6, floorY(0), -2.6, Math.PI);
    this.rig.camera.fov = settings.fov;
    this.rig.camera.updateProjectionMatrix();

    this.mountUi();
    this.wireEvents();
    this.setMode('player');
  }

  private mountUi(): void {
    const root = document.createElement('div');
    root.id = 'ui-root';
    document.body.appendChild(root);
    render(
      h(Hud, {
        actions: {
          pickFloor: (f: number) => {
            this.command({ type: 'callElevator', floor: f });
            this.closePicker();
          },
          closePicker: () => this.closePicker(),
          resume: () => this.input.requestLock(),
        },
      }),
      root,
    );
  }

  private wireEvents(): void {
    const bus = this.runner.bus;
    bus.on('notice', (e) => pushNotice(e.text, e.severity));
    bus.on('command.rejected', (e) => {
      if (e.command !== 'holdElevator') pushNotice(e.reason, 'warn');
    });
    bus.on('power.brownout', (e) => pushNotice(`Brownout: priority ${e.shedPriority}+ rooms lost power`, 'danger'));
    bus.on('power.restored', () => pushNotice('Power restored', 'info'));
  }

  /** Issue a command (queued for the next tick, or applied immediately while paused). */
  command(c: Command): void {
    this.runner.command(c);
  }

  onFrame(fn: (dt: number) => void): void {
    this.frameHooks.push(fn);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.bunker.setOverview(mode === 'overview');
    ui.set({ mode });
    if (mode === 'overview') {
      this.input.releaseLock();
      this.overview.floor = Math.max(0.5, this.player.floor);
      this.interactor.highlight.visible = false;
      ui.set({ prompt: null });
    }
  }

  private closePicker(): void {
    ui.set({ floorPicker: null });
    this.input.enabled = true;
    this.input.requestLock();
  }

  private openPicker(): void {
    const st = this.world.state;
    const floors = [];
    for (let f = 0; f < GENERATED_FLOORS; f++) floors.push({ index: f, open: st.floors[f]!.state === 'open' });
    ui.set({ floorPicker: { floors, current: this.player.floor } });
    this.input.enabled = false;
    this.input.releaseLock();
  }

  start(): void {
    this.rig.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    this.handleGlobalKeys();
    this.runner.update(dt);
    this.bunker.sync();
    this.bunker.update();
    this.panels.sync();
    this.actors.update(this.runner.prev, this.runner.cur, this.runner.alpha);

    // Elevator car + gates into physics.
    const carY = this.actors.car.position.y;
    const carDelta = carY - this.lastCarY;
    this.lastCarY = carY;
    this.phys.setCarY(carY);
    for (let f = 0; f < GENERATED_FLOORS; f++) this.phys.setGateOpen(f, this.actors.gateOpen(f));

    const intent = this.input.intent();
    if (this.mode === 'player') {
      this.player.lowestOpenFloor = this.lowestOpenFloor();
      this.player.update(intent, dt, carY, carDelta);
      this.phys.step();
      const e = this.player.eye();
      const cam = this.rig.camera;
      cam.position.set(e.x, e.y, e.z);
      cam.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
      this.bunker.setFocus(this.player.floor);
      this.holdElevatorIfInDoorway();
      this.updateTarget();
    } else {
      this.phys.step();
      this.updateOverviewCamera(intent, dt);
    }
    for (const fn of this.frameHooks) fn(dt);
    this.input.endFrame();
    this.rig.render();
    this.frameMs = performance.now() - t0;
  }

  private lowestOpenFloor(): number {
    let f = 0;
    while (this.world.state.floors[f + 1]?.state === 'open') f++;
    return f;
  }

  private handleGlobalKeys(): void {
    const i = this.input;
    if (ui.get().floorPicker) {
      if (i.codePressed('Escape')) this.closePicker();
      for (let d = 0; d <= 9; d++)
        if (i.codePressed(`Digit${d}`)) {
          const f = d === 0 ? 9 : d - 1;
          if (this.world.state.floors[f]?.state === 'open') {
            this.command({ type: 'callElevator', floor: f });
            this.closePicker();
          }
        }
      return;
    }
    if (i.wasPressed('overview')) this.setMode(this.mode === 'player' ? 'overview' : 'player');
    if (i.wasPressed('speedUp')) this.runner.cycleSpeed(1);
    if (i.wasPressed('speedDown')) this.runner.cycleSpeed(-1);
    if (i.codePressed('KeyP')) this.runner.togglePause();
    if (i.wasPressed('overlay')) {
      const order = ['none', 'power', 'heat'] as const;
      this.bunker.overlay = order[(order.indexOf(this.bunker.overlay) + 1) % order.length]!;
      pushNotice(`Overlay: ${this.bunker.overlay}`);
    }
    if (this.mode === 'player' && i.wasPressed('interact')) this.interact();
  }

  private holdElevatorIfInDoorway(): void {
    const p = this.player.position;
    const f = this.player.floor;
    const el = this.world.state.elevator;
    const inDoor = Math.abs(p.x) < 1.9 && p.z > -1.0 && p.z < 0.6;
    if (inDoor && el.target === null && Math.abs(el.pos - f) < 1e-6 && el.doorTicks > 0 && this.lastHoldTick !== this.world.state.tick) {
      this.lastHoldTick = this.world.state.tick;
      this.command({ type: 'holdElevator', floor: f });
    }
  }

  private updateTarget(): void {
    const solids = [this.bunker.root];
    const inter = [...this.panels.interactables(), this.actors.car.getObjectByName('elevator-panel')!, ...this.survivorMeshes()];
    this.target = this.input.enabled ? this.interactor.pick(this.rig.camera, solids, inter) : null;
    this.interactor.showHighlight(
      this.target,
      (t) => this.objectFor(t),
      (slotId) => this.cellBox(slotId),
    );
    ui.set({ prompt: this.promptFor(this.target) });
  }

  private survivorMeshes(): THREE.Object3D[] {
    return this.actors.root.children.filter((c) => c.userData.survivorId);
  }

  private objectFor(t: Target): THREE.Object3D | null {
    if (!t) return null;
    if (t.kind === 'callButton') return this.panels.callButtons[t.floor] ?? null;
    if (t.kind === 'carPanel') return this.actors.car.getObjectByName('elevator-panel') ?? null;
    if (t.kind === 'survivor') return this.survivorMeshes().find((o) => o.userData.survivorId === t.id) ?? null;
    if (t.kind === 'unsealFloor') return this.panels.interactables().find((o) => o.userData.interact?.kind === 'unsealFloor') ?? null;
    return null;
  }

  cellBox(slotId: number): THREE.Box3 | null {
    const s = this.world.slot(slotId);
    if (!s) return null;
    const r = this.world.room(s.roomId);
    const idx = r ? r.slotIds.map((id) => this.world.slot(id)!.index) : [s.index];
    const [x0, x1] = cellsXRange(s.side, idx);
    const y0 = floorY(s.floor);
    return this.tmpBox.set(
      new THREE.Vector3(x0 + 0.05, y0 + 0.02, -GEO.cellDepth / 2 + 0.05),
      new THREE.Vector3(x1 - 0.05, y0 + GEO.cellHeight - 0.05, GEO.cellDepth / 2 - 0.05),
    );
  }

  private promptFor(t: Target): string | null {
    if (!t) return null;
    const w = this.world;
    switch (t.kind) {
      case 'callButton':
        return 'E: call elevator';
      case 'carPanel':
        return 'E: choose floor';
      case 'unsealFloor': {
        const cost = w.defs.balance.openFloorCost.map((c) => `${c.qty} ${c.item}`).join(', ');
        return `E: unseal floor ${t.floor + 1} (${cost})`;
      }
      case 'survivor': {
        const s = w.survivor(t.id)!;
        return `${s.name} · ${s.action} · health ${s.health.toFixed(0)}`;
      }
      case 'cell': {
        const s = w.slot(t.slotId)!;
        const r = w.room(s.roomId);
        if (s.state === 'sealed') {
          const ok = checkCommand(w, { type: 'openSeal', slotId: s.id });
          return ok.ok ? 'E: open sealed cell' : `Sealed: ${ok.reason}`;
        }
        if (r?.damaged) {
          const cost = w.defs.balance.repairCostPerCell.map((c) => `${c.qty * r.slotIds.length} ${c.item}`).join(', ');
          return `${w.defs.rooms[r.type]!.name} (damaged)\nE: repair (${cost})`;
        }
        if (r) return `${w.defs.rooms[r.type]!.name} T${r.tier}`;
        if (s.state === 'empty') return 'Empty cell · B: build';
        return null;
      }
    }
  }

  private interact(): void {
    const t = this.target;
    if (!t) return;
    switch (t.kind) {
      case 'callButton':
        this.command({ type: 'callElevator', floor: t.floor });
        pushNotice('Elevator called');
        break;
      case 'carPanel':
        this.openPicker();
        break;
      case 'unsealFloor':
        this.command({ type: 'openFloor', floor: t.floor });
        break;
      case 'cell': {
        const s = this.world.slot(t.slotId)!;
        const r = this.world.room(s.roomId);
        if (s.state === 'sealed') this.command({ type: 'openSeal', slotId: s.id });
        else if (r?.damaged) this.command({ type: 'repair', roomId: r.id });
        break;
      }
      case 'survivor':
        break;
    }
  }

  private updateOverviewCamera(intent: ReturnType<InputManager['intent']>, dt: number): void {
    const o = this.overview;
    o.x = Math.max(-26, Math.min(26, o.x + intent.moveX * dt * 14));
    o.floor = Math.max(0, Math.min(GENERATED_FLOORS - 1, o.floor - intent.moveZ * dt * 2.5));
    o.apply(this.rig.camera);
    this.bunker.setFocus(o.floor);
  }
}
