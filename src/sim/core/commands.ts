/**
 * Commands are the ONLY way anything outside the sim changes sim state (player, UI, debug,
 * balance runner, replays). They are applied at the start of a tick in queue order.
 */
import type { ItemStack, RoomTypeId } from '../../data/types';
import type { PortRef, Room, Slot } from './state';
import {
  canPlaceMachine,
  hopperPort,
  inputConnected,
  makeLane,
  machinePort,
  roomXRange,
  outputConnected,
  polylineLength,
  recipeOf,
  roomFloor,
  route,
  tankPort,
} from '../systems/logistics';
import { give, has, take } from './store';
import type { World } from './world';

export type Command =
  | { type: 'build'; slotId: number; roomType: RoomTypeId }
  | { type: 'upgrade'; roomId: number }
  | { type: 'merge'; roomId: number; otherRoomId: number }
  | { type: 'demolish'; roomId: number }
  | { type: 'repair'; roomId: number }
  | { type: 'openSeal'; slotId: number }
  | { type: 'openFloor'; floor: number }
  | { type: 'assign'; survivorId: number; roomId: number | null }
  | { type: 'setPriority'; roomId: number; priority: number }
  | { type: 'toggleRoom'; roomId: number; enabled: boolean }
  | { type: 'callElevator'; floor: number }
  /** Keeps the car's doors open while someone stands in the doorway. */
  | { type: 'holdElevator'; floor: number }
  | { type: 'placeMachine'; roomId: number; machine: string; gx: number; gz: number }
  | { type: 'removeMachine'; machineId: number }
  | { type: 'repairMachine'; machineId: number }
  /** Belt from a room hopper (store) or a machine output to a machine input. */
  | { type: 'connectBelt'; from: PortRef; toMachine: number }
  /** Pipe from a machine's liquid output to a machine input or the room's tank (store). */
  | { type: 'connectPipe'; fromMachine: number; toMachine: number | 'tank' }
  | { type: 'removeLane'; laneId: number }
  | { type: 'removePipe'; pipeId: number }
  | { type: 'debug.give'; items: ItemStack[] }
  | { type: 'debug.unlockSlot'; slotId: number }
  | { type: 'debug.setFlag'; flag: string; value: boolean };

export type CommandResult = { ok: true } | { ok: false; reason: string };
const OK: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

const scale = (stacks: ItemStack[], m: number): ItemStack[] =>
  stacks.map((s) => ({ item: s.item, qty: s.qty * m }));

/** Checks a command without applying it (UI cost previews, ghost validity). */
export function checkCommand(w: World, c: Command): CommandResult {
  return run(w, c, false);
}

export function applyCommand(w: World, c: Command): CommandResult {
  const r = run(w, c, true);
  if (!r.ok) w.emit({ type: 'command.rejected', command: c.type, reason: r.reason });
  return r;
}

/** Cost to build (tier 1) or upgrade into `tier` for a room of `cells` width. */
export function roomCost(w: World, type: RoomTypeId, tier: number, cells: number): ItemStack[] {
  const def = w.defs.rooms[type];
  return def ? scale(def.tiers[tier - 1]!.cost, cells) : [];
}

export function repairCost(w: World, room: Room): ItemStack[] {
  return scale(w.defs.balance.repairCostPerCell, room.slotIds.length);
}

/** Rooms adjacent to `room` on the same floor side (index -1 / +1 of its ends). */
export function neighbours(w: World, room: Room): Room[] {
  const slots = room.slotIds.map((id) => w.slot(id)!);
  const first = slots[0]!;
  const lo = Math.min(...slots.map((s) => s.index));
  const hi = Math.max(...slots.map((s) => s.index));
  const out: Room[] = [];
  for (const i of [lo - 1, hi + 1]) {
    const s = w.slotAt(first.floor, first.side, i);
    const r = s && w.room(s.roomId);
    if (r) out.push(r);
  }
  return out;
}

function isFloorOpen(w: World, floor: number): boolean {
  return w.state.floors[floor]?.state === 'open';
}

