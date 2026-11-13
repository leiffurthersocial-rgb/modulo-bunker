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

describe('commands on the pre-built bunker', () => {
  it('repair, upgrade and refit rooms', () => {
    const w = newWorld(SEED);
    w.state.store = { scrap: 200, parts: 100 };
    const bay = w.state.rooms.find((r) => r.type === 'empty')!;
    expect(applyCommand(w, { type: 'upgrade', roomId: bay.id }).ok).toBe(false);
    expect(applyCommand(w, { type: 'refit', roomId: bay.id, roomType: 'hydroponics' }).ok).toBe(true);
    expect(bay.type).toBe('hydroponics');
    expect(bay.tier).toBe(1);
    expect(applyCommand(w, { type: 'upgrade', roomId: bay.id }).ok).toBe(true);
    expect(bay.tier).toBe(2);
    expect(applyCommand(w, { type: 'refit', roomId: bay.id, roomType: 'airlock' }).ok).toBe(false);
    const broken = w.state.rooms.find((r) => r.damaged && w.roomOpen(r));
    if (broken) {
      expect(applyCommand(w, { type: 'upgrade', roomId: broken.id }).ok).toBe(false);
      expect(applyCommand(w, { type: 'repair', roomId: broken.id }).ok).toBe(true);
      expect(broken.damaged).toBe(false);
    }
  });

  it('rooms in sealed sections cannot be used; bulkheads open with their requirement', () => {
    const w = newWorld(SEED);
    const workshopSec = w.state.sections.find((s) => s.template === 'workshop')!;
    const room = w.state.rooms.find((r) => r.sectionId === workshopSec.id)!;
    expect(applyCommand(w, { type: 'repair', roomId: room.id })).toEqual({
      ok: false,
      reason: 'Section is sealed',
    });
    const bulk = w.state.links.find(
      (l) => l.sealed && [l.a, l.b].some((id) => w.cell(id)!.sectionId === workshopSec.id),
    )!;
    w.state.store = { scrap: 0, parts: 0 };
    expect(applyCommand(w, { type: 'openBulkhead', linkId: bulk.id }).ok).toBe(false);
    w.state.store = { scrap: 50, parts: 20 };
    expect(applyCommand(w, { type: 'openBulkhead', linkId: bulk.id }).ok).toBe(true);
    expect(workshopSec.open).toBe(true);
    const hatch = w.state.links.find((l) => l.seal?.kind === 'keycard')!;
    expect(applyCommand(w, { type: 'openBulkhead', linkId: hatch.id })).toEqual({
      ok: false,
      reason: 'Needs a keycard',
    });
  });

  it('power-sealed bulkheads need spare power', () => {
    const w = newWorld(SEED);
    run(w, 5);
    const deep = w.state.links.find((l) => l.seal?.label.startsWith('Deep'))!;
    w.state.store = { scrap: 50, parts: 20 };
    const r = applyCommand(w, { type: 'openBulkhead', linkId: deep.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/kW spare power/);
  });

  it('respects worker capacity', () => {
    const w = newWorld(SEED);
    const kitchen = w.state.rooms.find((r) => r.type === 'kitchen')!;
    const [s1, s2, s3] = w.state.survivors;
    expect(applyCommand(w, { type: 'assign', survivorId: s1!.id, roomId: kitchen.id }).ok).toBe(true);
    expect(applyCommand(w, { type: 'assign', survivorId: s2!.id, roomId: kitchen.id }).ok).toBe(true);
    expect(applyCommand(w, { type: 'assign', survivorId: s3!.id, roomId: kitchen.id }).ok).toBe(false);
    const quarters = w.state.rooms.find((r) => r.type === 'quarters')!;
    expect(applyCommand(w, { type: 'assign', survivorId: s3!.id, roomId: quarters.id }).ok).toBe(false);
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
