/** Sim time constants. See DECISIONS.md D-009. */
export const TICK_REAL_SECONDS = 0.1; // at x1
export const GAME_SECONDS_PER_TICK = 6; // 1 real s = 1 game min at x1
export const TICKS_PER_GAME_MINUTE = 60 / GAME_SECONDS_PER_TICK; // 10
export const TICKS_PER_GAME_HOUR = TICKS_PER_GAME_MINUTE * 60; // 600
export const TICKS_PER_GAME_DAY = TICKS_PER_GAME_HOUR * 24; // 14400
export const DT_HOURS = GAME_SECONDS_PER_TICK / 3600; // game hours per tick
export const AI_INTERVAL_TICKS = 5;

export const SPEEDS = [0, 0.5, 1, 4, 10, 100] as const;
export type Speed = (typeof SPEEDS)[number];

export interface GameClock {
  day: number; // 0-based
  hour: number;
  minute: number;
}
export function clockOf(tick: number): GameClock {
  const day = Math.floor(tick / TICKS_PER_GAME_DAY);
  const inDay = tick - day * TICKS_PER_GAME_DAY;
  const hour = Math.floor(inDay / TICKS_PER_GAME_HOUR);
  const minute = Math.floor((inDay - hour * TICKS_PER_GAME_HOUR) / TICKS_PER_GAME_MINUTE);
  return { day, hour, minute };
}
export function formatClock(tick: number): string {
  const c = clockOf(tick);
  return `Day ${c.day + 1} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}
