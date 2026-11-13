/**
 * Sim -> outside world events. The sim appends to world.outbox during a tick; the runner drains
 * the outbox after each tick and publishes on an EventBus (UI, audio, render, later a horror director).
 */
export type SimEvent =
  | { type: 'room.built'; roomId: number; roomType: string; slotIds: number[] }
  | { type: 'room.upgraded'; roomId: number; tier: number }
  | { type: 'room.merged'; roomId: number; absorbedRoomId: number }
  | { type: 'room.demolished'; roomId: number; slotIds: number[] }
  | { type: 'slot.changed'; slotId: number }
  | { type: 'command.rejected'; command: string; reason: string }
  | { type: 'power.brownout'; shedPriority: number }
  | { type: 'power.restored' }
  | { type: 'survivor.assigned'; survivorId: number; roomId: number | null }
  | { type: 'survivor.need'; survivorId: number; need: string; level: 'low' | 'critical' }
  | { type: 'notice'; text: string; severity: 'info' | 'warn' | 'danger' };

export type SimEventType = SimEvent['type'];
type Handler<E> = (e: E) => void;

/** Tiny typed pub/sub. Pure TS (no DOM), usable from any layer. */
export class EventBus {
  private handlers = new Map<string, Set<Handler<SimEvent>>>();
  private any = new Set<Handler<SimEvent>>();

  on<T extends SimEventType>(type: T, fn: Handler<Extract<SimEvent, { type: T }>>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<SimEvent>);
    return () => set.delete(fn as Handler<SimEvent>);
  }
  onAny(fn: Handler<SimEvent>): () => void {
    this.any.add(fn);
    return () => this.any.delete(fn);
  }
  emit(e: SimEvent): void {
    this.handlers.get(e.type)?.forEach((h) => h(e));
    this.any.forEach((h) => h(e));
  }
}
