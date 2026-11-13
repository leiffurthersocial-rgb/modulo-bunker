/**
 * Seeded bunker generation. Pure: same seed + same defs => identical SimState.
 * Layout rule (keeps reachability valid by construction): each floor side is a chain from the
 * shaft outward: [open cells (rooms/empty)] [sealed cells] [rock].
 */
import type { Defs, RoomTypeId } from '../data/types';
import { Rng } from './rng';
import { GEO, SAVE_SCHEMA_VERSION } from '../sim/core/state';
import type { Room, SimState, Slot, Side, Survivor, SealKind } from '../sim/core/state';

export const START_FLOORS_OPEN = 3;
export const GENERATED_FLOORS = 10;
export const MAX_FLOORS = 20;

/** Rooms every bunker starts with (operational), and those that start damaged. */
const START_ROOMS: { type: RoomTypeId; width: number }[] = [
  { type: 'geothermal', width: 1 },
  { type: 'boiler', width: 1 },
  { type: 'water_plant', width: 1 },
  { type: 'scrubber', width: 1 },
  { type: 'quarters', width: 2 },
  { type: 'kitchen', width: 1 },
  { type: 'storage', width: 1 },
];
const START_DAMAGED: RoomTypeId[] = ['hydroponics', 'workshop'];
const DEEP_ROOM_POOL: RoomTypeId[] = [
  'radio',
  'lab',
  'medbay',
  'common',
  'hydroponics',
  'workshop',
  'storage',
];

export function generateBunker(seed: string, defs: Defs): SimState {
  const rng = Rng.stream(seed, 'layout');
  const lootRng = Rng.stream(seed, 'loot');
  let nextId = 1;
  const slots: Slot[] = [];
  const rooms: Room[] = [];

  const floors = Array.from({ length: MAX_FLOORS }, (_, i) => ({
    index: i,
    state:
      i < START_FLOORS_OPEN
        ? ('open' as const)
        : i < GENERATED_FLOORS
          ? ('sealed' as const)
          : ('unexcavated' as const),
  }));

  // Create all slots.
  const slotAt = new Map<string, Slot>();
  for (let f = 0; f < MAX_FLOORS; f++)
    for (const side of [-1, 1] as Side[])
      for (let i = 0; i < GEO.cellsPerSide; i++) {
        const s: Slot = { id: nextId++, floor: f, side, index: i, state: 'rock', roomId: null };
        slots.push(s);
        slotAt.set(`${f}:${side}:${i}`, s);
      }
  const slot = (f: number, side: Side, i: number) => slotAt.get(`${f}:${side}:${i}`)!;

  const makeRoom = (type: RoomTypeId, slotList: Slot[], damaged: boolean): Room => {
    const def = defs.rooms[type];
    if (!def) throw new Error(`unknown room ${type}`);
    const room: Room = {
      id: nextId++,
      type,
      tier: 1,
      slotIds: slotList.map((s) => s.id),
      damaged,
      enabled: true,
      priority: def.priority,
      temp: 12,
      powered: 1,
      progress: def.tiers[0].effects.map(() => 0),
      workers: [],
    };
    for (const s of slotList) {
      s.state = 'room';
      s.roomId = room.id;
    }
    rooms.push(room);
    return room;
  };

  // --- Open floors: decide per side how many cells are open (rest sealed/rock). ---
  // Floor 0 and 1: all 4 cells excavated on both sides; floor 2: 2-4 open cells per side.
  const openCount = new Map<string, number>();
  for (let f = 0; f < START_FLOORS_OPEN; f++)
    for (const side of [-1, 1] as Side[]) openCount.set(`${f}:${side}`, f < 2 ? 4 : rng.int(2, 4));

  // Free open cells as a shuffled list of runs we can place rooms into.
  type Cell = { f: number; side: Side; i: number };
  const freeCells: Cell[] = [];
  for (let f = 0; f < START_FLOORS_OPEN; f++)
    for (const side of [-1, 1] as Side[]) {
      const n = openCount.get(`${f}:${side}`)!;
      for (let i = 0; i < n; i++) {
        slot(f, side, i).state = 'empty';
        freeCells.push({ f, side, i });
      }
    }

  // Airlock: floor 0, outermost cell of a random side (always sealed; the mystery hatch).
  const airSide: Side = rng.next() < 0.5 ? -1 : 1;
  const airSlot = slot(0, airSide, GEO.cellsPerSide - 1);
  airSlot.state = 'sealed';
  airSlot.seal = { kind: 'keycard', cost: [], hiddenRoom: 'airlock' };
  removeCell(freeCells, 0, airSide, GEO.cellsPerSide - 1);

  const isFree = (f: number, side: Side, i: number) =>
    freeCells.some((c) => c.f === f && c.side === side && c.i === i);
  const place = (type: RoomTypeId, width: number, damaged: boolean, floorFilter: (f: number) => boolean) => {
    // Candidate starts where `width` consecutive free cells exist on one side of one floor.
    const cands: Cell[] = [];
    for (const c of freeCells) {
      if (!floorFilter(c.f)) continue;
      let ok = true;
      for (let k = 0; k < width; k++) if (!isFree(c.f, c.side, c.i + k)) ok = false;
      if (ok) cands.push(c);
    }
    if (cands.length === 0) return false;
    const c = cands[rng.int(0, cands.length - 1)]!;
    const list: Slot[] = [];
    for (let k = 0; k < width; k++) {
      list.push(slot(c.f, c.side, c.i + k));
      removeCell(freeCells, c.f, c.side, c.i + k);
    }
    makeRoom(type, list, damaged);
    return true;
  };

  // Starting rooms on floors 0-1 (critical ones on floor 0 preferred).
  for (const r of START_ROOMS) {
    if (!place(r.type, r.width, false, (f) => f <= 1)) place(r.type, 1, false, () => true);
  }
  for (const t of START_DAMAGED) place(t, 1, true, (f) => f >= 1);
  // A couple of damaged extras deeper.
  const extras = rng.int(1, 2);
  for (let k = 0; k < extras; k++)
    place(DEEP_ROOM_POOL[rng.int(0, DEEP_ROOM_POOL.length - 1)]!, 1, true, (f) => f >= 1);

  // Floor 2 sides: beyond open cells, up to 1 sealed cell then rock.
  for (const side of [-1, 1] as Side[]) {
    const n = openCount.get(`2:${side}`)!;
    if (n < GEO.cellsPerSide) {
      sealSlot(slot(2, side, n), pickSeal(rng), lootRng, defs, rng);
      for (let i = n + 1; i < GEO.cellsPerSide; i++) slot(2, side, i).state = 'rock';
    }
  }

  // Sealed floors 3..9: the whole floor is behind a sealed landing; cells inside are a mix.
  for (let f = START_FLOORS_OPEN; f < GENERATED_FLOORS; f++)
    for (const side of [-1, 1] as Side[]) {
      const n = rng.int(1, GEO.cellsPerSide);
      for (let i = 0; i < GEO.cellsPerSide; i++) {
        const s = slot(f, side, i);
        if (i >= n) s.state = 'rock';
        else sealSlot(s, pickSeal(rng), lootRng, defs, rng);
      }
    }
  // Floors >= 10 remain rock (excavation, Phase 2).

  const survivors = rollSurvivors(seed, defs, () => nextId++);
  const store: Record<string, number> = {};
  for (const s of defs.balance.startingStore) store[s.item] = (store[s.item] ?? 0) + s.qty;

  // Survivors start in the floor-0 landing area.
  survivors.forEach((s, i) => {
    s.floor = 0;
    s.x = -1.2 + i * 0.8;
    s.z = -2.5;
  });

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed,
    tick: 0,
    nextId,
    floors,
    slots,
    rooms,
    survivors,
    elevator: { pos: 0, target: null, queue: [], doorTicks: 0, riders: [] },
    store,
    power: { produced: 0, demand: 0, shedFrom: 5 },
    co2: defs.balance.co2Ambient,
    outsideTemp: defs.balance.outsideTempStart,
    machines: [],
    lanes: [],
    pipes: [],
    rng: {},
    flags: {},
  };
}

