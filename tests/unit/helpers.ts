import { newWorld, step } from '../../src/sim';
import type { Command, World } from '../../src/sim';

export const SEED = 'ember-07';

/** Assigns each survivor to a room that needs workers, in a sensible order. */
export function autoAssign(w: World): Command[] {
  const order = ['water_plant', 'kitchen', 'geothermal', 'boiler', 'hydroponics', 'workshop'];
  const cmds: Command[] = [];
  const rooms = order.flatMap((t) =>
    w.state.rooms.filter((r) => r.type === t && !r.damaged && w.roomOpen(r)),
  );
  w.state.survivors.forEach((s, i) => {
    const r = rooms[i % Math.max(1, rooms.length)];
    if (r) cmds.push({ type: 'assign', survivorId: s.id, roomId: r.id });
  });
  return cmds;
}

export function runWith(
  seed: string,
  ticks: number,
  script: (w: World, tick: number) => Command[] = () => [],
) {
  const w = newWorld(seed);
  for (let t = 0; t < ticks; t++) step(w, script(w, t));
  return w;
}
