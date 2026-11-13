/**
 * Machines, conveyor lanes and pipe networks (Phase 1 slice).
 *
 * Item flow: store --(room hopper + belt)--> machine input; machine output --(belt|pipe)-->
 * machine input or the bunker water tank (store). Unconnected ports fall back to survivors carrying
 * items by hand (slow, and only while a worker is present): automation frees workers.
 */
import { GAME_SECONDS_PER_TICK, DT_HOURS } from '../core/time';
import { cellsXRange } from '../core/geometry';
import type { Lane, MachineState, PipeNetwork, PortRef, Room } from '../core/state';
import { give, has, take } from '../core/store';
import type { World } from '../core/world';
import { UNITS_PER_M, advance, canInsert, frontReady, insert, takeFront } from './lanes';
import { roomInfo } from './rooms';

/** Machine area inside a room: front half, 1 m grid, origin at (roomX0 + 0.5, -0.5). */
export const MACHINE_Z0 = -0.5;
export const MACHINE_DEPTH = 4;
const BELT_Y = 0.35;

export interface Pt {
  x: number;
  z: number;
}

export function roomXRange(w: World, r: Room): [number, number] {
  const first = w.slot(r.slotIds[0]!)!;
  return cellsXRange(
    first.side,
    r.slotIds.map((id) => w.slot(id)!.index),
  );
}

export function roomFloor(w: World, r: Room): number {
  return w.slot(r.slotIds[0]!)!.floor;
}

/** Grid columns available in a room for machines. */
export function gridWidth(w: World, r: Room): number {
  const [x0, x1] = roomXRange(w, r);
  return Math.floor(x1 - x0 - 1);
}

export function machineSize(w: World, m: { type: string; rot: number }): { w: number; d: number } {
  const s = w.defs.machines[m.type]!.size;
  return m.rot % 2 === 0 ? { w: s.w, d: s.d } : { w: s.d, d: s.w };
}

/** Machine footprint centre (floor-local). */
export function machineCenter(w: World, m: MachineState): Pt {
  const r = w.room(m.roomId)!;
  const [x0] = roomXRange(w, r);
  const sz = machineSize(w, m);
  return { x: x0 + 0.5 + m.gx + sz.w / 2, z: MACHINE_Z0 + m.gz + sz.d / 2 };
}

/** Input port on the -x face, output port on the +x face (rotation not used in Phase 1). */
export function machinePort(w: World, m: MachineState, kind: 'in' | 'out'): Pt {
  const c = machineCenter(w, m);
  const sz = machineSize(w, m);
  return { x: c.x + (kind === 'in' ? -1 : 1) * (sz.w / 2), z: c.z };
}

/** Room hopper (store -> belt) at the front-left of the machine area. */
export function hopperPort(w: World, r: Room): Pt {
  const [x0] = roomXRange(w, r);
  return { x: x0 + 0.5, z: MACHINE_Z0 - 0.1 };
}

/** Room tank inlet (pipe -> store) at the front-right of the machine area. */
export function tankPort(w: World, r: Room): Pt {
  const [, x1] = roomXRange(w, r);
  return { x: x1 - 0.5, z: MACHINE_Z0 - 0.1 };
}

export function portPoint(w: World, p: PortRef, dir: 'from' | 'to'): Pt | null {
  if (p.kind === 'machine') {
    const m = w.state.machines.find((x) => x.id === p.id);
    return m ? machinePort(w, m, dir === 'from' ? 'out' : 'in') : null;
  }
  if (p.kind === 'room') {
    const r = w.room(p.id);
    return r ? (dir === 'from' ? hopperPort(w, r) : tankPort(w, r)) : null;
  }
  return null;
}

/** L-shaped route between two ports, stepping 0.5 m out of each port first. */
export function route(a: Pt, b: Pt, outA: number, inB: number): Pt[] {
  const a1 = { x: a.x + outA * 0.5, z: a.z };
  const b1 = { x: b.x + inB * 0.5, z: b.z };
  const pts = [a, a1, { x: b1.x, z: a1.z }, b1, b];
  return pts.filter(
    (p, i) => i === 0 || Math.abs(p.x - pts[i - 1]!.x) + Math.abs(p.z - pts[i - 1]!.z) > 1e-6,
  );
}

export function polylineLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++)
    L += Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.z - pts[i - 1]!.z);
  return L;
}

/** Point at distance d (metres) along a polyline. Render helper. */
export function pointAlong(pts: Pt[], d: number): Pt {
  let rem = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    if (rem <= seg || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, rem / seg) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    rem -= seg;
  }
  return pts[pts.length - 1]!;
}

