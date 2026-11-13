/** Public sim API used by app/, render/, ui/, scripts/ and tests. */
import { loadDefs } from '../data';
import type { Defs } from '../data/types';
import { generateBunker } from '../gen/bunker';
import { World } from './core/world';
import { hashValue } from './core/hash';

export { World } from './core/world';
export { step, run } from './core/step';
export { applyCommand, checkCommand } from './core/commands';
export type { Command, CommandResult } from './core/commands';
export type { SimEvent } from './core/events';
export { EventBus } from './core/events';
export * from './core/time';

export function newWorld(seed: string, defs: Defs = loadDefs()): World {
  return new World(generateBunker(seed, defs), defs);
}

/** Deterministic hash of the full sim state (including RNG streams). */
export function stateHash(w: World): string {
  w.snapshotRng();
  return hashValue(w.state);
}
