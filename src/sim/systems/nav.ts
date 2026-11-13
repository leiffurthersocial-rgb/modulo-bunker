/**
 * Navigation over the cell graph (Dijkstra; the graph is small). Nodes are walkable cells: cells
 * in open sections at a room's lowest level (the upper part of tall rooms has no floor). Edges:
 * unsealed doors, open floor inside multi-cell rooms, elevator rides between landings, and ladder
 * climbs between consecutive levels. Broken shafts are not traversable.
 */
import { cellCenter, doorPoint } from '../core/geometry';
import type { Cell, Waypoint } from '../core/state';
import type { World } from '../core/world';

interface Edge {
  to: number;
  cost: number;
  via?: Waypoint['via'];
  door?: { x: number; z: number };
}

const CELL_COST = 6;

/** Lowest level of each room (cache keyed by topology version). */
let cache: { world: World; topology: number; graph: Map<number, Edge[]>; walkable: Set<number> } | null =
  null;

export function walkable(w: World, c: Cell): boolean {
  if (!w.cellOpen(c)) return false;
  if (c.roomId !== null) {
    const r = w.room(c.roomId)!;
    let lowest = -Infinity;
    for (const id of r.cellIds) lowest = Math.max(lowest, w.cell(id)!.y);
    return c.y === lowest;
  }
  return true;
}

export function graph(w: World): Map<number, Edge[]> {
  if (cache && cache.world === w && cache.topology === w.topology) return cache.graph;
  const g = new Map<number, Edge[]>();
  const walk = new Set<number>();
  for (const c of w.state.cells) if (walkable(w, c)) walk.add(c.id);
  const add = (a: number, e: Edge) => {
    if (!g.has(a)) g.set(a, []);
    g.get(a)!.push(e);
  };
  for (const l of w.state.links) {
    if (l.sealed || !walk.has(l.a) || !walk.has(l.b)) continue;
    const a = w.cell(l.a)!;
    const b = w.cell(l.b)!;
    const door = doorPoint(a, b);
    add(a.id, { to: b.id, cost: CELL_COST, door });
    add(b.id, { to: a.id, cost: CELL_COST, door });
  }
  // Open floor inside multi-cell rooms.
  for (const r of w.state.rooms) {
    const cells = r.cellIds.map((id) => w.cell(id)!).filter((c) => walk.has(c.id));
    for (const a of cells)
      for (const b of cells)
        if (a.id !== b.id && a.y === b.y && Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1)
          add(a.id, { to: b.id, cost: CELL_COST, door: doorPoint(a, b) });
  }
  // Shafts.
  for (const s of w.state.shafts) {
    if (s.broken) continue;
    const col = w.state.cells.filter((c) => c.shaftId === s.id && walk.has(c.id)).sort((a, b) => a.y - b.y);
    if (s.kind === 'elevator') {
      // Landings: shaft cells with at least one usable door.
      const landings = col.filter((c) => (g.get(c.id) ?? []).length > 0);
      for (const a of landings)
        for (const b of landings)
          if (a !== b)
            add(a.id, {
              to: b.id,
              cost: 10 + 3 * Math.abs(a.y - b.y),
              via: { kind: 'elevator', shaftId: s.id },
            });
    } else {
      for (let i = 0; i + 1 < col.length; i++) {
        const a = col[i]!;
        const b = col[i + 1]!;
        if (b.y !== a.y + 1) continue;
        add(a.id, { to: b.id, cost: 14, via: { kind: 'ladder', shaftId: s.id } });
        add(b.id, { to: a.id, cost: 14, via: { kind: 'ladder', shaftId: s.id } });
      }
    }
  }
  cache = { world: w, topology: w.topology, graph: g, walkable: walk };
  return g;
}

/** Cell containing a survivor/point (any walkable cell at that level and grid position). */
export function cellOfPoint(w: World, level: number, x: number, z: number): Cell | undefined {
  return w.cellAt(Math.floor(x / 6), level, Math.floor(z / 6));
}

/** Dijkstra from one cell; returns distances and predecessor edges. */
export function search(
  w: World,
  from: number,
): { dist: Map<number, number>; prev: Map<number, { from: number; edge: Edge }> } {
  const g = graph(w);
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, { from: number; edge: Edge }>();
  const open: number[] = [from];
  const done = new Set<number>();
  while (open.length) {
    // Small graphs: linear scan for the minimum keeps it simple and deterministic.
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]!)! < dist.get(open[bi]!)!) bi = i;
    const u = open.splice(bi, 1)[0]!;
    if (done.has(u)) continue;
    done.add(u);
    for (const e of g.get(u) ?? []) {
      const nd = dist.get(u)! + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: u, edge: e });
        open.push(e.to);
      }
    }
  }
  return { dist, prev };
}

/**
 * Waypoints from a position to a target point inside `targetCell`.
 * Returns null when unreachable.
 */
export function findPath(
  w: World,
  from: { level: number; x: number; z: number },
  targetCell: number,
  target: { x: number; z: number },
): Waypoint[] | null {
  const start = cellOfPoint(w, from.level, from.x, from.z);
  if (!start) return null;
  const tc = w.cell(targetCell)!;
  if (start.id === targetCell) return [{ level: tc.y, x: target.x, z: target.z }];
  const { prev } = search(w, start.id);
  if (!prev.has(targetCell)) return null;
  const steps: { from: number; edge: Edge }[] = [];
  for (let at = targetCell; at !== start.id;) {
    const p = prev.get(at)!;
    steps.push(p);
    at = p.from;
  }
  steps.reverse();
  const out: Waypoint[] = [];
  for (const s of steps) {
    const a = w.cell(s.from)!;
    const b = w.cell(s.edge.to)!;
    if (s.edge.door) out.push({ level: a.y, x: s.edge.door.x, z: s.edge.door.z });
    else if (s.edge.via) {
      const ca = cellCenter(a);
      const cb = cellCenter(b);
      if (s.edge.via.kind === 'elevator') {
        out.push({ level: a.y, x: ca.x, z: ca.z - 2.2 });
        out.push({ level: b.y, x: cb.x, z: cb.z, via: s.edge.via });
        out.push({ level: b.y, x: cb.x, z: cb.z - 2.2 });
      } else {
        const lx = a.x * 6 + 0.45;
        const lz = a.z * 6 + 0.45;
        out.push({ level: a.y, x: lx, z: lz });
        out.push({ level: b.y, x: lx, z: lz, via: s.edge.via });
      }
    }
  }
  out.push({ level: tc.y, x: target.x, z: target.z });
  return out;
}

/** Cells reachable from a point (for "can I get there" checks). */
export function reachableFrom(w: World, level: number, x: number, z: number): Set<number> {
  const start = cellOfPoint(w, level, x, z);
  if (!start) return new Set();
  return new Set(search(w, start.id).dist.keys());
}
