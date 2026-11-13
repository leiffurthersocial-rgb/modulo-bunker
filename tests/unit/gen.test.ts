import { describe, expect, it } from 'vitest';
import { loadDefs } from '../../src/data';
import { generateBunker, START_FLOORS_OPEN } from '../../src/gen/bunker';
import { hashValue } from '../../src/sim/core/hash';

const defs = loadDefs();
const seeds = Array.from({ length: 50 }, (_, i) => `seed-${i}`);

describe('bunker generation', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(hashValue(generateBunker('ember-07', defs))).toBe(hashValue(generateBunker('ember-07', defs)));
    expect(hashValue(generateBunker('a', defs))).not.toBe(hashValue(generateBunker('b', defs)));
  });

  it.each(seeds)('%s: every open cell is reachable from the shaft (chain rule)', (seed) => {
    const st = generateBunker(seed, defs);
    for (let f = 0; f < START_FLOORS_OPEN; f++)
      for (const side of [-1, 1]) {
        const chain = st.slots
          .filter((s) => s.floor === f && s.side === side)
          .sort((a, b) => a.index - b.index);
        let blocked = false;
        for (const s of chain) {
          const passable = s.state === 'empty' || s.state === 'room';
          if (blocked) expect(passable, `${seed} f${f} side${side} i${s.index}`).toBe(false);
          if (!passable) blocked = true;
        }
      }
  });

  it.each(seeds)('%s: starts with the rooms needed to bootstrap', (seed) => {
    const st = generateBunker(seed, defs);
    const ok = (t: string) => st.rooms.some((r) => r.type === t && !r.damaged);
    for (const t of ['geothermal', 'boiler', 'water_plant', 'scrubber', 'quarters', 'kitchen'])
      expect(ok(t), t).toBe(true);
    const beds = st.rooms.filter((r) => r.type === 'quarters').reduce((n, r) => n + r.slotIds.length * 2, 0);
    expect(beds).toBeGreaterThanOrEqual(4);
    expect(st.survivors).toHaveLength(4);
    // Rooms only on open floors.
    for (const r of st.rooms) {
      const s = st.slots.find((x) => x.id === r.slotIds[0])!;
      expect(st.floors[s.floor]!.state).toBe('open');
    }
  });

  it('places exactly one sealed airlock on floor 0', () => {
    const st = generateBunker('ember-07', defs);
    const hatches = st.slots.filter((s) => s.seal?.hiddenRoom === 'airlock');
    expect(hatches).toHaveLength(1);
    expect(hatches[0]!.floor).toBe(0);
  });
});
