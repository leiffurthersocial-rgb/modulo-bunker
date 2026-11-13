import type { ItemStack } from '../../data/types';
import type { World } from './world';
import { sizeBonus } from '../systems/rooms';

/** Bunker store helpers. Quantities are floats; never negative. */
export function storeCapacity(w: World): number {
  let cap = w.defs.balance.baseStorage;
  for (const r of w.state.rooms) {
    if (r.damaged || !w.roomOpen(r)) continue;
    const def = w.defs.rooms[r.type]!;
    for (const e of def.tiers[r.tier - 1]!.effects)
      if (e.type === 'storage') cap += e.capacity * sizeBonus(def, r.cellIds.length);
  }
  return cap;
}

/** Items that do not count against capacity. */
const UNCOUNTED = new Set(['research']);

export function storeUsed(w: World): number {
  let used = 0;
  for (const [k, v] of Object.entries(w.state.store)) if (!UNCOUNTED.has(k)) used += v;
  return used;
}

export function has(w: World, stacks: ItemStack[], mult = 1): boolean {
  return stacks.every((s) => (w.state.store[s.item] ?? 0) + 1e-9 >= s.qty * mult);
}

export function take(w: World, stacks: ItemStack[], mult = 1): boolean {
  if (!has(w, stacks, mult)) return false;
  for (const s of stacks) w.state.store[s.item] = Math.max(0, (w.state.store[s.item] ?? 0) - s.qty * mult);
  return true;
}

/** Adds items up to capacity; returns the fraction that fit (0..1). */
export function give(w: World, stacks: ItemStack[], mult = 1): number {
  let total = 0;
  for (const s of stacks) if (!UNCOUNTED.has(s.item)) total += s.qty * mult;
  const free = Math.max(0, storeCapacity(w) - storeUsed(w));
  const frac = total <= 0 ? 1 : Math.min(1, free / total);
  for (const s of stacks) {
    const f = UNCOUNTED.has(s.item) ? 1 : frac;
    w.state.store[s.item] = (w.state.store[s.item] ?? 0) + s.qty * mult * f;
  }
  return frac;
}
