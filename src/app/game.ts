import { loadDefs } from '../data';
import { validateDefs } from '../data/validate';
import { newWorld } from '../sim';
import type { World } from '../sim';
import { SimRunner } from './simRunner';
import { SceneRig } from '../render/scene';
import { BunkerView } from '../render/bunkerView';
import { ActorsView } from '../render/actorsView';
import { OverviewCamera } from '../render/overviewCamera';

export const DEFAULT_SEED = 'ember-07';

export type CameraMode = 'overview' | 'player';

/** Owns the world, the runner and the views; drives the frame loop. */
export class Game {
  readonly world: World;
  readonly runner: SimRunner;
  readonly rig: SceneRig;
  readonly bunker: BunkerView;
  readonly actors: ActorsView;
  readonly overview = new OverviewCamera();
  mode: CameraMode = 'overview';
  private last = performance.now();
  private frameHooks: ((dt: number) => void)[] = [];
  frameMs = 0;

  constructor(
    container: HTMLElement,
    readonly seed: string,
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
    this.actors = new ActorsView(this.world);
    this.rig.scene.add(this.bunker.root, this.actors.root);
    this.setMode('overview');
  }

  onFrame(fn: (dt: number) => void): void {
    this.frameHooks.push(fn);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.bunker.setOverview(mode === 'overview');
  }

  start(): void {
    this.rig.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    this.runner.update(dt);
    this.bunker.sync();
    this.bunker.update();
    this.actors.update(this.runner.prev, this.runner.cur, this.runner.alpha);
    for (const h of this.frameHooks) h(dt);
    if (this.mode === 'overview') {
      this.overview.apply(this.rig.camera);
      this.bunker.setFocus(this.overview.floor);
    }
    this.rig.render();
    this.frameMs = performance.now() - t0;
  }
}
