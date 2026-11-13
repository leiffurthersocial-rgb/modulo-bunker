import type { World } from '../sim';
import { TICKS_PER_GAME_HOUR } from '../sim';
import { storeCapacity, storeUsed } from '../sim/core/store';

export interface Sample {
  tick: number;
  powerProduced: number;
  powerDemand: number;
  tempMin: number;
  tempAvg: number;
  outside: number;
  co2: number;
  water: number;
  food: number;
  store: number;
}

export const SERIES: { key: keyof Sample; label: string; color: string }[] = [
  { key: 'powerProduced', label: 'Power out kW', color: '#4fd1ff' },
  { key: 'powerDemand', label: 'Power demand kW', color: '#e0b73a' },
  { key: 'tempAvg', label: 'Avg temp °C', color: '#3fbf5f' },
  { key: 'tempMin', label: 'Min temp °C', color: '#2f5bd8' },
  { key: 'co2', label: 'CO2 ppm', color: '#9ad6c8' },
  { key: 'water', label: 'Water L', color: '#3fa9f5' },
  { key: 'food', label: 'Food portions', color: '#e8a33d' },
];

/** Food portions available now (meals + rations + produce). */
export function foodTotal(w: World): number {
  const s = w.state.store;
  return (s.meal ?? 0) + (s.ration ?? 0) + (s.produce ?? 0);
}

export function sample(w: World): Sample {
  const st = w.state;
  const temps = st.rooms.filter((r) => !r.damaged).map((r) => r.temp);
  return {
    tick: st.tick,
    powerProduced: st.power.produced,
    powerDemand: st.power.demand,
    tempMin: temps.length ? Math.min(...temps) : st.outsideTemp,
    tempAvg: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : st.outsideTemp,
    outside: st.outsideTemp,
    co2: st.co2,
    water: st.store.water ?? 0,
    food: foodTotal(w),
    store: storeUsed(w) / Math.max(1, storeCapacity(w)),
  };
}

/** Ring buffer of samples, one per game "sample interval" (10 game minutes). */
export class Metrics {
  readonly samples: Sample[] = [];
  readonly max = 24 * 6 * 3; // 3 game days at 10-minute resolution
  private lastTick = -Infinity;
  static readonly INTERVAL = TICKS_PER_GAME_HOUR / 6;

  constructor(private world: World) {}

  update(): void {
    const t = this.world.state.tick;
    if (t - this.lastTick < Metrics.INTERVAL) return;
    this.lastTick = t;
    this.samples.push(sample(this.world));
    if (this.samples.length > this.max) this.samples.shift();
  }

  /** Change per game hour over the last ~2 game hours (null until enough data). */
  trend(key: keyof Sample): number | null {
    const n = this.samples.length;
    if (n < 4) return null;
    const a = this.samples[Math.max(0, n - 13)]!;
    const b = this.samples[n - 1]!;
    const hours = (b.tick - a.tick) / TICKS_PER_GAME_HOUR;
    return hours > 0 ? ((b[key] as number) - (a[key] as number)) / hours : null;
  }
}
