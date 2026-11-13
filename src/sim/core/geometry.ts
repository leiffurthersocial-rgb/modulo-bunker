/** Pure layout math shared by sim (pathing) and render (placement). */
import { GEO } from './state';
import type { Side } from './state';

/** Floor surface height (y) of floor index f (0 = top). */
export const floorY = (f: number): number => -f * GEO.floorPitch;

/** x of the inner edge (towards the shaft) of cell `index` on `side`. */
export function cellInnerX(side: Side, index: number): number {
  return side * (GEO.shaftWidth / 2 + index * GEO.cellWidth);
}
export function cellCenterX(side: Side, index: number): number {
  return side * (GEO.shaftWidth / 2 + index * GEO.cellWidth + GEO.cellWidth / 2);
}
/** x-range [min,max] covered by a run of cells on one side. */
export function cellsXRange(side: Side, indices: number[]): [number, number] {
  const lo = Math.min(...indices);
  const hi = Math.max(...indices);
  const a = cellInnerX(side, lo);
  const b = cellInnerX(side, hi + 1);
  return a < b ? [a, b] : [b, a];
}

/** The aisle survivors walk along (z) and the landing spot in front of the elevator. */
export const AISLE_Z = GEO.doorZ;
export const LANDING = { x: 0, z: -2.5 } as const;
export const ELEVATOR_DOOR = { x: 0, z: -0.6 } as const;

/** Side/index of the cell containing floor-local x, or null when in the shaft. */
export function cellAtX(x: number): { side: Side; index: number } | null {
  const ax = Math.abs(x) - GEO.shaftWidth / 2;
  if (ax < 0) return null;
  const index = Math.floor(ax / GEO.cellWidth);
  if (index >= GEO.cellsPerSide) return null;
  return { side: x < 0 ? -1 : 1, index };
}
