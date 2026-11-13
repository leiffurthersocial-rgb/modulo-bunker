import type { Defs } from '../../data/types';
import { Rng } from '../../gen/rng';
import type { SimEvent } from './events';
import type { Room, SimState, Slot, Survivor } from './state';

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
  private slotIndex = new Map<number, Slot>();
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
    this.slotIndex.clear();
    this.survivorIndex.clear();
    for (const r of this.state.rooms) this.roomIndex.set(r.id, r);
    for (const s of this.state.slots) this.slotIndex.set(s.id, s);
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
  slot(id: number): Slot | undefined {
    this.ensureIndex();
    return this.slotIndex.get(id);
  }
  survivor(id: number): Survivor | undefined {
    this.ensureIndex();
    return this.survivorIndex.get(id);
  }
  slotAt(floor: number, side: -1 | 1, index: number): Slot | undefined {
    // Slots are generated in floor/side/index order: 8 per floor.
    const s = this.state.slots[floor * 8 + (side === -1 ? 0 : 4) + index];
    return s && s.floor === floor && s.side === side && s.index === index ? s : undefined;
  }
}
