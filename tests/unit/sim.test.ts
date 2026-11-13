import { describe, expect, it } from 'vitest';
import { applyCommand, newWorld, run, stateHash, step, TICKS_PER_GAME_DAY } from '../../src/sim';
import type { Command } from '../../src/sim';
import { SEED, autoAssign, runWith } from './helpers';

describe('determinism', () => {
  it('same seed + same commands => same state hash after 10k ticks', () => {
    const script = (w: Parameters<typeof autoAssign>[0], t: number): Command[] =>
      t === 0 ? autoAssign(w) : [];
    const a = runWith(SEED, 10_000, script);
    const b = runWith(SEED, 10_000, script);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.state.tick).toBe(10_000);
  });
  it('different seeds diverge', () => {
    expect(stateHash(runWith('x1', 100))).not.toBe(stateHash(runWith('x2', 100)));
  });
});

describe('commands', () => {
  it('build, upgrade, merge, demolish a room', () => {
    const w = newWorld(SEED);
    w.state.store = { scrap: 150, parts: 60 };
    const empties = w.state.slots.filter(
      (s) => s.state === 'empty' && w.state.floors[s.floor]!.state === 'open',
    );
    // Find two adjacent empty cells.
    const a = empties.find((s) =>
      empties.some((t) => t.floor === s.floor && t.side === s.side && t.index === s.index + 1),
    )!;
    const b = empties.find((t) => t.floor === a.floor && t.side === a.side && t.index === a.index + 1)!;
    expect(applyCommand(w, { type: 'build', slotId: a.id, roomType: 'common' }).ok).toBe(true);
    expect(applyCommand(w, { type: 'build', slotId: b.id, roomType: 'common' }).ok).toBe(true);
    const ra = w.room(a.roomId)!;
    const rb = w.room(b.roomId)!;
    expect(applyCommand(w, { type: 'upgrade', roomId: ra.id }).ok).toBe(true);
    expect(applyCommand(w, { type: 'merge', roomId: ra.id, otherRoomId: rb.id })).toEqual({
      ok: false,
      reason: 'Upgrade both to the same tier first',
    });
    expect(applyCommand(w, { type: 'upgrade', roomId: rb.id }).ok).toBe(true);
    expect(applyCommand(w, { type: 'merge', roomId: ra.id, otherRoomId: rb.id }).ok).toBe(true);
    const merged = w.room(Math.min(ra.id, rb.id))!;
    expect(merged.slotIds).toHaveLength(2);
    expect(w.state.rooms.find((r) => r.id === Math.max(ra.id, rb.id))).toBeUndefined();
    const scrapBefore = w.state.store.scrap!;
    expect(applyCommand(w, { type: 'demolish', roomId: merged.id }).ok).toBe(true);
    expect(w.state.store.scrap!).toBeGreaterThan(scrapBefore);
    expect(w.slot(a.id)!.state).toBe('empty');
  });

  it('rejects building on rock, sealed cells and without materials', () => {
    const w = newWorld(SEED);
    const rock = w.state.slots.find((s) => s.state === 'rock')!;
    expect(applyCommand(w, { type: 'build', slotId: rock.id, roomType: 'common' }).ok).toBe(false);
    const empty = w.state.slots.find(
      (s) => s.state === 'empty' && w.state.floors[s.floor]!.state === 'open',
    )!;
    w.state.store.scrap = 0;
    expect(applyCommand(w, { type: 'build', slotId: empty.id, roomType: 'common' })).toEqual({
      ok: false,
      reason: 'Not enough materials',
    });
    expect(w.outbox.some((e) => e.type === 'command.rejected')).toBe(true);
  });

  it('respects worker capacity', () => {
    const w = newWorld(SEED);
    const kitchen = w.state.rooms.find((r) => r.type === 'kitchen')!;
    const [s1, s2] = w.state.survivors;
    expect(applyCommand(w, { type: 'assign', survivorId: s1!.id, roomId: kitchen.id }).ok).toBe(true);
    expect(applyCommand(w, { type: 'assign', survivorId: s2!.id, roomId: kitchen.id }).ok).toBe(false);
    const quarters = w.state.rooms.find((r) => r.type === 'quarters')!;
    expect(applyCommand(w, { type: 'assign', survivorId: s2!.id, roomId: quarters.id }).ok).toBe(false);
  });
});

describe('invariants over 3 game days', () => {
  it('no negative store, temps and co2 finite, needs in range', () => {
    const w = newWorld(SEED);
    step(w, autoAssign(w));
    for (let d = 0; d < 3; d++) {
      run(w, TICKS_PER_GAME_DAY);
      for (const [k, v] of Object.entries(w.state.store)) expect(v, k).toBeGreaterThanOrEqual(0);
      for (const r of w.state.rooms) expect(Number.isFinite(r.temp)).toBe(true);
      expect(Number.isFinite(w.state.co2)).toBe(true);
      for (const s of w.state.survivors) {
        for (const v of Object.values(s.needs)) expect(v >= 0 && v <= 100).toBe(true);
        expect(s.health >= 0 && s.health <= 100).toBe(true);
      }
    }
  });
});
