import { applyCommand } from './commands';
import type { Command } from './commands';
import type { World } from './world';
import { stepHeat, stepPower, stepProduction, stepSpoilage } from '../systems/rooms';
import { stepElevators, stepSurvivors } from '../systems/survivors';
import { stepLogistics } from '../systems/logistics';

/**
 * Advances the world by exactly one tick. Fixed system order:
 * commands -> power -> production/air -> heat -> logistics -> survivors -> elevator -> spoilage.
 */
export function step(w: World, commands: readonly Command[] = []): void {
  for (const c of commands) applyCommand(w, c);
  stepPower(w);
  stepProduction(w);
  stepHeat(w);
  stepLogistics(w);
  stepSurvivors(w);
  stepElevators(w);
  stepSpoilage(w);
  w.state.tick++;
}

/** Runs n ticks with no commands (tests, balance runner). */
export function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) step(w);
}
