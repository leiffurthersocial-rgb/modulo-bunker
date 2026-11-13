import type { Defs } from '../../data/types';
import { Rng } from '../../gen/rng';
import type { SimEvent } from './events';
import type { Cell, Elevator, Link, Room, Shaft, SimState, Survivor } from './state';
import { cellKey } from './geometry';

/** RNG streams owned by the sim (generation streams live in gen/). */
export const SIM_STREAMS = ['events', 'ai', 'mystery', 'misc'] as const;
export type SimStream = (typeof SIM_STREAMS)[number];

/**
 * Runtime wrapper around SimState: content defs, live RNG objects, event outbox and id indexes.
 * Only `state` (plus RNG states written back by `snapshotRng`) is persisted.
 */
export class World {
  readonly rng: Record<SimStream, Rng>;
  outbox: SimEvent[] = [];
  private roomIndex = new Map<number, Room>();
  private cellIndex = new Map<number, Cell>();
  private cellAtIndex = new Map<string, Cell>();
  private linksByCell = new Map<number, Link[]>();
  private shaftIndex = new Map<number, Shaft>();
  private survivorIndex = new Map<number, Survivor>();
  private indexVersion = -1;
  /** Bumped whenever rooms/slots change shape; systems cache derived data against it. */
  topology = 0;

  constructor(
    public state: SimState,
    public readonly defs: Defs,
  ) {
    const r = {} as Record<SimStream, Rng>;
    for (const name of SIM_STREAMS) {
      const saved = state.rng[name];
      r[name] = saved ? new Rng(saved) : Rng.stream(state.seed, `sim:${name}`);
    }
    this.rng = r;
    this.reindex();
  }

  /** Writes live RNG states into state.rng (call before saving/hashing). */
  snapshotRng(): void {
    for (const name of SIM_STREAMS) this.state.rng[name] = this.rng[name].getState();
  }

  emit(e: SimEvent): void {
    this.outbox.push(e);
  }

  nextId(): number {
    return this.state.nextId++;
  }

  markTopologyChanged(): void {
    this.topology++;
  }

  private reindex(): void {
    this.roomIndex.clear();
    this.cellIndex.clear();
    this.cellAtIndex.clear();
    this.linksByCell.clear();
    this.shaftIndex.clear();
    this.survivorIndex.clear();
    for (const r of this.state.rooms) this.roomIndex.set(r.id, r);
    for (const c of this.state.cells) {
      this.cellIndex.set(c.id, c);
      this.cellAtIndex.set(cellKey(c.x, c.y, c.z), c);
    }
    for (const l of this.state.links) {
      for (const id of [l.a, l.b]) {
        let arr = this.linksByCell.get(id);
        if (!arr) this.linksByCell.set(id, (arr = []));
        arr.push(l);
      }
    }
    for (const s of this.state.shafts) this.shaftIndex.set(s.id, s);
    for (const s of this.state.survivors) this.survivorIndex.set(s.id, s);
    this.indexVersion = this.topology;
  }
  private ensureIndex(): void {
    if (this.indexVersion !== this.topology) this.reindex();
  }

  room(id: number | null | undefined): Room | undefined {
    if (id == null) return undefined;
    this.ensureIndex();
    return this.roomIndex.get(id);
  }
  cell(id: number | null | undefined): Cell | undefined {
    if (id == null) return undefined;
    this.ensureIndex();
    return this.cellIndex.get(id);
  }
  cellAt(x: number, y: number, z: number): Cell | undefined {
    this.ensureIndex();
    return this.cellAtIndex.get(cellKey(x, y, z));
  }
  linksOf(cellId: number): Link[] {
    this.ensureIndex();
    return this.linksByCell.get(cellId) ?? [];
  }
  shaft(id: number | null | undefined): Shaft | undefined {
    if (id == null) return undefined;
    this.ensureIndex();
    return this.shaftIndex.get(id);
  }
  elevator(shaftId: number): Elevator | undefined {
    return this.state.elevators.find((e) => e.shaftId === shaftId);
  }
  /** Is this cell inside an open (reachable) section? */
  cellOpen(c: Cell): boolean {
    return this.state.sections.find((s) => s.id === c.sectionId)?.open ?? false;
  }
  roomOpen(r: Room): boolean {
    return this.state.sections.find((s) => s.id === r.sectionId)?.open ?? false;
  }
  survivor(id: number): Survivor | undefined {
    this.ensureIndex();
    return this.survivorIndex.get(id);
  }
}