export const BELT_HEIGHT = BELT_Y;

// ---------------------------------------------------------------------------------------------
// Placement validation (used by commands)
// ---------------------------------------------------------------------------------------------

export function canPlaceMachine(
  w: World,
  roomId: number,
  type: string,
  gx: number,
  gz: number,
  rot = 0,
): string | null {
  const r = w.room(roomId);
  const def = w.defs.machines[type];
  if (!r || !def) return 'Nothing to place on';
  if (def.allowedRooms.length && !def.allowedRooms.includes(r.type))
    return `Goes in: ${def.allowedRooms.map((id) => w.defs.rooms[id]!.name).join(', ')}`;
  if (r.damaged) return 'Repair the room first';
  const sz = machineSize(w, { type, rot });
  if (gx < 0 || gz < 0 || gx + sz.w > gridWidth(w, r) || gz + sz.d > MACHINE_DEPTH)
    return 'Does not fit here';
  for (const m of w.state.machines) {
    if (m.roomId !== roomId) continue;
    const o = machineSize(w, m);
    if (gx < m.gx + o.w && m.gx < gx + sz.w && gz < m.gz + o.d && m.gz < gz + sz.d)
      return 'Overlaps another machine';
  }
  if (!has(w, def.cost)) return 'Not enough materials';
  return null;
}

/** First free grid spot in a room for a machine type, preferring the one nearest `near`. */
export function freeSpot(
  w: World,
  roomId: number,
  type: string,
  near?: Pt,
): { gx: number; gz: number } | null {
  const r = w.room(roomId);
  if (!r) return null;
  const [x0] = roomXRange(w, r);
  let best: { gx: number; gz: number; d: number } | null = null;
  for (let gz = 0; gz < MACHINE_DEPTH; gz++)
    for (let gx = 0; gx < gridWidth(w, r); gx++) {
      const err = canPlaceMachine(w, roomId, type, gx, gz);
      if (err && err !== 'Not enough materials') continue;
      const cx = x0 + 0.5 + gx + 1;
      const cz = MACHINE_Z0 + gz + 1;
      const d = near ? Math.abs(cx - near.x) + Math.abs(cz - near.z) : gz * 100 + gx;
      if (!best || d < best.d) best = { gx, gz, d };
    }
  return best ? { gx: best.gx, gz: best.gz } : null;
}

export function recipeOf(w: World, m: MachineState) {
  return w.defs.recipes[m.recipe]!;
}

/** Is a machine input fed by a lane or a pipe? */
export function inputConnected(w: World, m: MachineState): boolean {
  return (
    w.state.lanes.some((l) => l.to?.kind === 'machine' && l.to.id === m.id) ||
    w.state.pipes.some((p) => p.consumers.some((c) => c.machineId === m.id))
  );
}
export function outputConnected(w: World, m: MachineState): boolean {
  return (
    w.state.lanes.some((l) => l.from?.kind === 'machine' && l.from.id === m.id) ||
    w.state.pipes.some((p) => p.producers.some((c) => c.machineId === m.id))
  );
}

// ---------------------------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------------------------

function roomStaffed(w: World, roomId: number): boolean {
  const r = w.room(roomId);
  if (!r) return false;
  const info = roomInfo(w, r);
  return info.tier.workersPerCell > 0 && info.staffing > 0;
}

