import * as THREE from 'three';
import { render, h } from 'preact';
import { loadDefs } from '../data';
import { validateDefs } from '../data/validate';
import { newWorld } from '../sim';
import type { Command, Speed, World } from '../sim';
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
import { isTouchDevice, loadSettings, saveSettings } from '../input/settings';
import type { Settings } from '../input/settings';
import { App } from '../ui/App';
import { pushNotice, ui } from '../ui/store';
import { cellsXRange, floorY } from '../sim/core/geometry';
import { GEO } from '../sim/core/state';
import { GENERATED_FLOORS } from '../gen/bunker';
import { checkCommand } from '../sim';
import { BuildMode } from './buildMode';
import type { BuildAction } from './buildMode';
import { Metrics, foodTotal } from './metrics';
import { buildTabletView } from './tabletView';
import { formatClock } from '../sim';
import { storeCapacity, storeUsed } from '../sim/core/store';
import type { Speed as SpeedT } from '../sim';

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
  readonly build: BuildMode;
  /** Cell selected by click/tap in overview mode. */
  selectedSlot: number | null = null;
  private lastBuildJson = '';
  readonly metrics: Metrics;
  private uiAcc = 0;
  private fpsFrames = 0;
  private fpsAcc = 0;
  private fps = 0;
  debugOpen = false;
  mode: CameraMode = 'player';
  frameMs = 0;
  private last = performance.now();
  private frameHooks: ((dt: number) => void)[] = [];
  private lastCarY = 0;
  private lastHoldTick = -1;
  private tmpBox = new THREE.Box3();
  private releasingLock = false;
  private lastClick: { x: number; y: number } | null = null;

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
    this.metrics = new Metrics(this.world);
    this.rig = new SceneRig(container);
    this.bunker = new BunkerView(this.world);
    this.bunker.onFloorBuilt = (f, boxes) => this.phys.setFloorBoxes(f, boxes);
    for (const [f, boxes] of this.bunker.colliders) this.phys.setFloorBoxes(f, boxes);
    this.actors = new ActorsView(this.world);
    this.panels = new PanelsView(this.world);
    this.interactor = new Interactor(this.world);
    this.build = new BuildMode(this.world);
    this.rig.scene.add(
      this.bunker.root,
      this.actors.root,
      this.panels.root,
      this.interactor.highlight,
      this.build.ghost,
    );
    this.rig.renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        if (this.mode === 'overview' && !this.build.active) {
          this.overview.distance = Math.max(10, Math.min(60, this.overview.distance + e.deltaY * 0.02));
        } else if (this.build.active) this.cycleBuildType(e.deltaY > 0 ? 1 : -1);
        e.preventDefault();
      },
      { passive: false },
    );

    const settings = loadSettings();
    this.input = new InputManager(this.rig.renderer.domElement, settings);
    this.touch = new TouchControls(this.input);
    const showTouch =
      settings.touchControls === 'on' || (settings.touchControls === 'auto' && isTouchDevice());
    this.touch.setVisible(showTouch);
    ui.set({ showTouch, pointerLockSupported: this.input.pointerLockSupported });
    document.addEventListener('pointerlockchange', () => {
      ui.set({ locked: this.input.locked });
      // Losing the lock in first person (Esc) opens the pause menu, like most PC games.
      if (!this.input.locked && this.mode === 'player' && !ui.get().floorPicker && !this.releasingLock)
        this.openPause();
      this.releasingLock = false;
    });

    this.player = new FirstPersonController(this.phys);
    this.phys.step(); // register static colliders in the query pipeline before the first move
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
      h(App, {
        seed: this.seed,
        getSettings: () => this.input.settings,
        bar: {
          setSpeed: (sp: number) => this.runner.setSpeed(sp as SpeedT),
          cycleOverlay: () => this.cycleOverlay(),
          openTablet: () => this.setTablet(true),
        },
        tablet: {
          assign: (survivorId: number, roomId: number | null) =>
            this.command({ type: 'assign', survivorId, roomId }),
          setPriority: (roomId: number, priority: number) =>
            this.command({ type: 'setPriority', roomId, priority }),
          toggleRoom: (roomId: number, enabled: boolean) =>
            this.command({ type: 'toggleRoom', roomId, enabled }),
          close: () => this.setTablet(false),
        },
        debug: {
          run: (cmd: string) => this.console(cmd),
          samples: () => this.metrics.samples,
        },
        build: {
          select: (id: string) => {
            this.build.selected = id;
            this.lastBuildJson = '';
          },
          action: (a: BuildAction) => this.triggerBuild(a),
          close: () => this.setBuild(false),
        },
        hud: {
          pickFloor: (f: number) => {
            this.command({ type: 'callElevator', floor: f });
            this.closePicker();
          },
          closePicker: () => this.closePicker(),
          resume: () => this.input.requestLock(),
        },
        pause: {
          resume: () => this.closePause(),
          copyLink: () => {
            const url = `${location.origin}${location.pathname}?seed=${encodeURIComponent(this.seed)}`;
            navigator.clipboard?.writeText(url).then(
              () => pushNotice('Link copied'),
              () => pushNotice(url),
            );
          },
          applySettings: (s: Settings) => this.applySettings(s),
          save: () => this.saveHooks.save(),
          load: () => this.saveHooks.load(),
          exportSave: () => this.saveHooks.exportSave(),
          importSave: () => this.saveHooks.importSave(),
          newGame: (seed: string) => {
            location.search = `?seed=${encodeURIComponent(seed.trim() || DEFAULT_SEED)}`;
          },
        },
      }),
      root,
    );
  }

  /** Save/load wiring (filled in by app/saves.ts). */
  saveHooks = {
    save: () => pushNotice('Saving arrives in M1.8'),
    load: () => pushNotice('Loading arrives in M1.8'),
    exportSave: () => pushNotice('Export arrives in M1.8'),
    importSave: () => pushNotice('Import arrives in M1.8'),
  };

  applySettings(s: Settings): void {
    this.input.settings = s;
    saveSettings(s);
    this.rig.camera.fov = s.fov;
    this.rig.camera.updateProjectionMatrix();
    const showTouch = s.touchControls === 'on' || (s.touchControls === 'auto' && isTouchDevice());
    this.touch.setVisible(showTouch);
    ui.set({ showTouch });
  }

  private speedBeforePause: Speed = 1;
  openPause(): void {
    if (ui.get().paused) return;
    this.speedBeforePause = this.runner.speed;
    this.runner.setSpeed(0);
    this.input.enabled = false;
    this.input.releaseLock();
    ui.set({ paused: true, prompt: null });
  }
  closePause(): void {
    ui.set({ paused: false });
    this.runner.setSpeed(this.speedBeforePause === 0 ? 1 : this.speedBeforePause);
    this.input.enabled = true;
    if (this.mode === 'player') this.input.requestLock();
  }

  private wireEvents(): void {
    const bus = this.runner.bus;
    bus.on('notice', (e) => pushNotice(e.text, e.severity));
    bus.on('command.rejected', (e) => {
      if (e.command !== 'holdElevator') pushNotice(e.reason, 'warn');
    });
    bus.on('power.brownout', (e) =>
      pushNotice(`Brownout: priority ${e.shedPriority}+ rooms lost power`, 'danger'),
    );
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
    this.input.lockOnClick = mode === 'player';
    ui.set({ mode });
    if (mode === 'overview') {
      this.releasingLock = this.input.locked;
      this.input.releaseLock();
      this.overview.floor = Math.max(0.5, this.player.floor);
      this.interactor.highlight.visible = false;
      ui.set({ prompt: null });
    }
  }

  tabletOpen = false;
  setTablet(on: boolean): void {
    this.tabletOpen = on;
    this.input.enabled = !on;
    if (on) {
      this.releasingLock = this.input.locked;
      this.input.releaseLock();
      ui.set({ tablet: buildTabletView(this.world), prompt: null });
    } else {
      ui.set({ tablet: null });
      if (this.mode === 'player') this.input.requestLock();
    }
  }

  cycleOverlay(): void {
    const order = ['none', 'power', 'heat'] as const;
    this.bunker.overlay = order[(order.indexOf(this.bunker.overlay) + 1) % order.length]!;
    this.uiAcc = 1;
  }

  /** Pushes resource + debug views to the UI (4 Hz). */
  private updateUi(dt: number): void {
    this.fpsFrames++;
    this.fpsAcc += dt;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsFrames = 0;
      this.fpsAcc = 0;
    }
    this.uiAcc += dt;
    if (this.uiAcc < 0.25) return;
    this.uiAcc = 0;
    const st = this.world.state;
    const temps = st.rooms.filter((r) => !r.damaged).map((r) => r.temp);
    ui.set({
      resources: {
        clock: formatClock(st.tick),
        speed: this.runner.speed,
        effective: this.runner.effectiveSpeed * 1,
        power: { produced: st.power.produced, demand: st.power.demand, shed: st.power.shedFrom },
        heat: {
          min: temps.length ? Math.min(...temps) : st.outsideTemp,
          avg: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : st.outsideTemp,
          outside: st.outsideTemp,
        },
        co2: st.co2,
        co2Bad: this.world.defs.balance.co2Bad,
        water: st.store.water ?? 0,
        waterTrend: this.metrics.trend('water'),
        food: foodTotal(this.world),
        foodTrend: this.metrics.trend('food'),
        store: { used: storeUsed(this.world), cap: storeCapacity(this.world) },
        overlay: this.bunker.overlay,
      },
    });
    if (this.tabletOpen) ui.set({ tablet: buildTabletView(this.world) });
    if (this.debugOpen) {
      const info = this.rig.renderer.info;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      ui.set({
        debug: {
          fps: this.fps,
          frameMs: this.frameMs,
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          simMsPerTick: this.runner.lastTickMs,
          tick: st.tick,
          entities: `rooms ${st.rooms.length} · survivors ${st.survivors.length} · machines ${st.machines.length} · lanes ${st.lanes.length}`,
          heapMb: mem ? mem.usedJSHeapSize / 1048576 : null,
        },
      });
    }
  }

  /** Debug console. */
  console(line: string): string {
    const [cmd, ...args] = line.split(/\s+/);
    const st = this.world.state;
    switch (cmd) {
      case 'help':
        return 'speed <0|0.5|1|4|10|100> · give <item> <qty> · unlock [all|slotId] · tp <floor> · noclip · overlay · survivors · seed';
      case 'speed':
        this.runner.setSpeed(Number(args[0]) as SpeedT);
        return `speed x${args[0]}`;
      case 'give': {
        const item = args[0] ?? 'scrap';
        if (!this.world.defs.items[item]) return `unknown item ${item}`;
        this.command({ type: 'debug.give', items: [{ item, qty: Number(args[1] ?? 50) }] });
        return `gave ${args[1] ?? 50} ${item}`;
      }
      case 'unlock': {
        const ids =
          args[0] && args[0] !== 'all'
            ? [Number(args[0])]
            : st.slots
                .filter((s) => s.state === 'sealed' && s.floor < 10 && s.seal?.hiddenRoom !== 'airlock')
                .map((s) => s.id);
        for (const id of ids) this.command({ type: 'debug.unlockSlot', slotId: id });
        return `unlocked ${ids.length} slot(s)`;
      }
      case 'tp': {
        const f = Number(args[0] ?? 0);
        this.player.teleport(0.6, floorY(f), -2.6, this.player.yaw);
        return `teleported to floor ${f + 1}`;
      }
      case 'noclip':
        this.player.noclip = !this.player.noclip;
        return `noclip ${this.player.noclip ? 'on' : 'off'}`;
      case 'overlay':
        this.cycleOverlay();
        return `overlay ${this.bunker.overlay}`;
      case 'survivors':
        return st.survivors
          .map(
            (s) =>
              `${s.name}: ${s.action} hp${s.health.toFixed(0)} hunger${s.needs.hunger!.toFixed(0)} thirst${s.needs.thirst!.toFixed(0)}`,
          )
          .join(' | ');
      case 'seed':
        return this.seed;
      default:
        return `unknown command: ${cmd}`;
    }
  }

  setBuild(on: boolean): void {
    this.build.active = on;
    this.lastBuildJson = '';
    if (!on) {
      ui.set({ build: null });
      this.build.ghost.visible = false;
    }
  }

  private cycleBuildType(dir: number): void {
    const opts = this.build.options();
    const i = opts.findIndex((o) => o.id === this.build.selected);
    this.build.selected = opts[(i + dir + opts.length) % opts.length]!.id;
    this.lastBuildJson = '';
  }

  private triggerBuild(a: BuildAction): void {
    const c = this.build.trigger(a);
    this.lastBuildJson = '';
    if (c) this.command(c);
    else if (a.id === 'demolish') pushNotice('Press demolish again to confirm', 'warn');
  }

  /** Per-frame build-mode update: target analysis -> UI (only when changed), ghost. */
  private updateBuild(): void {
    if (!this.build.active) return;
    const slotId =
      this.mode === 'overview' ? this.selectedSlot : this.target?.kind === 'cell' ? this.target.slotId : null;
    const info = this.build.analyze(slotId);
    this.build.updateGhost(info);
    const payload = { options: this.build.options(), selected: this.build.selected, target: info };
    const json = JSON.stringify(payload);
    if (json !== this.lastBuildJson) {
      this.lastBuildJson = json;
      ui.set({ build: payload });
    }
    const i = this.input;
    for (let d = 1; d <= 9; d++)
      if (i.codePressed(`Digit${d}`)) {
        const o = this.build.options()[d - 1];
        if (o) this.build.selected = o.id;
      }
    if (!info) return;
    const byKey = (k: string) => info.actions.find((a) => a.key === k);
    for (const k of ['U', 'M', 'R', 'X'])
      if (i.codePressed(`Key${k}`)) {
        const a = byKey(k);
        if (a) this.triggerBuild(a);
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
    for (let f = 0; f < GENERATED_FLOORS; f++)
      floors.push({ index: f, open: st.floors[f]!.state === 'open' });
    ui.set({ floorPicker: { floors, current: this.player.floor } });
    this.input.enabled = false;
    this.releasingLock = this.input.locked;
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
    this.lastClick = intent.click;
    // Step first: (re)built colliders and the car become queryable before the player moves.
    this.phys.step();
    if (this.mode === 'player') {
      this.player.lowestOpenFloor = this.lowestOpenFloor();
      this.player.update(intent, dt, carY, carDelta);
      const e = this.player.eye();
      const cam = this.rig.camera;
      cam.position.set(e.x, e.y, e.z);
      cam.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
      this.bunker.setFocus(this.player.floor);
      this.holdElevatorIfInDoorway();
      this.updateTarget();
    } else {
      this.updateOverviewCamera(intent, dt);
      if (intent.click) {
        const t = this.interactor.pick(this.rig.camera, [this.bunker.root], [], intent.click, 120);
        this.selectedSlot = t?.kind === 'cell' ? t.slotId : null;
        if (this.selectedSlot !== null && !this.build.active) this.setBuild(true);
      }
      const box = this.selectedSlot !== null ? this.cellBox(this.selectedSlot) : null;
      this.interactor.showHighlight(
        box ? { kind: 'cell', slotId: this.selectedSlot!, distance: 0 } : null,
        () => null,
        () => box,
      );
    }
    this.updateBuild();
    this.metrics.update();
    this.updateUi(dt);
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
    if (ui.get().paused) {
      if (i.codePressed('KeyP') || i.codePressed('Escape')) this.closePause();
      return;
    }
    if (this.tabletOpen && i.codePressed('Escape')) {
      this.setTablet(false);
      return;
    }
    if (i.wasPressed('pause')) {
      this.openPause();
      return;
    }
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
    if (i.wasPressed('overlay')) this.cycleOverlay();
    if (i.wasPressed('debug')) {
      this.debugOpen = !this.debugOpen;
      if (!this.debugOpen) ui.set({ debug: null });
    }
    if (i.wasPressed('tablet')) this.setTablet(!this.tabletOpen);
    if (this.tabletOpen) {
      if (i.codePressed('Escape')) this.setTablet(false);
      return;
    }
    if (i.wasPressed('build')) this.setBuild(!this.build.active);
    if (i.wasPressed('interact') || (this.build.active && this.mode === 'player' && this.lastClick)) {
      if (this.build.active) {
        const info = ui.get().build?.target;
        const a = info?.actions[0];
        if (a) this.triggerBuild(a);
      } else if (this.mode === 'player') this.interact();
    }
  }

  private holdElevatorIfInDoorway(): void {
    const p = this.player.position;
    const f = this.player.floor;
    const el = this.world.state.elevator;
    const inDoor = Math.abs(p.x) < 1.9 && p.z > -1.0 && p.z < 0.6;
    if (
      inDoor &&
      el.target === null &&
      Math.abs(el.pos - f) < 1e-6 &&
      el.doorTicks > 0 &&
      this.lastHoldTick !== this.world.state.tick
    ) {
      this.lastHoldTick = this.world.state.tick;
      this.command({ type: 'holdElevator', floor: f });
    }
  }

  private updateTarget(): void {
    const solids = [this.bunker.root];
    const inter = [
      ...this.panels.interactables(),
      this.actors.car.getObjectByName('elevator-panel')!,
      ...this.survivorMeshes(),
    ];
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
    if (t.kind === 'survivor')
      return this.survivorMeshes().find((o) => o.userData.survivorId === t.id)?.children[0] ?? null;
    if (t.kind === 'unsealFloor')
      return this.panels.interactables().find((o) => o.userData.interact?.kind === 'unsealFloor') ?? null;
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
          const cost = w.defs.balance.repairCostPerCell
            .map((c) => `${c.qty * r.slotIds.length} ${c.item}`)
            .join(', ');
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
        this.setTablet(true);
        break;
    }
  }

  private updateOverviewCamera(intent: ReturnType<InputManager['intent']>, dt: number): void {
    const o = this.overview;
    const want = this.build.active ? o.distance * 0.16 : 0;
    o.panelOffset += (want - o.panelOffset) * Math.min(1, dt * 8);
    const k = o.distance / 900;
    o.x = Math.max(-26, Math.min(26, o.x + intent.moveX * dt * 14 - intent.lookDX * k * 400));
    o.floor = Math.max(
      0,
      Math.min(GENERATED_FLOORS - 1, o.floor - intent.moveZ * dt * 2.5 - intent.lookDY * k * 100),
    );
    o.apply(this.rig.camera);
    this.bunker.setFocus(o.floor);
  }
}
