/**
 * Machines, conveyor lanes and pipe networks (Phase 1 slice).
 *
 * Item flow: store --(room hopper + belt)--> machine input; machine output --(belt|pipe)-->
 * machine input or the bunker water tank (store). Unconnected ports fall back to survivors carrying
 * items by hand (slow, and only while a worker is present): automation frees workers.
 */
import { GAME_SECONDS_PER_TICK, DT_HOURS } from '../core/time';
import { cellCenter, cellX0, cellZ0 } from '../core/geometry';
import type { Cell, Lane, MachineState, PipeNetwork, PortRef, Room } from '../core/state';
import { give, has, take } from '../core/store';
import type { World } from '../core/world';
import { UNITS_PER_M, advance, canInsert, frontReady, insert, takeFront } from './lanes';
import { roomInfo } from './rooms';

const BELT_Y = 0.35;

export interface Pt {
  x: number;
  z: number;
}

/** Walkable cells of a room (its lowest level); machines and hatches live there. */
export function roomFloorCells(w: World, r: Room): Cell[] {
  const cells = r.cellIds.map((id) => w.cell(id)!);
  const lowest = Math.max(...cells.map((c) => c.y));
  return cells.filter((c) => c.y === lowest);
}

export function roomLevel(w: World, r: Room): number {
  return Math.max(...r.cellIds.map((id) => w.cell(id)!.y));
}

/**
 * Machines occupy 2x2 m corner slots of a cell (gx, gz in {0,1}), keeping the centre cross free
 * as a walkway between doors.
 */
export function machineCenter(w: World, m: { cellId: number; gx: number; gz: number }): Pt {
  const c = w.cell(m.cellId)!;
  return { x: cellX0(c) + (m.gx ? 4.5 : 1.5), z: cellZ0(c) + (m.gz ? 4.5 : 1.5) };
}

/** Input port on the -x face, output port on the +x face. */
export function machinePort(w: World, m: MachineState, kind: 'in' | 'out'): Pt {
  const c = machineCenter(w, m);
  return { x: c.x + (kind === 'in' ? -1 : 1), z: c.z };
}

/** Room hopper (store -> belt): a floor hatch just west of the first floor cell's centre. */
export function hopperPort(w: World, r: Room): Pt {
  const c = cellCenter(roomFloorCells(w, r)[0]!);
  return { x: c.x - 0.6, z: c.z };
}

/** Room tank inlet (pipe -> store): just east of the first floor cell's centre. */
export function tankPort(w: World, r: Room): Pt {
  const c = cellCenter(roomFloorCells(w, r)[0]!);
  return { x: c.x + 0.6, z: c.z };
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
  cellId: number,
  type: string,
  gx: number,
  gz: number,
): string | null {
  const c = w.cell(cellId);
  const r = c && w.room(c.roomId);
  const def = w.defs.machines[type];
  if (!c || !r || !def) return 'Machines go inside rooms';
  if (def.allowedRooms.length && !def.allowedRooms.includes(r.type))
    return `Goes in: ${def.allowedRooms.map((id) => w.defs.rooms[id]!.name).join(', ')}`;
  if (!w.roomOpen(r)) return 'Section is sealed';
  if (r.damaged) return 'Repair the room first';
  if (!roomFloorCells(w, r).includes(c)) return 'No floor here';
  if (!(gx === 0 || gx === 1) || !(gz === 0 || gz === 1)) return 'Does not fit here';
  if (w.state.machines.some((m) => m.cellId === cellId && m.gx === gx && m.gz === gz)) return 'Slot taken';
  if (!has(w, def.cost)) return 'Not enough materials';
  return null;
}

/** Free machine slot in a room, preferring the one nearest `near`. */
export function freeSpot(
  w: World,
  roomId: number,
  type: string,
  near?: Pt,
): { cellId: number; gx: number; gz: number } | null {
  const r = w.room(roomId);
  if (!r) return null;
  let best: { cellId: number; gx: number; gz: number; d: number } | null = null;
  let k = 0;
  for (const c of roomFloorCells(w, r))
    for (const gz of [0, 1])
      for (const gx of [0, 1]) {
        k++;
        const err = canPlaceMachine(w, c.id, type, gx, gz);
        if (err && err !== 'Not enough materials') continue;
        const p = machineCenter(w, { cellId: c.id, gx, gz });
        const d = near ? Math.abs(p.x - near.x) + Math.abs(p.z - near.z) : k;
        if (!best || d < best.d) best = { cellId: c.id, gx, gz, d };
      }
  return best ? { cellId: best.cellId, gx: best.gx, gz: best.gz } : null;
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
export function makeLane(w: World, id: number, level: number, pts: Pt[], from: PortRef, to: PortRef): Lane {
  const tier = w.defs.conveyors[0]!;
  return {
    id,
    level,
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