function run(w: World, c: Command, apply: boolean): CommandResult {
  const st = w.state;
  switch (c.type) {
    case 'build': {
      const s = w.slot(c.slotId);
      const def = w.defs.rooms[c.roomType];
      if (!s) return fail('No such slot');
      if (!def || !def.buildable) return fail('Cannot build that');
      if (!isFloorOpen(w, s.floor)) return fail('Floor is sealed');
      if (s.state !== 'empty')
        return fail(s.state === 'rock' ? 'Solid rock' : s.state === 'sealed' ? 'Sealed' : 'Occupied');
      const cost = roomCost(w, c.roomType, 1, 1);
      if (!has(w, cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, cost);
      const room: Room = {
        id: w.nextId(),
        type: c.roomType,
        tier: 1,
        slotIds: [s.id],
        damaged: false,
        enabled: true,
        priority: def.priority,
        temp: st.outsideTemp + 10,
        powered: 1,
        progress: def.tiers[0].effects.map(() => 0),
        workers: [],
      };
      s.state = 'room';
      s.roomId = room.id;
      st.rooms.push(room);
      st.rooms.sort((a, b) => a.id - b.id);
      w.markTopologyChanged();
      w.emit({ type: 'room.built', roomId: room.id, roomType: room.type, slotIds: room.slotIds });
      return OK;
    }
    case 'upgrade': {
      const r = w.room(c.roomId);
      if (!r) return fail('No such room');
      const def = w.defs.rooms[r.type]!;
      if (r.damaged) return fail('Repair it first');
      if (r.tier >= 3) return fail('Already max tier');
      const cost = roomCost(w, r.type, r.tier + 1, r.slotIds.length);
      if (!has(w, cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, cost);
      r.tier++;
      r.progress = def.tiers[r.tier - 1]!.effects.map((_, i) => r.progress[i] ?? 0);
      w.markTopologyChanged();
      w.emit({ type: 'room.upgraded', roomId: r.id, tier: r.tier });
      return OK;
    }
    case 'merge': {
      const a = w.room(c.roomId);
      const b = w.room(c.otherRoomId);
      if (!a || !b || a === b) return fail('No such room');
      if (a.type !== b.type) return fail('Only rooms of the same type merge');
      if (a.tier !== b.tier) return fail('Upgrade both to the same tier first');
      if (a.damaged || b.damaged) return fail('Repair first');
      const def = w.defs.rooms[a.type]!;
      if (a.slotIds.length + b.slotIds.length > def.maxWidth) return fail(`Max width is ${def.maxWidth}`);
      if (!neighbours(w, a).includes(b)) return fail('Rooms must be adjacent');
      if (!apply) return OK;
      const keep = a.id < b.id ? a : b;
      const gone = keep === a ? b : a;
      // Remember machine world positions; the merged room's grid origin may move.
      const moved = st.machines
        .filter((m) => m.roomId === a.id || m.roomId === b.id)
        .map((m) => ({ m, x: roomXRange(w, w.room(m.roomId)!)[0] + m.gx }));
      const slots = [...keep.slotIds, ...gone.slotIds]
        .map((id) => w.slot(id)!)
        .sort((x, y) => x.index - y.index);
      keep.temp = (keep.temp * keep.slotIds.length + gone.temp * gone.slotIds.length) / slots.length;
      keep.slotIds = slots.map((s) => s.id);
      for (const s of slots) s.roomId = keep.id;
      for (const sid of gone.workers) {
        const sv = w.survivor(sid);
        if (sv) sv.assignedRoom = keep.id;
        keep.workers.push(sid);
      }
      const nx0 = roomXRange(w, keep)[0];
      for (const { m, x } of moved) {
        m.roomId = keep.id;
        m.gx = Math.round(x - nx0);
      }
      st.rooms = st.rooms.filter((r) => r !== gone);
      w.markTopologyChanged();
      w.emit({ type: 'room.merged', roomId: keep.id, absorbedRoomId: gone.id });
      return OK;
    }
    case 'demolish': {
      const r = w.room(c.roomId);
      if (!r) return fail('No such room');
      if (!w.defs.rooms[r.type]!.buildable) return fail('Cannot demolish this');
      if (!apply) return OK;
      const refund = w.defs.balance.demolishRefund;
      for (let t = 1; t <= r.tier; t++) give(w, roomCost(w, r.type, t, r.slotIds.length), refund);
      for (const sid of r.workers) {
        const sv = w.survivor(sid);
        if (sv) sv.assignedRoom = null;
      }
      for (const m of st.machines.filter((m) => m.roomId === r.id)) {
        give(w, w.defs.machines[m.type]!.cost, refund);
      }
      for (const m of st.machines.filter((m) => m.roomId === r.id)) {
        for (const l of st.lanes.filter(
          (l) =>
            (l.from?.kind === 'machine' && l.from.id === m.id) ||
            (l.to?.kind === 'machine' && l.to.id === m.id) ||
            (l.from?.kind === 'room' && l.from.id === r.id),
        ))
          dropLane(w, l.id);
        for (const p of st.pipes.filter(
          (p) =>
            p.producers.some((x) => x.machineId === m.id) || p.consumers.some((x) => x.machineId === m.id),
        ))
          dropPipe(w, p.id);
      }
      st.machines = st.machines.filter((m) => m.roomId !== r.id);
      for (const id of r.slotIds) {
        const s = w.slot(id)!;
        s.state = 'empty';
        s.roomId = null;
      }
      st.rooms = st.rooms.filter((x) => x !== r);
      w.markTopologyChanged();
      w.emit({ type: 'room.demolished', roomId: r.id, slotIds: r.slotIds });
      return OK;
    }
    case 'repair': {
      const r = w.room(c.roomId);
      if (!r) return fail('No such room');
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
    case 'openSeal': {
      const s = w.slot(c.slotId);
      if (!s || s.state !== 'sealed' || !s.seal) return fail('Not sealed');
      if (!isFloorOpen(w, s.floor)) return fail('Floor is sealed');
      if (!isReachableSeal(w, s)) return fail('Open the cells in front first');
      const seal = s.seal;
      if (seal.kind === 'keycard' && !st.flags[`keycard:${s.id}`] && !st.flags['keycard:any'])
        return fail('Needs a keycard');
      if (seal.kind === 'power' && st.power.produced - st.power.demand < w.defs.balance.powerSealSurplusKw)
        return fail(`Needs ${w.defs.balance.powerSealSurplusKw} kW spare power`);
      if (!has(w, seal.cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, seal.cost);
      openSlot(w, s);
      return OK;
    }
    case 'openFloor': {
      const f = st.floors[c.floor];
      if (!f || f.state !== 'sealed') return fail('Floor not sealed');
      if (!isFloorOpen(w, c.floor - 1)) return fail('Open the floor above first');
      const cost = w.defs.balance.openFloorCost;
      if (!has(w, cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, cost);
      f.state = 'open';
      w.markTopologyChanged();
      w.emit({ type: 'notice', text: `Floor ${c.floor + 1} landing unsealed`, severity: 'info' });
      return OK;
    }
    case 'assign': {
      const sv = w.survivor(c.survivorId);
      if (!sv) return fail('No such survivor');
      if (c.roomId !== null) {
        const r = w.room(c.roomId);
        if (!r) return fail('No such room');
        const cap = w.defs.rooms[r.type]!.tiers[r.tier - 1]!.workersPerCell * r.slotIds.length;
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
      if (!isFloorOpen(w, c.floor)) return fail('Floor is sealed');
      if (apply && !st.elevator.queue.includes(c.floor)) st.elevator.queue.push(c.floor);
      return OK;
    }
    case 'holdElevator': {
      const el = st.elevator;
      if (el.target !== null || Math.abs(el.pos - c.floor) > 1e-6) return fail('Car not here');
      if (apply) el.doorTicks = Math.max(el.doorTicks, 3);
      return OK;
    }
    case 'placeMachine': {
      const err = canPlaceMachine(w, c.roomId, c.machine, c.gx, c.gz);
      if (err) return fail(err);
      if (!apply) return OK;
      const def = w.defs.machines[c.machine]!;
      take(w, def.cost);
      st.machines.push({
        id: w.nextId(),
        type: c.machine,
        roomId: c.roomId,
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
      // Return buffered items, refund half the cost, drop its connections.
      for (const [it, q] of Object.entries(m.inputs)) give(w, [{ item: it, qty: q }]);
      for (const [it, q] of Object.entries(m.outputs)) give(w, [{ item: it, qty: q }]);
      give(w, w.defs.machines[m.type]!.cost, w.defs.balance.demolishRefund);
      for (const l of st.lanes.filter(
        (l) =>
          (l.from?.kind === 'machine' && l.from.id === m.id) ||
          (l.to?.kind === 'machine' && l.to.id === m.id),
      ))
        dropLane(w, l.id);
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
      const rec = recipeOf(w, to);
      const conveyable = rec.inputs.find((i) => w.defs.items[i.item]?.conveyable);
      if (!conveyable) return fail('Input is a liquid: use a pipe');
      let a: { x: number; z: number };
      let floor: number;
      if (c.from.kind === 'room') {
        const r = w.room(c.from.id);
        if (!r) return fail('No such room');
        a = hopperPort(w, r);
        floor = roomFloor(w, r);
      } else if (c.from.kind === 'machine') {
        const src = c.from;
        const m = st.machines.find((x) => x.id === src.id);
        if (!m) return fail('No source machine');
        if (outputConnected(w, m)) return fail('Output already connected');
        const out = recipeOf(w, m).outputs[0]!;
        if (!w.defs.items[out.item]?.conveyable) return fail('Output is a liquid: use a pipe');
        if (out.item !== conveyable.item) return fail(`Target needs ${conveyable.item}`);
        a = machinePort(w, m, 'out');
        floor = roomFloor(w, w.room(m.roomId)!);
      } else return fail('Bad source');
      if (roomFloor(w, w.room(to.roomId)!) !== floor)
        return fail('Same floor only (item elevator comes later)');
      const b = machinePort(w, to, 'in');
      const pts = route(a, b, c.from.kind === 'room' ? 0 : 1, -1);
      const cost = scale(w.defs.conveyors[0]!.costPerMetre, Math.ceil(polylineLength(pts)));
      if (!has(w, cost)) return fail('Not enough materials');
      if (!apply) return OK;
      take(w, cost);
      st.lanes.push(makeLane(w, w.nextId(), floor, pts, c.from, { kind: 'machine', id: to.id, slot: 0 }));
      return OK;
    }
    case 'connectPipe': {
      const src = st.machines.find((x) => x.id === c.fromMachine);
      if (!src) return fail('No source machine');
      if (outputConnected(w, src)) return fail('Output already connected');
      const out = recipeOf(w, src).outputs[0]!;
      if (w.defs.items[out.item]?.conveyable) return fail('Output is an item: use a belt');
      const floor = roomFloor(w, w.room(src.roomId)!);
      const a = machinePort(w, src, 'out');
      let b: { x: number; z: number };
      let consumers: { machineId: number }[] = [];
      if (c.toMachine === 'tank') b = tankPort(w, w.room(src.roomId)!);
      else {
        const dst = st.machines.find((x) => x.id === c.toMachine);
        if (!dst || dst === src) return fail('No target machine');
        if (inputConnected(w, dst)) return fail('Input already connected');
        if (!recipeOf(w, dst).inputs.some((i) => i.item === out.item))
          return fail(`Target does not take ${out.item}`);
        if (roomFloor(w, w.room(dst.roomId)!) !== floor) return fail('Same floor only');
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
        segments: pts.slice(1).map((p, i) => ({ floor, x1: pts[i]!.x, z1: pts[i]!.z, x2: p.x, z2: p.z })),
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
    case 'debug.unlockSlot': {
      const s = w.slot(c.slotId);
      if (!s) return fail('No such slot');
      if (!apply) return OK;
      const f = st.floors[s.floor];
      if (f && f.state !== 'open') f.state = 'open';
      if (s.state === 'sealed') openSlot(w, s);
      else if (s.state === 'rock') {
        s.state = 'empty';
        w.markTopologyChanged();
        w.emit({ type: 'slot.changed', slotId: s.id });
      }
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

/** A sealed cell can be opened only if every cell between it and the shaft is open (not sealed/rock). */
export function isReachableSeal(w: World, s: Slot): boolean {
  for (let i = 0; i < s.index; i++) {
    const t = w.slotAt(s.floor, s.side, i);
    if (!t || t.state === 'sealed' || t.state === 'rock') return false;
  }
  return true;
}

function openSlot(w: World, s: Slot): void {
  const seal = s.seal;
  s.state = 'empty';
  delete s.seal;
  if (seal?.loot) give(w, seal.loot);
  if (seal?.hiddenRoom) {
    const def = w.defs.rooms[seal.hiddenRoom]!;
    const room: Room = {
      id: w.nextId(),
      type: seal.hiddenRoom,
      tier: 1,
      slotIds: [s.id],
      damaged: def.buildable,
      enabled: true,
      priority: def.priority,
      temp: w.state.outsideTemp + 5,
      powered: 1,
      progress: def.tiers[0].effects.map(() => 0),
      workers: [],
    };
    s.state = 'room';
    s.roomId = room.id;
    w.state.rooms.push(room);
    w.state.rooms.sort((a, b) => a.id - b.id);
  }
  w.markTopologyChanged();
  w.emit({ type: 'slot.changed', slotId: s.id });
  w.emit({
    type: 'notice',
    text: seal?.hiddenRoom ? `Unsealed: ${w.defs.rooms[seal.hiddenRoom]!.name}` : 'Cell unsealed',
    severity: 'info',
  });
}