export function stepLogistics(w: World): void {
  const st = w.state;
  if (st.machines.length === 0 && st.lanes.length === 0) return;
  const handTick = st.tick % w.defs.handTicks === 0;

  // 1) Hoppers: store -> lane start.
  for (const l of st.lanes) {
    if (l.from?.kind !== 'room' || !canInsert(l)) continue;
    const item = laneItem(w, l);
    if (item && take(w, [{ item, qty: 1 }])) insert(l, item);
  }
  // 2) Lanes move; deliver front items.
  for (const l of st.lanes) {
    advance(l);
    if (!frontReady(l) || !l.to) continue;
    if (l.to.kind === 'machine') {
      const target = l.to;
      const m = st.machines.find((x) => x.id === target.id);
      if (!m) continue;
      const cap = w.defs.machines[m.type]!.slotCapacity;
      const item = l.items[0]!;
      if ((m.inputs[item] ?? 0) + 1 <= cap) {
        takeFront(l);
        m.inputs[item] = (m.inputs[item] ?? 0) + 1;
      }
    } else if (give(w, [{ item: l.items[0]!, qty: 1 }]) >= 1) takeFront(l);
  }
  // 3) Machines.
  for (const m of st.machines) {
    const def = w.defs.machines[m.type]!;
    const rec = recipeOf(w, m);
    // Hand feeding from the store when the input is not connected.
    if (handTick && !inputConnected(w, m) && roomStaffed(w, m.roomId)) {
      for (const inp of rec.inputs) {
        if ((m.inputs[inp.item] ?? 0) + 1 <= def.slotCapacity && take(w, [{ item: inp.item, qty: 1 }]))
          m.inputs[inp.item] = (m.inputs[inp.item] ?? 0) + 1;
      }
    }
    const running =
      m.enabled &&
      m.powered > 0 &&
      m.wear < 1 &&
      rec.inputs.every((i) => (m.inputs[i.item] ?? 0) >= i.qty) &&
      rec.outputs.every((o) => (m.outputs[o.item] ?? 0) + o.qty <= def.slotCapacity);
    if (running) {
      const eff = m.wear > 0.5 ? 0.6 : 1;
      m.progress += (GAME_SECONDS_PER_TICK / rec.seconds) * m.powered * eff;
      m.wear = Math.min(1, m.wear + def.wearPerHour * DT_HOURS);
      if (m.wear >= 1)
        w.emit({ type: 'notice', text: `${def.name} broke down: repair it`, severity: 'warn' });
      if (m.progress >= 1) {
        m.progress -= 1;
        for (const i of rec.inputs) m.inputs[i.item] = (m.inputs[i.item] ?? 0) - i.qty;
        for (const o of rec.outputs) m.outputs[o.item] = (m.outputs[o.item] ?? 0) + o.qty;
      }
    }
    // Outputs: lane, else (pipe handled below), else hand-carry to the store.
    for (const [item, qty] of Object.entries(m.outputs)) {
      if (qty < 1) continue;
      const lane = st.lanes.find((l) => l.from?.kind === 'machine' && l.from.id === m.id);
      if (lane) {
        if (insert(lane, item)) m.outputs[item] = qty - 1;
      } else if (!outputConnected(w, m) && handTick && roomStaffed(w, m.roomId)) {
        if (give(w, [{ item, qty: 1 }]) >= 1) m.outputs[item] = qty - 1;
      }
    }
  }
  // 4) Pipe networks: producers push, consumers pull, tank drains into the store.
  for (const p of st.pipes) stepPipe(w, p);
}

function stepPipe(w: World, p: PipeNetwork): void {
  const st = w.state;
  for (const pr of p.producers) {
    const m = st.machines.find((x) => x.id === pr.machineId);
    if (!m) continue;
    const q = m.outputs[p.fluid] ?? 0;
    const move = Math.min(q, p.capacity - p.volume);
    if (move > 0) {
      m.outputs[p.fluid] = q - move;
      p.volume += move;
    }
  }
  for (const c of p.consumers) {
    const m = st.machines.find((x) => x.id === c.machineId);
    if (!m) continue;
    const cap = w.defs.machines[m.type]!.slotCapacity;
    const have = m.inputs[p.fluid] ?? 0;
    const move = Math.min(p.volume, cap - have);
    if (move > 0) {
      m.inputs[p.fluid] = have + move;
      p.volume -= move;
    }
  }
  if (p.toStore && p.volume > 0) {
    const frac = give(w, [{ item: p.fluid, qty: p.volume }]);
    p.volume -= p.volume * frac;
  }
}

/** What a hopper lane carries: the first conveyable input of its target machine's recipe. */
export function laneItem(w: World, l: Lane): string | null {
  if (l.to?.kind !== 'machine') return null;
  const target = l.to;
  const m = w.state.machines.find((x) => x.id === target.id);
  if (!m) return null;
  return recipeOf(w, m).inputs.find((i) => w.defs.items[i.item]?.conveyable)?.item ?? null;
}

/** Fixed-point lane from a polyline (metres). */
export function makeLane(w: World, id: number, floor: number, pts: Pt[], from: PortRef, to: PortRef): Lane {
  const tier = w.defs.conveyors[0]!;
  return {
    id,
    floor,
    points: pts,
    length: Math.round(polylineLength(pts) * UNITS_PER_M),
    items: [],
    gaps: [],
    speed: Math.max(1, Math.round(tier.metresPerTick * UNITS_PER_M)),
    from,
    to,
  };
}

/** Total quantity of an item anywhere in the logistics layer (store, machines, lanes, pipes). */
export function totalOf(w: World, item: string): number {
  const st = w.state;
  let t = st.store[item] ?? 0;
  for (const m of st.machines) t += (m.inputs[item] ?? 0) + (m.outputs[item] ?? 0);
  for (const l of st.lanes) for (const it of l.items) if (it === item) t += 1;
  for (const p of st.pipes) if (p.fluid === item) t += p.volume;
  return t;
}
