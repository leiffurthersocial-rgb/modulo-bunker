import { describe, expect, it } from 'vitest';
import { applyCommand, newWorld, run, step } from '../../src/sim';
import type { World } from '../../src/sim';
import { isInRoom } from '../../src/sim/systems/rooms';
import { SEED } from './helpers';

function fill(w: World) {
  for (const s of w.state.survivors) for (const k of Object.keys(s.needs)) s.needs[k] = 100;
}

/** Runs until the predicate holds (or the tick budget runs out). Returns ticks used, or -1. */
function until(w: World, pred: () => boolean, max: number): number {
  for (let t = 0; t < max; t++) {
    if (pred()) return t;
    step(w);
  }
  return pred() ? max : -1;
}

describe('survivor utility AI', () => {
  it('a starving survivor eats instead of working', () => {
    const w = newWorld(SEED);
    fill(w);
    const s = w.state.survivors[0]!;
    const kitchen = w.state.rooms.find((r) => r.type === 'kitchen')!;
    applyCommand(w, { type: 'assign', survivorId: s.id, roomId: kitchen.id });
    s.needs.hunger = 5;
    run(w, 10);
    expect(s.action).toBe('eat');
    expect(until(w, () => s.needs.hunger! > 80, 3000)).toBeGreaterThanOrEqual(0);
  });

  it('a thirsty survivor drinks', () => {
    const w = newWorld(SEED);
    fill(w);
    const s = w.state.survivors[1]!;
    s.needs.thirst = 8;
    run(w, 10);
    expect(s.action).toBe('drink');
  });

  it('does not drink when there is no water (no impossible actions)', () => {
    const w = newWorld(SEED);
    fill(w);
    w.state.store.water = 0;
    const s = w.state.survivors[1]!;
    s.needs.thirst = 8;
    run(w, 10);
    expect(s.action).not.toBe('drink');
  });

  it('reaches an assigned room on every open floor (elevator pathing) and works there', () => {
    const w0 = newWorld(SEED);
    const floors = [...new Set(w0.state.rooms.map((r) => w0.slot(r.slotIds[0]!)!.floor))];
    expect(floors.length).toBeGreaterThan(1);
    for (const f of floors) {
      const w = newWorld(SEED);
      fill(w);
      const room = w.state.rooms.find((r) => {
        const def = w.defs.rooms[r.type]!;
        return !r.damaged && w.slot(r.slotIds[0]!)!.floor === f && def.tiers[r.tier - 1]!.workersPerCell > 0;
      });
      if (!room) continue;
      const s = w.state.survivors[0]!;
      expect(applyCommand(w, { type: 'assign', survivorId: s.id, roomId: room.id }).ok).toBe(true);
      // Keep needs topped up so only "work" matters; daytime start (tick 0 = 00:00 -> skip to 08:00).
      w.state.tick = 8 * 600;
      const used = until(
        w,
        () => {
          fill(w);
          return s.action === 'work' && s.path.length === 0 && isInRoom(w, s, room);
        },
        4000,
      );
      expect(used, `floor ${f} room ${room.type}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('elevator refuses sealed floors', () => {
    const w = newWorld(SEED);
    const sealed = w.state.floors.find((f) => f.state === 'sealed')!;
    expect(applyCommand(w, { type: 'callElevator', floor: sealed.index }).ok).toBe(false);
  });
});
