/**
 * Conveyor lanes, Factorio FFF #176 style: a lane stores the GAPS between items rather than item
 * positions. gaps[0] = distance from the lane END to the front item; gaps[i] = distance from item
 * i-1 to item i (behind it). Integer fixed-point units (UNITS_PER_M per metre).
 *
 * Per tick every item tries to move `speed`. Item i can move d_i = min(speed, gaps[i] - SPACING +
 * d_{i-1}) (front item: min(speed, gaps[0])). Once two consecutive items move a full `speed`, every
 * item behind them also moves freely, so the loop stops: a free-flowing lane costs O(1) and a
 * compressed lane costs O(number of items still closing gaps).
 */
import type { Lane } from '../core/state';

export const UNITS_PER_M = 256;
/** Minimum distance between item centres (item length on the belt). */
export const SPACING = Math.round(0.42 * UNITS_PER_M);

export function laneUsed(l: Lane): number {
  let s = 0;
  for (const g of l.gaps) s += g;
  return s;
}

/** Distance from the lane start to the last item (free space at the entry). */
export function laneTail(l: Lane): number {
  return l.length - laneUsed(l);
}

/** Can an item be inserted at the lane start right now? */
export function canInsert(l: Lane): boolean {
  return l.items.length === 0 ? l.length >= 0 : laneTail(l) >= SPACING;
}

export function insert(l: Lane, item: string): boolean {
  if (!canInsert(l)) return false;
  l.items.push(item);
  l.gaps.push(l.items.length === 1 ? l.length : laneTail(l));
  return true;
}

/** Is an item sitting at the very end, waiting to exit? */
export function frontReady(l: Lane): boolean {
  return l.items.length > 0 && l.gaps[0] === 0;
}

/** Removes and returns the front item (only when it has reached the end). */
export function takeFront(l: Lane): string | null {
  if (!frontReady(l)) return null;
  const item = l.items.shift()!;
  l.gaps.shift();
  return item;
}

export function advance(l: Lane): void {
  const n = l.gaps.length;
  if (n === 0) return;
  const speed = l.speed;
  let prev = Math.min(speed, l.gaps[0]!);
  l.gaps[0]! -= prev;
  for (let i = 1; i < n; i++) {
    const g = l.gaps[i]!;
    const d = Math.min(speed, g - SPACING + prev);
    const move = d < 0 ? 0 : d;
    l.gaps[i] = g + prev - move;
    if (prev === speed && move === speed) break; // everything behind flows freely
    prev = move;
  }
}

/** Item positions as distance from the lane START (for rendering). */
export function itemPositions(l: Lane, out: number[] = []): number[] {
  out.length = 0;
  let fromEnd = 0;
  for (let i = 0; i < l.gaps.length; i++) {
    fromEnd += l.gaps[i]!;
    out.push(l.length - fromEnd);
  }
  return out;
}
