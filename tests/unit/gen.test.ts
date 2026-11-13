import { describe, expect, it } from 'vitest';
import { loadDefs } from '../../src/data';
import { SECTION_IDS, generateBunker } from '../../src/gen/bunker';
import { hashValue } from '../../src/sim/core/hash';
import { World } from '../../src/sim/core/world';
import { applyCommand } from '../../src/sim';
import { search, walkable } from '../../src/sim/systems/nav';

const defs = loadDefs();
const seeds = Array.from({ length: 40 }, (_, i) => `seed-${i}`);

function spawnCell(w: World) {
  const s = w.state.survivors[0]!;
  return w.cellAt(Math.floor(s.x / 6), s.level, Math.floor(s.z / 6))!;
}

describe('3D bunker generation', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(hashValue(generateBunker('ember-07', defs))).toBe(hashValue(generateBunker('ember-07', defs)));
    expect(hashValue(generateBunker('a', defs))).not.toBe(hashValue(generateBunker('b', defs)));
  });

  it.each(seeds)('%s: places every section, no overlapping cells, compact size', (seed) => {
    const st = generateBunker(seed, defs);
    expect(st.sections.map((s) => s.template).sort()).toEqual(['core', ...SECTION_IDS].sort());
    const keys = new Set(st.cells.map((c) => `${c.x},${c.y},${c.z}`));
    expect(keys.size).toBe(st.cells.length);
    expect(st.rooms.length).toBeGreaterThanOrEqual(15);
    expect(st.rooms.length).toBeLessThanOrEqual(35);
    expect(st.links.filter((l) => l.kind === 'bulkhead' && l.sealed)).toHaveLength(SECTION_IDS.length);
  });

  it.each(seeds)('%s: the open core is fully connected, and so is everything once unsealed', (seed) => {
    const w = new World(generateBunker(seed, defs), defs);
    const start = spawnCell(w);
    const coreWalk = w.state.cells.filter((c) => walkable(w, c));
    const reach = search(w, start.id).dist;
    for (const c of coreWalk) expect(reach.has(c.id), `core cell ${c.x},${c.y},${c.z}`).toBe(true);
    for (const s of w.state.sections) applyCommand(w, { type: 'debug.openSection', sectionId: s.id });
    for (const sh of w.state.shafts) sh.broken = false;
    w.markTopologyChanged();
    const all = search(w, start.id).dist;
    for (const c of w.state.cells.filter((c) => walkable(w, c)))
      expect(all.has(c.id), `cell ${c.x},${c.y},${c.z}`).toBe(true);
  });

  it.each(seeds)('%s: the core can bootstrap (power, heat, water, air, beds, kitchen, refit bay)', (seed) => {
    const st = generateBunker(seed, defs);
    const core = st.sections.find((s) => s.template === 'core')!;
    const has = (t: string) => st.rooms.some((r) => r.sectionId === core.id && r.type === t);
    for (const t of ['geothermal', 'boiler', 'water_plant', 'scrubber', 'quarters', 'kitchen', 'empty'])
      expect(has(t), t).toBe(true);
    // Power, heat and water are never damaged at the start.
    for (const t of ['geothermal', 'boiler', 'water_plant'])
      expect(st.rooms.find((r) => r.sectionId === core.id && r.type === t)!.damaged).toBe(false);
    expect(st.survivors).toHaveLength(4);
    expect(st.rooms.filter((r) => r.type === 'airlock')).toHaveLength(1);
  });

  it('has tall rooms and several shafts', () => {
    const st = generateBunker('ember-07', defs);
    const tall = st.rooms.filter(
      (r) => new Set(r.cellIds.map((id) => st.cells.find((c) => c.id === id)!.y)).size > 1,
    );
    expect(tall.length).toBeGreaterThanOrEqual(1);
    expect(st.shafts.filter((s) => s.kind === 'elevator').length).toBeGreaterThanOrEqual(1);
    expect(st.shafts.filter((s) => s.kind === 'ladder').length).toBeGreaterThanOrEqual(2);
  });
});
