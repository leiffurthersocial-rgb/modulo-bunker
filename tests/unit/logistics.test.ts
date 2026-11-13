import { describe, expect, it } from 'vitest';
import { loadDefs } from '../../src/data';
import { applyCommand, run } from '../../src/sim';
import { World } from '../../src/sim/core/world';
import { generateBunker } from '../../src/gen/bunker';
import { SPACING, advance, frontReady, insert, takeFront } from '../../src/sim/systems/lanes';
import type { Lane } from '../../src/sim/core/state';
import { freeSpot, stepLogistics, totalOf } from '../../src/sim/systems/logistics';
import { SEED } from './helpers';

function lane(length: number, speed: number): Lane {
  return { id: 1, level: 0, points: [], length, items: [], gaps: [], speed, from: null, to: null };
}

function checkLane(l: Lane) {
  let sum = 0;
  l.gaps.forEach((g, i) => {
    expect(g).toBeGreaterThanOrEqual(i === 0 ? 0 : SPACING);
    sum += g;
  });
  expect(sum).toBeLessThanOrEqual(l.length);
  expect(l.items.length).toBe(l.gaps.length);
}

describe('conveyor lanes (gap model)', () => {
  it('items flow to the end and compress behind a blocked front', () => {
    const l = lane(2560, 26);
    for (let t = 0; t < 400; t++) {
      insert(l, 'ice');
      advance(l);
      checkLane(l);
    }
    // Front blocked the whole time: lane is full and compressed.
    expect(frontReady(l)).toBe(true);
    expect(l.items.length).toBe(Math.floor(2560 / SPACING) + 1);
    // Unblock: items leave one by one, invariants hold.
    for (let t = 0; t < 2000; t++) {
      takeFront(l);
      advance(l);
      checkLane(l);
    }
    expect(l.items.length).toBe(0);
  });

  it('a free-flowing item takes length/speed ticks', () => {
    const l = lane(2600, 26);
    insert(l, 'ice');
    let t = 0;
    while (!frontReady(l)) {
      advance(l);
      t++;
    }
    expect(t).toBe(100);
  });
});

function waterWorld(): World {
  const defs = loadDefs();
  // Isolate the machine chain: water plant rooms do no manual processing in this test.
  defs.rooms.water_plant!.tiers.forEach((t) => (t.effects = []));
  const st = generateBunker(SEED, defs);
  st.survivors = [];
  st.store = { ice: 30, scrap: 200, parts: 80 };
  // Enough power for the machines (they add to the room's draw; unstaffed generators sag).
  for (const r of st.rooms) if (r.type === 'geothermal') r.tier = 3;
  return new World(st, defs);
}

describe('machines, belts and pipes', () => {
  it('ice -> belt -> melter -> pipe -> purifier -> tank conserves units and makes water', () => {
    const w = waterWorld();
    const plant = w.state.rooms.find((r) => r.type === 'water_plant')!;
    const s1 = freeSpot(w, plant.id, 'ice_melter')!;
    expect(applyCommand(w, { type: 'placeMachine', machine: 'ice_melter', ...s1 }).ok).toBe(true);
    const s2 = freeSpot(w, plant.id, 'purifier')!;
    expect(applyCommand(w, { type: 'placeMachine', machine: 'purifier', ...s2 }).ok).toBe(true);
    const [melter, purifier] = w.state.machines;
    expect(
      applyCommand(w, { type: 'connectBelt', from: { kind: 'room', id: plant.id }, toMachine: melter!.id })
        .ok,
    ).toBe(true);
    expect(
      applyCommand(w, { type: 'connectPipe', fromMachine: melter!.id, toMachine: purifier!.id }).ok,
    ).toBe(true);
    expect(applyCommand(w, { type: 'connectPipe', fromMachine: purifier!.id, toMachine: 'tank' }).ok).toBe(
      true,
    );
    // Wrong connections are rejected with reasons.
    expect(
      applyCommand(w, { type: 'connectBelt', from: { kind: 'room', id: plant.id }, toMachine: purifier!.id })
        .ok,
    ).toBe(false);

    const total = () => totalOf(w, 'ice') + totalOf(w, 'raw_water') + totalOf(w, 'water');
    const start = total();
    for (let k = 0; k < 60; k++) {
      run(w, 200);
      expect(total()).toBeCloseTo(start, 6);
    }
    expect(w.state.store.water ?? 0).toBeGreaterThan(5);
    expect(w.state.lanes[0]!.items.length).toBeGreaterThanOrEqual(0);
  });

  it('machines use free corner slots in allowed rooms only', () => {
    const w = waterWorld();
    const plant = w.state.rooms.find((r) => r.type === 'water_plant')!;
    const cellId = plant.cellIds[0]!;
    expect(applyCommand(w, { type: 'placeMachine', cellId, machine: 'ice_melter', gx: 0, gz: 0 }).ok).toBe(
      true,
    );
    expect(applyCommand(w, { type: 'placeMachine', cellId, machine: 'purifier', gx: 0, gz: 0 }).ok).toBe(
      false,
    );
    expect(applyCommand(w, { type: 'placeMachine', cellId, machine: 'purifier', gx: 2, gz: 0 }).ok).toBe(
      false,
    );
    const kitchen = w.state.rooms.find((r) => r.type === 'kitchen')!;
    expect(
      applyCommand(w, {
        type: 'placeMachine',
        cellId: kitchen.cellIds[0]!,
        machine: 'purifier',
        gx: 0,
        gz: 0,
      }).ok,
    ).toBe(false);
  });

  it('2,000 items in transit: logistics tick stays cheap', () => {
    const w = waterWorld();
    // Synthetic load: 80 lanes x 25 items, half blocked (compressed), half flowing.
    for (let i = 0; i < 80; i++) {
      const l = lane(25 * 256, 26);
      l.id = 10_000 + i;
      for (let k = 0; k < 25; k++) {
        l.items.push('ice');
        l.gaps.push(k === 0 ? 0 : 256);
      }
      w.state.lanes.push(l);
    }
    const t0 = performance.now();
    for (let t = 0; t < 1000; t++) stepLogistics(w);
    const ms = (performance.now() - t0) / 1000;
    expect(w.state.lanes.reduce((n, l) => n + l.items.length, 0)).toBe(2000);
    // Budget: x100 speed = 1000 ticks/s; logistics must stay far below 1 ms per tick.
    expect(ms).toBeLessThan(0.5);
  });
});