function removeCell(list: { f: number; side: Side; i: number }[], f: number, side: Side, i: number) {
  const k = list.findIndex((c) => c.f === f && c.side === side && c.i === i);
  if (k >= 0) list.splice(k, 1);
}

function pickSeal(rng: Rng): SealKind {
  const r = rng.next();
  return r < 0.45 ? 'repair' : r < 0.85 ? 'power' : 'keycard';
}

function sealSlot(s: Slot, kind: SealKind, lootRng: Rng, defs: Defs, rng: Rng) {
  s.state = 'sealed';
  const cost =
    kind === 'repair'
      ? [{ item: 'parts', qty: rng.int(3, 8) }]
      : kind === 'power'
        ? [{ item: 'scrap', qty: rng.int(5, 15) }]
        : [];
  const hidden = rng.next() < 0.35 ? DEEP_ROOM_POOL[rng.int(0, DEEP_ROOM_POOL.length - 1)] : undefined;
  const lootItems = ['scrap', 'parts', 'filter', 'ration', 'medkit'].filter((id) => defs.items[id]);
  const loot = [{ item: lootItems[lootRng.int(0, lootItems.length - 1)]!, qty: lootRng.int(2, 12) }];
  s.seal = hidden ? { kind, cost, hiddenRoom: hidden, loot } : { kind, cost, loot };
}

/** Seeded survivor stat rolls from the templates. */
export function rollSurvivors(seed: string, defs: Defs, nextId: () => number): Survivor[] {
  const rng = Rng.stream(seed, 'survivors');
  const traitIds = Object.keys(defs.traits);
  const skillIds = Object.keys(defs.skills);
  return defs.survivors.slice(0, 4).map((t) => {
    const skills: Record<string, number> = {};
    for (const sk of skillIds) skills[sk] = rng.int(1, 4) + (t.aptitudes.includes(sk) ? rng.int(3, 5) : 0);
    const traits: string[] = [];
    while (traits.length < 2) {
      const tr = traitIds[rng.int(0, traitIds.length - 1)]!;
      const def = defs.traits[tr]!;
      if (
        traits.includes(tr) ||
        traits.some((x) => def.excludes?.includes(x) || defs.traits[x]?.excludes?.includes(tr))
      )
        continue;
      traits.push(tr);
    }
    for (const tr of traits)
      for (const [sk, b] of Object.entries(defs.traits[tr]!.skillBonus ?? {}))
        skills[sk] = (skills[sk] ?? 0) + b;
    const needs: Record<string, number> = {};
    for (const n of Object.keys(defs.needs)) needs[n] = 60 + rng.int(0, 30);
    return {
      id: nextId(),
      templateId: t.id,
      name: t.name,
      color: t.color,
      skills,
      traits,
      needs,
      health: 100,
      stress: 10,
      floor: 0,
      x: 0,
      z: 0,
      heading: 0,
      assignedRoom: null,
      action: 'idle',
      actionTarget: null,
      actionSince: 0,
      path: [],
      elevator: 'none',
    };
  });
}
