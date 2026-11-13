/**
 * Fixed-step driver for the sim (Gaffer "Fix Your Timestep"): the frame produces real time, the
 * sim consumes it in 0.1 s ticks scaled by the game speed. A wall-clock budget per frame prevents
 * the spiral of death; when exceeded, backlog is dropped and the effective speed is reported.
 */
import { EventBus, SPEEDS, TICK_REAL_SECONDS, applyCommand, step } from '../sim';
import type { Command, Speed, World } from '../sim';

export interface Snapshot {
  /** y is a (fractional) level. */
  survivors: { id: number; x: number; z: number; y: number }[];
  /** Car position (level) per elevator shaft id. */
  elevators: Record<number, number>;
}

export class SimRunner {
  readonly bus = new EventBus();
  speed: Speed = 1;
  /** Speed to restore when unpausing. */
  private lastSpeed: Speed = 1;
  private acc = 0;
  private queue: Command[] = [];
  /** ms of wall-clock allowed per frame for ticking. */
  budgetMs = 6;
  /** Effective ticks per second measured over the last second. */
  effectiveSpeed = 1;
  lastTickMs = 0;
  private ticksThisSecond = 0;
  private secondAcc = 0;
  prev: Snapshot;
  cur: Snapshot;
  /** Interpolation factor between prev and cur (0..1). */
  alpha = 0;
  private listeners = new Set<() => void>();

  constructor(public world: World) {
    this.cur = this.snapshot();
    this.prev = this.cur;
  }

  /** Queue a command for the next tick (works while paused: applied immediately). */
  command(c: Command): void {
    if (this.speed === 0) {
      // Apply immediately so building while paused gives feedback.
      applyCommand(this.world, c);
      this.flush();
    } else this.queue.push(c);
  }

  setSpeed(s: Speed): void {
    if (s !== 0) this.lastSpeed = s;
    this.speed = s;
    this.acc = 0;
  }
  togglePause(): void {
    this.setSpeed(this.speed === 0 ? this.lastSpeed : 0);
  }
  cycleSpeed(dir: 1 | -1): void {
    const i = SPEEDS.indexOf(this.speed);
    const n = Math.min(SPEEDS.length - 1, Math.max(1, i + dir));
    this.setSpeed(SPEEDS[n]!);
  }

  onTick(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Advance by real seconds `dt`. Returns ticks run. */
  update(dt: number): number {
    const clamped = Math.min(dt, 0.25);
    this.secondAcc += clamped;
    if (this.secondAcc >= 1) {
      this.effectiveSpeed = this.ticksThisSecond / this.secondAcc / (1 / TICK_REAL_SECONDS);
      this.ticksThisSecond = 0;
      this.secondAcc = 0;
    }
    if (this.speed === 0) {
      this.alpha = 1;
      return 0;
    }
    this.acc += clamped * this.speed;
    const t0 = performance.now();
    let n = 0;
    while (this.acc >= TICK_REAL_SECONDS) {
      if (n > 0) this.prev = this.cur;
      else this.prev = this.snapshot();
      step(this.world, this.queue);
      this.queue = [];
      this.acc -= TICK_REAL_SECONDS;
      n++;
      this.flush();
      if (performance.now() - t0 > this.budgetMs) {
        this.acc = 0; // drop backlog: slow down rather than spiral
        break;
      }
    }
    if (n > 0) {
      this.cur = this.snapshot();
      this.lastTickMs = (performance.now() - t0) / n;
      this.listeners.forEach((f) => f());
    }
    this.ticksThisSecond += n;
    this.alpha = this.speed > 10 ? 1 : Math.min(1, this.acc / TICK_REAL_SECONDS);
    return n;
  }

  private flush(): void {
    const out = this.world.outbox;
    if (out.length === 0) return;
    this.world.outbox = [];
    for (const e of out) this.bus.emit(e);
  }

  private snapshot(): Snapshot {
    const st = this.world.state;
    const elevators: Record<number, number> = {};
    for (const e of st.elevators) elevators[e.shaftId] = e.pos;
    return {
      survivors: st.survivors.map((s) => ({
        id: s.id,
        x: s.x,
        z: s.z,
        y:
          s.elevator === 'riding' && s.elevatorId !== null
            ? (elevators[s.elevatorId] ?? s.level)
            : (s.climb ?? s.level),
      })),
      elevators,
    };
  }
}
