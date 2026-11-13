/**
 * Commands are the ONLY way anything outside the sim changes sim state (player, UI, debug,
 * balance runner, replays). They are applied at the start of a tick in queue order.
 *
 * The bunker is pre-built (DECISIONS D-010): the player repairs, upgrades and refits rooms, opens
 * sealed sections, repairs shafts, and builds machines and logistics. No digging or merging.
 */
import type { ItemStack, RoomTypeId } from '../../data/types';
import type { PortRef, Room } from './state';
import { give, has, take } from './store';
import type { World } from './world';
import {
  canPlaceMachine,
  hopperPort,
  inputConnected,
  makeLane,
  machinePort,
  outputConnected,
  polylineLength,
  recipeOf,
  roomLevel,
  route,
  tankPort,
} from '../systems/logistics';

export type Command =
  | { type: 'upgrade'; roomId: number }
  | { type: 'repair'; roomId: number }
  /** Strip a room and refit it as another type (tier resets to 1). */
  | { type: 'refit'; roomId: number; roomType: RoomTypeId }
  /** Open a sealed bulkhead (unlocks its section). */
  | { type: 'openBulkhead'; linkId: number }
  | { type: 'repairShaft'; shaftId: number }
  | { type: 'assign'; survivorId: number; roomId: number | null }
  | { type: 'setPriority'; roomId: number; priority: number }
  | { type: 'toggleRoom'; roomId: number; enabled: boolean }
  | { type: 'callElevator'; shaftId: number; level: number }
  /** Keeps the car's doors open while someone stands in the doorway. */
  | { type: 'holdElevator'; shaftId: number; level: number }
  | { type: 'placeMachine'; cellId: number; machine: string; gx: number; gz: number }
  | { type: 'removeMachine'; machineId: number }
  | { type: 'repairMachine'; machineId: number }
  /** Belt from a room hopper (store) or a machine output to a machine input. */
  | { type: 'connectBelt'; from: PortRef; toMachine: number }
  /** Pipe from a machine's liquid output to a machine input or the room's tank (store). */
  | { type: 'connectPipe'; fromMachine: number; toMachine: number | 'tank' }
  | { type: 'removeLane'; laneId: number }
  | { type: 'removePipe'; pipeId: number }
  | { type: 'debug.give'; items: ItemStack[] }
  | { type: 'debug.openSection'; sectionId: number }
  | { type: 'debug.setFlag'; flag: string; value: boolean };

export type CommandResult = { ok: true } | { ok: false; reason: string };
const OK: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

const scale = (stacks: ItemStack[], m: number): ItemStack[] =>
  stacks.map((s) => ({ item: s.item, qty: s.qty * m }));

/** Checks a command without applying it (UI cost previews, button states). */
export function checkCommand(w: World, c: Command): CommandResult {
  return run(w, c, false);
}

export function applyCommand(w: World, c: Command): CommandResult {
  const r = run(w, c, true);
  if (!r.ok) w.emit({ type: 'command.rejected', command: c.type, reason: r.reason });
  return r;
}

/** Cost to refit to `type` (tier 1) or upgrade into `tier`, for a room of `cells` cells. */
export function roomCost(w: World, type: RoomTypeId, tier: number, cells: number): ItemStack[] {
  const def = w.defs.rooms[type];
  return def ? scale(def.tiers[tier - 1]!.cost, cells) : [];
}

export function repairCost(w: World, room: Room): ItemStack[] {
  return scale(w.defs.balance.repairCostPerCell, room.cellIds.length);
}

/** Total heat the boilers could supply right now (kW). */
export function heatSupply(w: World): number {
  let kw = 0;
  for (const r of w.state.rooms) {
    if (r.damaged || !r.enabled || !w.roomOpen(r)) continue;
    const def = w.defs.rooms[r.type]!;
    for (const e of def.tiers[r.tier - 1]!.effects)
      if (e.type === 'heatSupply') kw += e.kw * r.cellIds.length * r.powered;
  }
  return kw;
}

/** Numeric requirement embedded in a seal label ("needs 10 kW ..."). */
export function sealNeed(label: string): number {
  const m = /(\d+)\s*kW/.exec(label);
  return m ? Number(m[1]) : 0;
}

