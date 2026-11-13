/** Pure layout math shared by sim (navigation) and render (placement). */
import { GEO } from './state';
import type { Cell } from './state';

/** Floor surface height (y) of a level (0 = top). Works with fractional levels (elevator cars). */
export const floorY = (level: number): number => -level * GEO.levelPitch;

export const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** World-space min corner of a cell's footprint. */
export const cellX0 = (c: { x: number }): number => c.x * GEO.cell;
export const cellZ0 = (c: { z: number }): number => c.z * GEO.cell;

export function cellCenter(c: { x: number; z: number }): { x: number; z: number } {
  return { x: c.x * GEO.cell + GEO.cell / 2, z: c.z * GEO.cell + GEO.cell / 2 };
}

/** Grid coordinates containing world point (x, z) on a level. */
export function gridAt(x: number, z: number): { x: number; z: number } {
  return { x: Math.floor(x / GEO.cell), z: Math.floor(z / GEO.cell) };
}

/** Level containing a world height (floor surface .. ceiling belongs to that level). */
export function levelAtY(y: number): number {
  return Math.floor((-y + GEO.cellHeight) / GEO.levelPitch);
}

export type Dir = '+x' | '-x' | '+z' | '-z';
export const DIRS: { d: Dir; dx: number; dz: number }[] = [
  { d: '+x', dx: 1, dz: 0 },
  { d: '-x', dx: -1, dz: 0 },
  { d: '+z', dx: 0, dz: 1 },
  { d: '-z', dx: 0, dz: -1 },
];

/** Midpoint of the doorway between two horizontally adjacent cells (world x/z). */
export function doorPoint(a: Cell, b: Cell): { x: number; z: number } {
  const ca = cellCenter(a);
  const cb = cellCenter(b);
  return { x: (ca.x + cb.x) / 2, z: (ca.z + cb.z) / 2 };
}

/** Elevator well inside a shaft cell (centre square) and the ladder column (a corner). */
export const WELL = { inset: 1.2 } as const;
export const LADDER_SIZE = 0.8;
