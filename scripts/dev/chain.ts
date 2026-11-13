import { loadDefs } from '../../src/data';
import { applyCommand, run } from '../../src/sim';
import { World } from '../../src/sim/core/world';
import { generateBunker } from '../../src/gen/bunker';
import { freeSpot } from '../../src/sim/systems/logistics';
const defs = loadDefs();
defs.rooms.water_plant!.tiers.forEach((t) => (t.effects = []));
const st = generateBunker('ember-07', defs);
st.survivors = [];
st.store = { ice: 30, scrap: 200, parts: 80 };
const w = new World(st, defs);
const plant = w.state.rooms.find((r) => r.type === 'water_plant')!;
console.log(
  applyCommand(w, {
    type: 'placeMachine',
    roomId: plant.id,
    machine: 'ice_melter',
    ...freeSpot(w, plant.id, 'ice_melter')!,
  }),
);
console.log(
  applyCommand(w, {
    type: 'placeMachine',
    roomId: plant.id,
    machine: 'purifier',
    ...freeSpot(w, plant.id, 'purifier')!,
  }),
);
const [m1, m2] = w.state.machines;
console.log(
  applyCommand(w, { type: 'connectBelt', from: { kind: 'room', id: plant.id }, toMachine: m1!.id }),
);
console.log(applyCommand(w, { type: 'connectPipe', fromMachine: m1!.id, toMachine: m2!.id }));
console.log(applyCommand(w, { type: 'connectPipe', fromMachine: m2!.id, toMachine: 'tank' }));
for (let i = 0; i < 5; i++) {
  run(w, 600);
  console.log(
    JSON.stringify({
      store: w.state.store,
      m: w.state.machines.map((m) => ({
        in: m.inputs,
        out: m.outputs,
        p: m.progress.toFixed(2),
        pw: m.powered,
      })),
      lane: w.state.lanes[0]!.items.length,
      gaps: w.state.lanes[0]!.gaps.slice(0, 3),
      len: w.state.lanes[0]!.length,
      pipes: w.state.pipes.map((p) => p.volume),
      plantPowered: plant.powered,
      power: w.state.power,
    }),
  );
}
