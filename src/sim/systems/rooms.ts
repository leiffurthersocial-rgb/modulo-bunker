/**
 * Power grid, room production, heating loop, air. Runs once per tick, in that order.
 * Exact arithmetic only (+ - * / sqrt min max) for determinism.
 */
import type { RoomDef, RoomEffect, RoomTierDef } from '../../data/types';
import { DT_HOURS, GAME_SECONDS_PER_TICK, TICKS_PER_GAME_DAY } from '../core/time';
import { cellOfPoint } from './nav';
import type { Room, Survivor } from '../core/state';
import { give, has, take } from '../core/store';
import type { World } from '../core/world';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface RoomInfo {
  def: RoomDef;
  tier: RoomTierDef;
  cells: number;
  merge: number;
  /** 0..1.25 effective staffing (skill-weighted, present workers / capacity). */
  staffing: number;
  /** Is the room doing anything at all. */
  active: boolean;
}

export function roomInfo(w: World, r: Room): RoomInfo {
  const def = w.defs.rooms[r.type]!;
  const tier = def.tiers[r.tier - 1]!;
  const cells = r.cellIds.length;
  return {
    def,
    tier,
    cells,
    merge: sizeBonus(def, cells),
    staffing: staffingOf(w, r, def, tier, cells),
    active: !r.damaged && r.enabled && w.roomOpen(r),
  };
}

/**
 * Size multiplier for production. Rooms come pre-built in 1..4+ cells; bigger halls are more
 * efficient per cell (data: mergeBonus for 1..3 cells, extrapolated linearly beyond).
 */
export function sizeBonus(def: RoomDef, cells: number): number {
  return cells <= 3 ? def.mergeBonus[cells - 1]! : (def.mergeBonus[2] * cells) / 3;
}

/** True if the survivor is physically inside the room. */
export function isInRoom(w: World, s: Survivor, r: Room): boolean {
  if (s.elevator === 'riding' || s.climb !== undefined) return false;
  const c = cellOfPoint(w, s.level, s.x, s.z);
  return !!c && c.roomId === r.id;
}

function staffingOf(w: World, r: Room, def: RoomDef, tier: RoomTierDef, cells: number): number {
  const cap = tier.workersPerCell * cells;
  if (cap === 0) return 1;
  let sum = 0;
  for (const id of r.workers) {
    const s = w.survivor(id);
    if (!s || s.action !== 'work' || s.actionTarget !== r.id || !isInRoom(w, s, r)) continue;
    const skill = def.skill ? (s.skills[def.skill] ?? 1) : 4;
    sum += 0.6 + 0.08 * skill;
  }
  return Math.min(1.25, sum / cap);
}

/** Output scale for an effect: unstaffed baseline for infrastructure, 0 for manual processes. */
function staffScale(e: RoomEffect, info: RoomInfo): number {
  if (info.tier.workersPerCell === 0) return 1;
  const base = e.type === 'process' ? (e.unstaffed ?? 0) : 0.5;
  return base + (1 - base) * info.staffing;
}

export function stepPower(w: World): void {
  const st = w.state;
  let produced = 0;
  // Demand per priority level (index 1..4).
  const demandBy = [0, 0, 0, 0, 0];
  const draws = new Map<number, number>();
  for (const r of st.rooms) {
    const info = roomInfo(w, r);
    if (!info.active) {
      draws.set(r.id, 0);
      continue;
    }
    for (const e of info.tier.effects)
      if (e.type === 'power') produced += e.kw * info.merge * staffScale(e, info);
    let d = (info.tier.powerDraw + w.defs.balance.baseCellDraw) * info.cells;
    for (const m of st.machines) if (m.roomId === r.id && m.enabled) d += w.defs.machines[m.type]!.powerDraw;
    draws.set(r.id, d);
    demandBy[r.priority] = (demandBy[r.priority] ?? 0) + d;
  }
  // Shed whole priority levels from 4 down until demand fits; level 1 may brown out partially.
  let shedFrom = 5;
  let total = demandBy[1]! + demandBy[2]! + demandBy[3]! + demandBy[4]!;
  while (shedFrom > 2 && total > produced) {
    shedFrom--;
    total -= demandBy[shedFrom]!;
  }
  // Fraction for the lowest surviving level when even level 1 alone does not fit.
  let frac = 1;
  if (total > produced) {
    shedFrom = 2;
    frac = demandBy[1]! > 0 ? produced / demandBy[1]! : 1;
  }
  for (const r of st.rooms) {
    const d = draws.get(r.id) ?? 0;
    if (d === 0) r.powered = r.damaged || !r.enabled ? 0 : 1;
    else r.powered = r.priority >= shedFrom ? 0 : r.priority === 1 ? frac : 1;
    for (const m of st.machines) if (m.roomId === r.id) m.powered = m.enabled ? r.powered : 0;
  }
  const prev = st.power.shedFrom;
  st.power.produced = produced;
  st.power.demand = demandBy[1]! + demandBy[2]! + demandBy[3]! + demandBy[4]!;
  st.power.shedFrom = frac < 1 ? 1 : shedFrom;
  if (st.power.shedFrom < prev) w.emit({ type: 'power.brownout', shedPriority: st.power.shedFrom });
  else if (st.power.shedFrom === 5 && prev !== 5) w.emit({ type: 'power.restored' });
}

