import { loadDefs } from '../../src/data';
import { generateBunker } from '../../src/gen/bunker';
const seed = process.argv[2] ?? 'ember-07';
const st = generateBunker(seed, loadDefs());
const xs = st.cells.map((c) => c.x), zs = st.cells.map((c) => c.z), ys = st.cells.map((c) => c.y);
const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
const roomCh = new Map<number, string>();
let k = 0;
for (const r of st.rooms) roomCh.set(r.id, 'abcdefghijklmnopqrstuvwxyz0123456789'[k++ % 36]!);
for (let y = 0; y <= Math.max(...ys); y++) {
  console.log(`--- level ${y}`);
  for (let z = z0; z <= z1; z++) {
    let row = '';
    for (let x = x0; x <= x1; x++) {
      const c = st.cells.find((c) => c.x === x && c.y === y && c.z === z);
      row += !c ? ' .' : c.kind === 'corridor' ? ' #' : c.kind === 'shaft' ? (st.shafts.find((s) => s.id === c.shaftId)!.kind === 'elevator' ? ' E' : ' L') : ' ' + roomCh.get(c.roomId!);
    }
    console.log(row);
  }
}
for (const r of st.rooms) console.log(roomCh.get(r.id), r.type, r.cellIds.length, r.damaged ? 'DAMAGED' : '', st.sections.find((s) => s.id === r.sectionId)!.template);
console.log('sections', st.sections.map((s) => s.template).join(','), 'links', st.links.length, 'bulkheads', st.links.filter((l) => l.kind === 'bulkhead').length, 'shafts', st.shafts.map((s) => `${s.kind}${s.top}-${s.bottom}${s.broken ? 'X' : ''}`).join(' '));
