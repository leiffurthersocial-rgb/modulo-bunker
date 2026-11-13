/**
 * Seeded bunker generation from hand-authored section templates (sections.json). Pure:
 * same seed + same defs => identical SimState.
 *
 * The core is placed at the origin. Every other section is attached at a free port: its entry
 * port is rotated to face the parent port, optionally with a short seeded tunnel, and placed only
 * if no cells collide. The link across that seam is the section's sealed bulkhead.
 */
import type { Defs, RoomTypeId } from '../data/types';
import { Rng } from './rng';
import sectionsJson from './sections.json';
import { SAVE_SCHEMA_VERSION } from '../sim/core/state';
import type { Cell, Link, Room, Section, Shaft, SimState, Survivor, SealKind } from '../sim/core/state';
import { cellCenter, cellKey } from '../sim/core/geometry';
import type { Dir } from '../sim/core/geometry';

interface RoomSpec {
  types: string[];
  damagedChance?: number;
}
interface TemplateBase {
  id: string;
  name: string;
  levels: string[][];
  rooms: Record<string, RoomSpec>;
  shafts?: Record<string, { broken?: boolean; repairCost?: { item: string; qty: number }[] }>;
}
interface CoreTemplate extends TemplateBase {
  spawnLevel: number;
  ports: { at: number[]; dir: string }[];
}
interface SectionTemplate extends TemplateBase {
  condition: Section['condition'];
  seal: { kind: string; label: string; cost: { item: string; qty: number }[] };
  attachLevels: number[];
  entry: { at: number[]; dir: string };
}

const CORE = sectionsJson.core as unknown as CoreTemplate;
const SECTIONS = sectionsJson.sections as unknown as SectionTemplate[];

const DIR_VEC: Record<Dir, [number, number]> = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
const ROT_ORDER: Dir[] = ['+x', '+z', '-x', '-z'];
const rotDir = (d: Dir, r: number): Dir => ROT_ORDER[(ROT_ORDER.indexOf(d) + r) % 4]!;
const opposite = (d: Dir): Dir => rotDir(d, 2);
/** Rotate (x,z) by r quarter turns (+x -> +z). */
function rot(x: number, z: number, r: number): [number, number] {
  let a = x;
  let b = z;
  for (let i = 0; i < r; i++) [a, b] = [-b, a];
  return [a, b];
}

interface Placed {
  /** Absolute grid position for every template cell: char + coords. */
  cells: { ch: string; x: number; y: number; z: number }[];
}

/** Absolute cells of a template placed with rotation r and offset (ox, oy, oz) for its origin. */
function place(t: TemplateBase, r: number, ox: number, oy: number, oz: number): Placed {
  const cells: Placed['cells'] = [];
  t.levels.forEach((rows, ly) =>
    rows.forEach((row, lz) =>
      [...row].forEach((ch, lx) => {
        if (ch === '.') return;
        const [rx, rz] = rot(lx, lz, r);
        cells.push({ ch, x: ox + rx, y: oy + ly, z: oz + rz });
      }),
    ),
  );
  return { cells };
}