function run(w: World, c: Command, apply: boolean): CommandResult {
  const st = w.state;
  switch (c.type) {
    case 'upgrade': {
      const r = w.room(c.roomId);
      if (!r) return fail('No such room');
      if (!w.roomOpen(r)) return fail('Section is sealed');
      const def = w.defs.rooms[r.type]!;
      if (!def.buildable) return fail('Cannot be upgraded');
      if (r.damaged) return fail('Repair it first');
      if (r.tier >= 3) return fail('Already max tier');
      const cost = roomCost(w, r.type, r.tier + 1, r.cellIds.length);
      if (!has(w, cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, cost);
      r.tier++;
      r.progress = def.tiers[r.tier - 1]!.effects.map((_, i) => r.progress[i] ?? 0);
      w.markTopologyChanged();
      w.emit({ type: 'room.upgraded', roomId: r.id, tier: r.tier });
      return OK;
    }
    case 'repair': {
      const r = w.room(c.roomId);
      if (!r) return fail('No such room');
      if (!w.roomOpen(r)) return fail('Section is sealed');
      if (!r.damaged) return fail('Not damaged');
      const cost = repairCost(w, r);
      if (!has(w, cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, cost);
      r.damaged = false;
      w.markTopologyChanged();
      w.emit({ type: 'notice', text: `${w.defs.rooms[r.type]!.name} repaired`, severity: 'info' });
      return OK;
    }
    case 'refit': {
      const r = w.room(c.roomId);
      const def = w.defs.rooms[c.roomType];
      if (!r) return fail('No such room');
      if (!def || !def.buildable) return fail('Cannot refit to that');
      if (!w.roomOpen(r)) return fail('Section is sealed');
      if (r.type === c.roomType) return fail('Already that type');
      if (!w.defs.rooms[r.type]!.buildable && r.type !== 'empty') return fail('This room cannot be refitted');
      if (r.damaged) return fail('Repair it first');
      const cost = roomCost(w, c.roomType, 1, r.cellIds.length);
      if (!has(w, cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, cost);
      // Machines that do not belong in the new room type go back to the store.
      for (const m of st.machines.filter((m) => w.cell(m.cellId)?.roomId === r.id)) {
        const md = w.defs.machines[m.type]!;
        if (md.allowedRooms.length && !md.allowedRooms.includes(c.roomType))
          run(w, { type: 'removeMachine', machineId: m.id }, true);
      }
      for (const sid of r.workers) {
        const sv = w.survivor(sid);
        if (sv) sv.assignedRoom = null;
      }
      r.workers = [];
      r.type = c.roomType;
      r.tier = 1;
      r.priority = def.priority;
      r.progress = def.tiers[0].effects.map(() => 0);
      w.markTopologyChanged();
      w.emit({ type: 'notice', text: `Refitted as ${def.name}`, severity: 'info' });
      return OK;
    }
    case 'openBulkhead': {
      const l = st.links.find((x) => x.id === c.linkId);
      if (!l || !l.sealed || !l.seal) return fail('Not sealed');
      const a = w.cell(l.a)!;
      const b = w.cell(l.b)!;
      if (!w.cellOpen(a) && !w.cellOpen(b)) return fail('Not reachable yet');
      const seal = l.seal;
      const need = sealNeed(seal.label);
      const spare = st.power.produced - st.power.demand;
      if (seal.kind === 'keycard' && !st.flags['keycard:any']) return fail('Needs a keycard');
      if (seal.kind === 'power' && spare < need)
        return fail(`Needs ${need} kW spare power (have ${Math.max(0, spare).toFixed(0)})`);
      if (seal.kind === 'thaw' && heatSupply(w) < need)
        return fail(`Needs ${need} kW of heating (have ${heatSupply(w).toFixed(0)})`);
      if (!has(w, seal.cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, seal.cost);
      l.sealed = false;
      const section = st.sections.find((s) => s.id === (w.cellOpen(a) ? b.sectionId : a.sectionId))!;
      section.open = true;
      w.markTopologyChanged();
      w.emit({ type: 'notice', text: `${section.name} unsealed`, severity: 'info' });
      return OK;
    }
    case 'repairShaft': {
      const s = w.shaft(c.shaftId);
      if (!s) return fail('No such shaft');
      if (!s.broken) return fail('Not broken');
      if (!has(w, s.repairCost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, s.repairCost);
      s.broken = false;
      w.markTopologyChanged();
      w.emit({
        type: 'notice',
        text: `${s.kind === 'elevator' ? 'Elevator' : 'Ladder'} repaired`,
        severity: 'info',
      });
      return OK;
    }
    case 'assign': {
      const sv = w.survivor(c.survivorId);
      if (!sv) return fail('No such survivor');
      if (c.roomId !== null) {
        const r = w.room(c.roomId);
        if (!r) return fail('No such room');
        if (!w.roomOpen(r)) return fail('Section is sealed');
        const cap = w.defs.rooms[r.type]!.tiers[r.tier - 1]!.workersPerCell * r.cellIds.length;
        if (cap === 0) return fail('Nobody works here');
        if (!r.workers.includes(sv.id) && r.workers.length >= cap) return fail('Room is fully staffed');
      }
      if (!apply) return OK;
      const old = w.room(sv.assignedRoom);
      if (old) old.workers = old.workers.filter((id) => id !== sv.id);
      sv.assignedRoom = c.roomId;
      const nr = w.room(c.roomId);
      if (nr && !nr.workers.includes(sv.id)) {
        nr.workers.push(sv.id);
        nr.workers.sort((a, b) => a - b);
      }
      w.emit({ type: 'survivor.assigned', survivorId: sv.id, roomId: c.roomId });
      return OK;
    }
    case 'setPriority': {
      const r = w.room(c.roomId);
      if (!r) return fail('No such room');
      if (!(c.priority >= 1 && c.priority <= 4)) return fail('Priority is 1..4');
      if (apply) r.priority = Math.round(c.priority);
      return OK;
    }
    case 'toggleRoom': {
      const r = w.room(c.roomId);
      if (!r) return fail('No such room');
      if (apply) r.enabled = c.enabled;
      return OK;
    }
    case 'callElevator': {
      const s = w.shaft(c.shaftId);
      const el = w.elevator(c.shaftId);
      if (!s || !el) return fail('No elevator');
      if (s.broken) return fail('Elevator is broken');
      if (c.level < s.top || c.level > s.bottom) return fail('Not on this shaft');
      if (apply && !el.queue.includes(c.level)) el.queue.push(c.level);
      return OK;
    }
    case 'holdElevator': {
      const el = w.elevator(c.shaftId);
      if (!el || el.target !== null || Math.abs(el.pos - c.level) > 1e-6) return fail('Car not here');
      if (apply) el.doorTicks = Math.max(el.doorTicks, 3);
      return OK;
    }
    case 'placeMachine': {
      const err = canPlaceMachine(w, c.cellId, c.machine, c.gx, c.gz);
      if (err) return fail(err);
      if (!apply) return OK;
      const def = w.defs.machines[c.machine]!;
      take(w, def.cost);
      st.machines.push({
        id: w.nextId(),
        type: c.machine,
        roomId: w.cell(c.cellId)!.roomId!,
        cellId: c.cellId,
        gx: c.gx,
        gz: c.gz,
        rot: 0,
        recipe: def.recipes[0]!,
        inputs: {},
        outputs: {},
        progress: 0,
        wear: 0,
        enabled: true,
        powered: 0,
      });
      w.emit({ type: 'notice', text: `${def.name} placed`, severity: 'info' });
      return OK;
    }
    case 'removeMachine': {
      const m = st.machines.find((x) => x.id === c.machineId);
      if (!m) return fail('No such machine');
      if (!apply) return OK;
      for (const [it, q] of Object.entries(m.inputs)) give(w, [{ item: it, qty: q }]);
      for (const [it, q] of Object.entries(m.outputs)) give(w, [{ item: it, qty: q }]);
      give(w, w.defs.machines[m.type]!.cost, w.defs.balance.demolishRefund);
      const touches = (p: PortRef | null) => p?.kind === 'machine' && p.id === m.id;
      for (const l of st.lanes.filter((l) => touches(l.from) || touches(l.to))) dropLane(w, l.id);
      for (const p of st.pipes.filter(
        (p) => p.producers.some((x) => x.machineId === m.id) || p.consumers.some((x) => x.machineId === m.id),
      ))
        dropPipe(w, p.id);
      st.machines = st.machines.filter((x) => x !== m);
      return OK;
    }
    case 'repairMachine': {
      const m = st.machines.find((x) => x.id === c.machineId);
      if (!m) return fail('No such machine');
      if (m.wear < 0.05) return fail('Not worn');
      const cost = [{ item: 'parts', qty: m.wear >= 1 ? 2 : 1 }];
      if (!has(w, cost)) return fail('Needs parts');
      if (apply) {
        take(w, cost);
        m.wear = 0;
      }
      return OK;
    }
    case 'connectBelt': {
      const to = st.machines.find((x) => x.id === c.toMachine);
      if (!to) return fail('No target machine');
      if (inputConnected(w, to)) return fail('Input already connected');
      const conveyable = recipeOf(w, to).inputs.find((i) => w.defs.items[i.item]?.conveyable);
      if (!conveyable) return fail('Input is a liquid: use a pipe');
      let a: { x: number; z: number };
      let roomId: number;
      if (c.from.kind === 'room') {
        const r = w.room(c.from.id);
        if (!r) return fail('No such room');
        a = hopperPort(w, r);
        roomId = r.id;
      } else if (c.from.kind === 'machine') {
        const src = c.from;
        const m = st.machines.find((x) => x.id === src.id);
        if (!m) return fail('No source machine');
        if (outputConnected(w, m)) return fail('Output already connected');
        const out = recipeOf(w, m).outputs[0]!;
        if (!w.defs.items[out.item]?.conveyable) return fail('Output is a liquid: use a pipe');
        if (out.item !== conveyable.item) return fail(`Target needs ${conveyable.item}`);
        a = machinePort(w, m, 'out');
        roomId = m.roomId;
      } else return fail('Bad source');
      if (roomId !== to.roomId) return fail('Same room only (item elevator comes later)');
      const b = machinePort(w, to, 'in');
      const pts = route(a, b, c.from.kind === 'room' ? 0 : 1, -1);
      const cost = scale(w.defs.conveyors[0]!.costPerMetre, Math.ceil(polylineLength(pts)));
      if (!has(w, cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, cost);
      const level = roomLevel(w, w.room(roomId)!);
      st.lanes.push(makeLane(w, w.nextId(), level, pts, c.from, { kind: 'machine', id: to.id, slot: 0 }));
      return OK;
    }
    case 'connectPipe': {
      const src = st.machines.find((x) => x.id === c.fromMachine);
      if (!src) return fail('No source machine');
      if (outputConnected(w, src)) return fail('Output already connected');
      const out = recipeOf(w, src).outputs[0]!;
      if (w.defs.items[out.item]?.conveyable) return fail('Output is an item: use a belt');
      const room = w.room(src.roomId)!;
      const level = roomLevel(w, room);
      const a = machinePort(w, src, 'out');
      let b: { x: number; z: number };
      let consumers: { machineId: number }[] = [];
      if (c.toMachine === 'tank') b = tankPort(w, room);
      else {
        const dst = st.machines.find((x) => x.id === c.toMachine);
        if (!dst || dst === src) return fail('No target machine');
        if (inputConnected(w, dst)) return fail('Input already connected');
        if (!recipeOf(w, dst).inputs.some((i) => i.item === out.item))
          return fail(`Target does not take ${out.item}`);
        if (dst.roomId !== src.roomId) return fail('Same room only');
        b = machinePort(w, dst, 'in');
        consumers = [{ machineId: dst.id }];
      }
      const pts = route(a, b, 1, c.toMachine === 'tank' ? 0 : -1);
      const cost = scale(w.defs.pipes.costPerMetre, Math.ceil(polylineLength(pts)));
      if (!has(w, cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, cost);
      st.pipes.push({
        id: w.nextId(),
        fluid: out.item,
        volume: 0,
        capacity: w.defs.pipes.capacity,
        segments: pts.slice(1).map((p, i) => ({ level, x1: pts[i]!.x, z1: pts[i]!.z, x2: p.x, z2: p.z })),
        producers: [{ machineId: src.id }],
        consumers,
        toStore: c.toMachine === 'tank',
      });
      return OK;
    }
    case 'removeLane':
      if (!st.lanes.some((l) => l.id === c.laneId)) return fail('No such belt');
      if (apply) dropLane(w, c.laneId);
      return OK;
    case 'removePipe':
      if (!st.pipes.some((p) => p.id === c.pipeId)) return fail('No such pipe');
      if (apply) dropPipe(w, c.pipeId);
      return OK;
    case 'debug.give':
      if (apply) for (const s of c.items) st.store[s.item] = (st.store[s.item] ?? 0) + s.qty;
      return OK;
    case 'debug.openSection': {
      const sec = st.sections.find((s) => s.id === c.sectionId);
      if (!sec) return fail('No such section');
      if (!apply) return OK;
      sec.open = true;
      for (const l of st.links) {
        const a = w.cell(l.a)!;
        const b = w.cell(l.b)!;
        if (l.sealed && (a.sectionId === sec.id || b.sectionId === sec.id)) l.sealed = false;
      }
      w.markTopologyChanged();
      return OK;
    }
    case 'debug.setFlag':
      if (apply) st.flags[c.flag] = c.value;
      return OK;
  }
}

/** Removes a lane, returning its items to the store. */
function dropLane(w: World, id: number): void {
  const l = w.state.lanes.find((x) => x.id === id);
  if (!l) return;
  for (const it of l.items) give(w, [{ item: it, qty: 1 }]);
  w.state.lanes = w.state.lanes.filter((x) => x !== l);
}
function dropPipe(w: World, id: number): void {
  const p = w.state.pipes.find((x) => x.id === id);
  if (!p) return;
  if (p.volume > 0) give(w, [{ item: p.fluid, qty: p.volume }]);
  w.state.pipes = w.state.pipes.filter((x) => x !== p);
}