/** Growth/efficiency multiplier from module temperature for temperature-sensitive rooms. */
export function tempFactor(r: Room, def: RoomDef): number {
  if (def.skill !== 'farming') return 1;
  // Crops: nothing below 4 °C, full at 18 °C.
  return clamp01((r.temp - 4) / 14);
}

export function stepProduction(w: World): void {
  const st = w.state;
  let scrubCap = 0;
  for (const r of st.rooms) {
    const info = roomInfo(w, r);
    if (!info.active || r.powered <= 0) continue;
    info.tier.effects.forEach((e, i) => {
      const s = staffScale(e, info) * r.powered;
      if (e.type === 'process') {
        const rate = e.perHour * info.merge * s * tempFactor(r, info.def);
        let p = (r.progress[i] ?? 0) + rate * DT_HOURS;
        while (p >= 1) {
          if (!has(w, e.inputs)) {
            p = 1;
            break;
          }
          take(w, e.inputs);
          give(w, e.outputs);
          p -= 1;
        }
        r.progress[i] = p;
      } else if (e.type === 'scrub') {
        let eff = 1;
        if (e.consumes) {
          const need = e.consumes.map((c) => ({ item: c.item, qty: c.qty * info.cells * DT_HOURS * s }));
          eff = take(w, need) ? 1 : 0.25;
        }
        scrubCap += e.perHour * info.merge * s * eff * DT_HOURS;
      }
    });
  }
  // Air: CO2 accumulates from people, normalized by open air volume (in cells).
  const b = w.defs.balance;
  const cells = st.cells.filter((c) => w.cellOpen(c)).length;
  const people = st.survivors.length + 1; // + the player
  st.co2 += (people * b.co2PerPersonHour * DT_HOURS) / cells;
  st.co2 -= scrubCap / cells;
  if (st.co2 < b.co2Ambient) st.co2 = b.co2Ambient;
}

export function stepHeat(w: World): void {
  const st = w.state;
  const b = w.defs.balance;
  st.outsideTemp = Math.max(b.outsideTempMin, st.outsideTemp + b.outsideTempPerDay / TICKS_PER_GAME_DAY);
  const dt = GAME_SECONDS_PER_TICK;
  // Heating loop supply from boilers.
  let supply = 0;
  const infos = st.rooms.map((r) => roomInfo(w, r));
  st.rooms.forEach((r, k) => {
    const info = infos[k]!;
    if (!info.active || r.powered <= 0) return;
    for (const e of info.tier.effects)
      if (e.type === 'heatSupply') supply += e.kw * info.merge * staffScale(e, info) * r.powered;
  });
  // Demand: kW to cover leak + close the comfort gap over ~1 game hour.
  const demand = st.rooms.map((r, k) => {
    const info = infos[k]!;
    const C = b.cellHeatCapacity * info.cells;
    const leak = b.cellLeakKwPerC * info.cells * (r.temp - st.outsideTemp);
    if (!w.roomOpen(r)) return 0;
    return Math.max(0, ((b.comfortTemp - r.temp) * C) / 3600 + leak);
  });
  const totalDemand = demand.reduce((a, x) => a + x, 0);
  const share = totalDemand > 0 ? Math.min(1, supply / totalDemand) : 0;
  st.rooms.forEach((r, k) => {
    const info = infos[k]!;
    const C = b.cellHeatCapacity * info.cells;
    const leak = b.cellLeakKwPerC * info.cells * (r.temp - st.outsideTemp);
    const waste = info.active ? info.tier.wasteHeat * info.cells * r.powered : 0;
    let bodies = 0;
    for (const s of st.survivors) if (isInRoom(w, s, r)) bodies += 0.1;
    const q = demand[k]! * share + waste + bodies - leak; // kW = kJ/s
    r.temp += (q * dt) / C;
  });
}

export function stepSpoilage(w: World): void {
  for (const [id, qty] of Object.entries(w.state.store)) {
    const spoil = w.defs.items[id]?.spoilPerDay;
    if (spoil && qty > 0) w.state.store[id] = qty * (1 - spoil / TICKS_PER_GAME_DAY);
  }
}