export function generateBunker(seed: string, defs: Defs): SimState {
  const rng = Rng.stream(seed, 'layout');
  let nextId = 1;
  const cells: Cell[] = [];
  const links: Link[] = [];
  const shafts: Shaft[] = [];
  const sections: Section[] = [];
  const rooms: Room[] = [];
  const occupied = new Map<string, Cell>();
  const ports: { x: number; y: number; z: number; dir: Dir; used: boolean }[] = [];

  /** Materialise a placed template: cells, rooms, shafts, internal doors. */
  const build = (
    t: TemplateBase,
    placed: Placed,
    section: Section,
    extraCorridors: { x: number; y: number; z: number }[],
  ) => {
    const letterRoom = new Map<string, Room>();
    const local: Cell[] = [];
    const shaftCols = new Map<string, Cell[]>();
    for (const pc of [...extraCorridors.map((c) => ({ ...c, ch: '#' })), ...placed.cells]) {
      const kind =
        pc.ch === '#' || pc.ch === '+' ? 'corridor' : pc.ch === 'E' || pc.ch === 'L' ? 'shaft' : 'room';
      const cell: Cell = {
        id: nextId++,
        x: pc.x,
        y: pc.y,
        z: pc.z,
        kind,
        roomId: null,
        shaftId: null,
        sectionId: section.id,
      };
      if (kind === 'room') {
        let room = letterRoom.get(pc.ch);
        if (!room) {
          const spec = t.rooms[pc.ch];
          if (!spec) throw new Error(`template ${t.id}: no room spec for ${pc.ch}`);
          const type = spec.types[rng.int(0, spec.types.length - 1)]!;
          const def = defs.rooms[type];
          if (!def) throw new Error(`template ${t.id}: unknown room type ${type}`);
          room = {
            id: nextId++,
            type,
            tier: 1,
            cellIds: [],
            sectionId: section.id,
            damaged: rng.next() < (spec.damagedChance ?? 0),
            enabled: true,
            priority: def.priority,
            temp: 12,
            powered: 1,
            progress: def.tiers[0].effects.map(() => 0),
            workers: [],
          };
          letterRoom.set(pc.ch, room);
          rooms.push(room);
        }
        room.cellIds.push(cell.id);
        cell.roomId = room.id;
      }
      if (kind === 'shaft') {
        const key = `${pc.ch}:${pc.x},${pc.z}`;
        if (!shaftCols.has(key)) shaftCols.set(key, []);
        shaftCols.get(key)!.push(cell);
      }
      cells.push(cell);
      local.push(cell);
      occupied.set(cellKey(cell.x, cell.y, cell.z), cell);
    }
    for (const [key, col] of shaftCols) {
      const ch = key[0]!;
      const cfg = t.shafts?.[ch] ?? {};
      const ys = col.map((c) => c.y);
      const shaft: Shaft = {
        id: nextId++,
        kind: ch === 'E' ? 'elevator' : 'ladder',
        x: col[0]!.x,
        z: col[0]!.z,
        top: Math.min(...ys),
        bottom: Math.max(...ys),
        broken: cfg.broken ?? false,
        repairCost: cfg.repairCost ?? [],
      };
      shafts.push(shaft);
      for (const c of col) c.shaftId = shaft.id;
    }
    // Internal doors: every horizontal neighbour pair inside this section, except the inside of a
    // room, and except the upper part of a tall room (it has no floor at that level).
    const lowest = new Map<number, number>();
    for (const r of letterRoom.values())
      lowest.set(r.id, Math.max(...r.cellIds.map((id) => local.find((c) => c.id === id)!.y)));
    const enterable = (c: Cell) => c.roomId === null || lowest.get(c.roomId) === c.y;
    for (const a of local)
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const b = occupied.get(cellKey(a.x + dx, a.y, a.z + dz));
        if (!b || b.sectionId !== section.id) continue;
        if (a.roomId !== null && a.roomId === b.roomId) continue;
        if (!enterable(a) || !enterable(b)) continue;
        links.push({ id: nextId++, a: a.id, b: b.id, kind: 'door', sealed: false });
      }
  };

  // --- Core ---
  const core: Section = { id: nextId++, template: 'core', name: CORE.name, open: true, condition: 'ok' };
  sections.push(core);
  build(CORE, place(CORE, 0, 0, 0, 0), core, []);
  for (const p of CORE.ports)
    ports.push({ x: p.at[0]!, y: p.at[1]!, z: p.at[2]!, dir: p.dir as Dir, used: false });

  // --- Sections: seeded backtracking over (section -> free port, tunnel length). Every section
  // must be placed; the most constrained sections are tried first, ties in seeded order. ---
  interface Plan {
    t: SectionTemplate;
    port: (typeof ports)[number];
    tunnel: { x: number; y: number; z: number }[];
    placed: Placed;
  }
  const options = (t: SectionTemplate, occ: Set<string>, used: Set<number>): Plan[] => {
    const out: Plan[] = [];
    const pIdx = shuffle(
      rng,
      ports.map((_, i) => i).filter((i) => !used.has(i) && t.attachLevels.includes(ports[i]!.y)),
    );
    for (const pi of pIdx) {
      const port = ports[pi]!;
      for (const tunnel of shuffle(rng, [0, 1, 2])) {
        const [dx, dz] = DIR_VEC[port.dir];
        const tunnelCells = Array.from({ length: tunnel }, (_, i) => ({
          x: port.x + dx * (i + 1),
          y: port.y,
          z: port.z + dz * (i + 1),
        }));
        const want = opposite(port.dir);
        const r = (ROT_ORDER.indexOf(want) - ROT_ORDER.indexOf(t.entry.dir as Dir) + 4) % 4;
        const [ex, ez] = rot(t.entry.at[0]!, t.entry.at[2]!, r);
        const target = { x: port.x + dx * (tunnel + 1), y: port.y, z: port.z + dz * (tunnel + 1) };
        const placed = place(t, r, target.x - ex, target.y - t.entry.at[1]!, target.z - ez);
        const all = [...tunnelCells, ...placed.cells];
        if (all.some((c) => occ.has(cellKey(c.x, c.y, c.z)) || c.y < 0)) continue;
        out.push({ t, port: Object.assign(port, { index: pi }), tunnel: tunnelCells, placed });
      }
    }
    return out;
  };
  const occ0 = new Set(occupied.keys());
  const pending = shuffle(rng, SECTIONS.slice()).sort(
    (a, b) =>
      ports.filter((p) => a.attachLevels.includes(p.y)).length -
      ports.filter((p) => b.attachLevels.includes(p.y)).length,
  );
  const solve = (i: number, occ: Set<string>, used: Set<number>): Plan[] | null => {
    if (i === pending.length) return [];
    for (const plan of options(pending[i]!, occ, used)) {
      const occ2 = new Set(occ);
      for (const c of [...plan.tunnel, ...plan.placed.cells]) occ2.add(cellKey(c.x, c.y, c.z));
      const used2 = new Set(used).add((plan.port as { index?: number }).index!);
      const rest = solve(i + 1, occ2, used2);
      if (rest) return [plan, ...rest];
    }
    return null;
  };
  const plans = solve(0, occ0, new Set()) ?? [];
  for (const plan of plans) {
    const { t, port } = plan;
    const [dx, dz] = DIR_VEC[port.dir];
    const section: Section = {
      id: nextId++,
      template: t.id,
      name: t.name,
      open: false,
      condition: t.condition,
    };
    sections.push(section);
    build(t, plan.placed, section, plan.tunnel);
    port.used = true;
    // Bulkhead across the seam between the parent port cell and the first section cell.
    const parentCell = occupied.get(cellKey(port.x, port.y, port.z))!;
    const first = occupied.get(cellKey(port.x + dx, port.y, port.z + dz))!;
    links.push({
      id: nextId++,
      a: parentCell.id,
      b: first.id,
      kind: 'bulkhead',
      sealed: true,
      seal: { kind: t.seal.kind as SealKind, label: t.seal.label, cost: t.seal.cost },
    });
  }

  const survivors = rollSurvivors(seed, defs, () => nextId++);
  // Spawn in core corridor cells on the core's main level (mid-depth: the bunker extends above too).
  const spawn = cells.filter(
    (c) => c.sectionId === core.id && c.kind === 'corridor' && c.y === CORE.spawnLevel,
  );
  survivors.forEach((s, i) => {
    const c = spawn[i % spawn.length]!;
    const p = cellCenter(c);
    s.level = c.y;
    s.x = p.x + ((i % 2) - 0.5) * 1.2;
    s.z = p.z + (i > 1 ? 1 : -1) * 0.8;
  });

  const store: Record<string, number> = {};
  for (const s of defs.balance.startingStore) store[s.item] = (store[s.item] ?? 0) + s.qty;
  const elevators = shafts
    .filter((s) => s.kind === 'elevator')
    .map((s) => ({ shaftId: s.id, pos: s.top, target: null, queue: [], doorTicks: 0, riders: [] }));

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed,
    tick: 0,
    nextId,
    cells,
    links,
    shafts,
    sections,
    rooms,
    survivors,
    elevators,
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

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** The section templates (for tests/tools). */
export const SECTION_IDS = SECTIONS.map((s) => s.id);

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
      level: 0,
      x: 0,
      z: 0,
      heading: 0,
      assignedRoom: null,
      action: 'idle',
      actionTarget: null,
      actionSince: 0,
      path: [],
      elevator: 'none',
      elevatorId: null,
    };
  });
}

export type { RoomTypeId };
