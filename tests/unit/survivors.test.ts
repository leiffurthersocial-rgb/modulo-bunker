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

  it('reaches assigned rooms on every core level (corridors, ladder, elevator) and works there', () => {
    const w0 = newWorld(SEED);
    const workRooms = w0.state.rooms.filter((r) => {
      const def = w0.defs.rooms[r.type]!;
      return !r.damaged && w0.roomOpen(r) && def.tiers[r.tier - 1]!.workersPerCell > 0;
    });
    const levels = new Set(workRooms.map((r) => Math.max(...r.cellIds.map((id) => w0.cell(id)!.y))));
    expect(levels.size).toBeGreaterThan(1);
    for (const target of workRooms) {
      const w = newWorld(SEED);
      fill(w);
      const room = w.room(target.id)!;
      const s = w.state.survivors[0]!;
      expect(applyCommand(w, { type: 'assign', survivorId: s.id, roomId: room.id }).ok).toBe(true);
      w.state.tick = 8 * 600; // daytime
      const used = until(
        w,
        () => {
          fill(w);
          return s.action === 'work' && s.path.length === 0 && isInRoom(w, s, room);
        },
        5000,
      );
      expect(used, `room ${room.type}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('elevator refuses levels outside its shaft and broken shafts', () => {
    const w = newWorld(SEED);
    const sh = w.state.shafts.find((x) => x.kind === 'elevator')!;
    expect(applyCommand(w, { type: 'callElevator', shaftId: sh.id, level: sh.bottom + 1 }).ok).toBe(false);
    sh.broken = true;
    expect(applyCommand(w, { type: 'callElevator', shaftId: sh.id, level: sh.top }).ok).toBe(false);
  });
});
