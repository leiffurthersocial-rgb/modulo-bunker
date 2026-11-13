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
import { LADDER_SIZE, cellCenter, cellX0, cellZ0, floorY } from '../sim/core/geometry';
import { GEO } from '../sim/core/state';
import { BuildMode } from './buildMode';
import type { BuildAction, ManageTarget } from './buildMode';
import { LogisticsView } from '../render/logisticsView';
import { wellOf } from '../render/actorsView';
import type { CarZone, LadderZone } from '../player/controller';
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
  /** Target selected by click/tap in overview mode. */
  selected: ManageTarget | null = null;
  readonly logistics: LogisticsView;
  private carLast = new Map<number, number>();
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
    this.bunker.onLevelBuilt = (y, boxes) => this.phys.setLevelBoxes(y, boxes);
    for (const [y, boxes] of this.bunker.colliders) this.phys.setLevelBoxes(y, boxes);
    this.logistics = new LogisticsView(this.world);
    this.actors = new ActorsView(this.world);
    this.panels = new PanelsView(this.world);
    this.interactor = new Interactor(this.world);
    this.build = new BuildMode(this.world);
    this.rig.scene.add(
      this.bunker.root,
      this.logistics.root,
      this.actors.root,
      this.panels.root,
      this.interactor.highlight,
      this.build.ghost,
    );
    this.rig.renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        if (this.mode === 'overview') {
          this.overview.distance = Math.max(10, Math.min(70, this.overview.distance + e.deltaY * 0.03));
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
    this.player.onFall = (level) => this.spawnPlayer(level);
    this.spawnPlayer(this.world.state.survivors[0]?.level ?? 0);
    const sp = this.player.position;
    this.overview.x = sp.x;
    this.overview.z = sp.z;
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
            const pk = ui.get().floorPicker;
            if (pk) this.command({ type: 'callElevator', shaftId: pk.shaftId, level: f });
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
      this.overview.level = this.player.level;
      const p = this.player.position;
      this.overview.x = p.x;
      this.overview.z = p.z;
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
    const temps = st.rooms.filter((r) => !r.damaged && this.world.roomOpen(r)).map((r) => r.temp);
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
        return 'speed <0|0.5|1|4|10|100> · give <item> <qty> · unlock (all sections) · keycard · tp <level> · noclip · overlay · survivors · seed';
      case 'speed':
        this.runner.setSpeed(Number(args[0]) as SpeedT);
        return `speed x${args[0]}`;
      case 'give': {
        const item = args[0] ?? 'scrap';
        if (!this.world.defs.items[item]) return `unknown item ${item}`;
        this.command({ type: 'debug.give', items: [{ item, qty: Number(args[1] ?? 50) }] });
        return `gave ${args[1] ?? 50} ${item}`;
      }
      case 'unlock':
        for (const s of st.sections) this.command({ type: 'debug.openSection', sectionId: s.id });
        return `opened ${st.sections.length} sections`;
      case 'keycard':
        this.command({ type: 'debug.setFlag', flag: 'keycard:any', value: true });
        return 'keycard granted';
      case 'tp': {
        this.spawnPlayer(Number(args[0] ?? 0));
        return `teleported to level ${Number(args[0] ?? 0) + 1}`;
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
              `${s.name}: ${s.action} L${s.level + 1} hp${s.health.toFixed(0)} hunger${s.needs.hunger!.toFixed(0)}`,
          )
          .join(' | ');
      case 'seed':
        return this.seed;
      default:
        return `unknown command: ${cmd}`;
    }
  }

  /** Puts the player in a walkable open cell on a level (corridor preferred). */
  spawnPlayer(level: number): void {
    const w = this.world;
    const cells = w.state.cells.filter((c) => c.y === level && w.cellOpen(c) && c.kind !== 'shaft');
    const c =
      cells.find((x) => x.kind === 'corridor') ?? cells[0] ?? w.state.cells.find((x) => w.cellOpen(x))!;
    const p = cellCenter(c);
    this.player.teleport(p.x + 0.7, floorY(c.y), p.z + 0.7, this.player.yaw);
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
    else if (a.id === 'remove') pushNotice('Press remove again to confirm', 'warn');
  }

  /** Current manage-mode target: overview selection, or what the crosshair is on. */
  private manageTarget(): ManageTarget | null {
    if (this.mode === 'overview') return this.selected;
    const t = this.target;
    if (!t) return null;
    if (t.kind === 'cell') {
      const p = this.player.position;
      return { kind: 'cell', cellId: t.cellId, point: { x: p.x, z: p.z } };
    }
    if (t.kind === 'bulkhead' || t.kind === 'shaft' || t.kind === 'machine') return t;
    return null;
  }

  /** Per-frame manage-mode update: target analysis -> UI (only when changed), highlight. */
  private updateBuild(): void {
    if (!this.build.active) return;
    const mt = this.manageTarget();
    const info = this.build.analyze(mt);
    this.build.updateGhost(mt);
    const payload = { options: this.build.options(), selected: this.build.selected, target: info };
    const json = JSON.stringify(payload);
    if (json !== this.lastBuildJson) {
      this.lastBuildJson = json;
      ui.set({ build: payload });
    }
    const i = this.input;
    if (!info) return;
    for (const a of info.actions)
      if (
        a.key &&
        a.key.length === 1 &&
        i.codePressed(/\d/.test(a.key) ? `Digit${a.key}` : `Key${a.key}`) &&
        a.key !== 'E'
      )
        this.triggerBuild(a);
  }

  private closePicker(): void {
    ui.set({ floorPicker: null });
    this.input.enabled = true;
    if (this.mode === 'player') this.input.requestLock();
  }

  private openPicker(shaftId: number): void {
    const w = this.world;
    const sh = w.shaft(shaftId)!;
    const floors = [];
    for (let y = sh.top; y <= sh.bottom; y++) {
      const cell = w.cellAt(sh.x, y, sh.z);
      const landing = !!cell && w.linksOf(cell.id).some((l) => !l.sealed);
      floors.push({ index: y, open: landing && !sh.broken });
    }
    ui.set({ floorPicker: { shaftId, floors, current: this.player.level } });
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
    this.logistics.update();
    this.actors.hideAbove = this.mode === 'overview' ? this.overview.level : null;
    this.actors.update(this.runner.prev, this.runner.cur, this.runner.alpha);
    this.updatePhysicsZones();

    const intent = this.input.intent();
    this.lastClick = intent.click;
    // Step first: (re)built colliders become queryable before the player moves.
    this.phys.step();
    if (this.mode === 'player') {
      this.player.update(intent, dt);
      const e = this.player.eye();
      const cam = this.rig.camera;
      cam.position.set(e.x, e.y, e.z);
      cam.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
      this.bunker.setFocus(this.player.level);
      this.holdElevatorIfInDoorway();
      this.updateTarget();
    } else {
      this.updateOverviewCamera(intent, dt);
      if (intent.click) {
        const t = this.interactor.pick(
          this.rig.camera,
          [this.bunker.root],
          [...this.panels.interactables(), ...this.logistics.interactables()],
          intent.click,
          150,
        );
        this.selected = this.toManage(t);
        if (this.selected && !this.build.active) this.setBuild(true);
      }
      if (!this.build.active) this.interactor.highlight.visible = false;
    }
    this.updateBuild();
    this.metrics.update();
    this.updateUi(dt);
    for (const fn of this.frameHooks) fn(dt);
    this.input.endFrame();
    this.rig.render();
    this.frameMs = performance.now() - t0;
  }

  private toManage(t: Target): ManageTarget | null {
    if (!t) return null;
    if (t.kind === 'cell') return { kind: 'cell', cellId: t.cellId };
    if (t.kind === 'bulkhead' || t.kind === 'shaft' || t.kind === 'machine') return t;
    if (t.kind === 'callButton' || t.kind === 'carPanel') return { kind: 'shaft', shaftId: t.shaftId };
    return null;
  }

  /** Elevator floors, gates and ladders for the player controller and physics. */
  private updatePhysicsZones(): void {
    const w = this.world;
    const cars: CarZone[] = [];
    for (const car of this.actors.cars) {
      const sh = w.shaft(car.shaftId)!;
      const well = wellOf(sh);
      const y = car.group.position.y;
      const last = this.carLast.get(car.shaftId) ?? y;
      this.carLast.set(car.shaftId, y);
      cars.push({ x0: well.x0, x1: well.x1, z0: well.z0, z1: well.z1, y, dy: y - last });
      for (const lvl of car.gates.keys()) {
        const gy = floorY(lvl);
        this.phys.setGate(
          `${sh.id}:${lvl}`,
          { x0: well.x0, x1: well.x1, y0: gy, y1: gy + 3, z0: well.z0 - 0.09, z1: well.z0 },
          this.actors.gateOpen(sh.id, lvl),
        );
      }
    }
    const ladders: LadderZone[] = w.state.shafts
      .filter((s) => s.kind === 'ladder' && !s.broken)
      .map((s) => ({
        x0: cellX0(s),
        x1: cellX0(s) + LADDER_SIZE,
        z0: cellZ0(s),
        z1: cellZ0(s) + LADDER_SIZE,
        bottom: floorY(s.bottom),
        top: floorY(s.top),
      }));
    this.player.cars = cars;
    this.player.ladders = ladders;
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
    const picker = ui.get().floorPicker;
    if (picker) {
      if (i.codePressed('Escape')) this.closePicker();
      for (let d = 1; d <= 9; d++)
        if (i.codePressed(`Digit${d}`)) {
          const f = picker.floors.find((x) => x.index === d - 1);
          if (f?.open) {
            this.command({ type: 'callElevator', shaftId: picker.shaftId, level: f.index });
            this.closePicker();
          }
        }
      return;
    }
    if (i.wasPressed('tablet')) this.setTablet(!this.tabletOpen);
    if (this.tabletOpen) return;
    if (i.wasPressed('overview')) this.setMode(this.mode === 'player' ? 'overview' : 'player');
    if (i.wasPressed('speedUp')) this.runner.cycleSpeed(1);
    if (i.wasPressed('speedDown')) this.runner.cycleSpeed(-1);
    if (i.wasPressed('overlay')) this.cycleOverlay();
    if (i.wasPressed('debug')) {
      this.debugOpen = !this.debugOpen;
      if (!this.debugOpen) ui.set({ debug: null });
    }
    if (i.wasPressed('build')) this.setBuild(!this.build.active);
    if (this.mode === 'overview') {
      if (i.codePressed('KeyQ')) this.overview.level = Math.max(0, this.overview.level - 1);
      if (i.codePressed('KeyE') && !this.build.active)
        this.overview.level = Math.min(this.bunker.maxLevel, this.overview.level + 1);
    }
    if (i.wasPressed('interact') || (this.build.active && this.mode === 'player' && this.lastClick)) {
      if (this.build.active) {
        const a = ui.get().build?.target?.actions.find((x) => x.ok) ?? ui.get().build?.target?.actions[0];
        if (a) this.triggerBuild(a);
      } else if (this.mode === 'player') this.interact();
    }
  }

  private holdElevatorIfInDoorway(): void {
    const p = this.player.position;
    for (const car of this.actors.cars) {
      const sh = this.world.shaft(car.shaftId)!;
      const well = wellOf(sh);
      const lvl = this.player.level;
      const el = this.world.elevator(sh.id)!;
      const inDoor = p.x > well.x0 && p.x < well.x1 && p.z > well.z0 - 0.8 && p.z < well.z0 + 0.6;
      if (
        inDoor &&
        el.target === null &&
        Math.abs(el.pos - lvl) < 1e-6 &&
        el.doorTicks > 0 &&
        this.lastHoldTick !== this.world.state.tick
      ) {
        this.lastHoldTick = this.world.state.tick;
        this.command({ type: 'holdElevator', shaftId: sh.id, level: lvl });
      }
    }
  }

  private updateTarget(): void {
    const inter = [
      ...this.panels.interactables(),
      ...this.actors.cars.map((c) => c.panel),
      ...this.survivorMeshes(),
      ...this.logistics.interactables(),
    ];
    this.target = this.input.enabled
      ? this.interactor.pick(this.rig.camera, [this.bunker.root], inter)
      : null;
    if (this.build.active || this.target?.kind === 'cell') this.interactor.highlight.visible = false;
    else
      this.interactor.showHighlight(
        this.target,
        (t) => this.objectFor(t),
        (cellId) => this.cellBox(cellId),
      );
    ui.set({ prompt: this.build.active ? null : this.promptFor(this.target) });
  }

  private survivorMeshes(): THREE.Object3D[] {
    return this.actors.root.children.filter((c) => c.userData.survivorId);
  }

  private objectFor(t: Target): THREE.Object3D | null {
    if (!t) return null;
    const find = (objs: THREE.Object3D[], pred: (o: THREE.Object3D) => boolean) => objs.find(pred) ?? null;
    switch (t.kind) {
      case 'callButton':
        return find(
          this.panels.callButtons,
          (o) => o.userData.interact.shaftId === t.shaftId && o.userData.interact.level === t.level,
        );
      case 'carPanel':
        return this.actors.cars.find((c) => c.shaftId === t.shaftId)?.panel ?? null;
      case 'survivor':
        return find(this.survivorMeshes(), (o) => o.userData.survivorId === t.id)?.children[0] ?? null;
      case 'machine':
        return find(this.logistics.interactables(), (o) => o.userData.interact.id === t.id);
      case 'bulkhead':
      case 'shaft':
        return find(this.panels.interactables(), (o) => {
          const it = o.userData.interact;
          return (
            it?.kind === t.kind && (t.kind === 'bulkhead' ? it.linkId === t.linkId : it.shaftId === t.shaftId)
          );
        });
      default:
        return null;
    }
  }

  cellBox(cellId: number): THREE.Box3 | null {
    const c = this.world.cell(cellId);
    if (!c) return null;
    const r = this.world.room(c.roomId);
    const cells = r ? r.cellIds.map((id) => this.world.cell(id)!) : [c];
    const box = this.tmpBox.makeEmpty();
    for (const cc of cells) {
      box.expandByPoint(new THREE.Vector3(cellX0(cc) + 0.05, floorY(cc.y) + 0.02, cellZ0(cc) + 0.05));
      box.expandByPoint(
        new THREE.Vector3(
          cellX0(cc) + GEO.cell - 0.05,
          floorY(cc.y) + GEO.cellHeight - 0.05,
          cellZ0(cc) + GEO.cell - 0.05,
        ),
      );
    }
    return box;
  }

  private promptFor(t: Target): string | null {
    if (!t) return null;
    const w = this.world;
    switch (t.kind) {
      case 'callButton':
        return 'E: call elevator';
      case 'carPanel':
        return 'E: choose level';
      case 'bulkhead': {
        const l = w.state.links.find((x) => x.id === t.linkId);
        return l?.seal ? `${l.seal.label}\nE: open (B for details)` : null;
      }
      case 'shaft':
        return 'Broken ladder · E: repair';
      case 'machine': {
        const m = w.state.machines.find((x) => x.id === t.id);
        return m ? `${w.defs.machines[m.type]!.name} · ${(m.progress * 100).toFixed(0)}%\nE: manage` : null;
      }
      case 'survivor': {
        const s = w.survivor(t.id)!;
        return `${s.name} · ${s.action} · health ${s.health.toFixed(0)}\nE: tablet`;
      }
      case 'cell': {
        const c = w.cell(t.cellId)!;
        const r = w.room(c.roomId);
        if (!r) return null;
        if (!w.roomOpen(r)) return `${w.defs.rooms[r.type]!.name} (sealed section)`;
        if (r.damaged) {
          const cost = w.defs.balance.repairCostPerCell
            .map((x) => `${x.qty * r.cellIds.length} ${x.item}`)
            .join(', ');
          return `${w.defs.rooms[r.type]!.name} (damaged)\nE: repair (${cost}) · B: manage`;
        }
        return `${w.defs.rooms[r.type]!.name} T${r.tier} · B: manage`;
      }
    }
  }

  private interact(): void {
    const t = this.target;
    if (!t) return;
    switch (t.kind) {
      case 'callButton':
        this.command({ type: 'callElevator', shaftId: t.shaftId, level: t.level });
        pushNotice('Elevator called');
        break;
      case 'carPanel':
        this.openPicker(t.shaftId);
        break;
      case 'bulkhead':
        this.command({ type: 'openBulkhead', linkId: t.linkId });
        break;
      case 'shaft':
        this.command({ type: 'repairShaft', shaftId: t.shaftId });
        break;
      case 'machine':
        this.setBuild(true);
        break;
      case 'cell': {
        const r = this.world.room(this.world.cell(t.cellId)?.roomId);
        if (r?.damaged) this.command({ type: 'repair', roomId: r.id });
        break;
      }
      case 'survivor':
        this.setTablet(true);
        break;
    }
  }

  private updateOverviewCamera(intent: ReturnType<InputManager['intent']>, dt: number): void {
    const o = this.overview;
    // Drag rotates (yaw) and tilts; WASD / stick pans; Q/E change level; wheel zooms.
    o.yaw -= intent.lookDX * 1.2;
    o.pitch = Math.max(0.45, Math.min(1.45, o.pitch + intent.lookDY * 1.2));
    o.pan(intent.moveX * dt * 16, intent.moveZ * dt * 16);
    o.apply(this.rig.camera);
    this.bunker.setFocus(o.level);
  }
}
