/**
 * The complete, JSON-serializable simulation state. Saves are `SimState` + schema version.
 * Everything is plain data, indexed by numeric ids, iterated in id order (determinism).
 */
import type { ItemId, RoomTypeId } from '../../data/types';

export const SAVE_SCHEMA_VERSION = 1;

/** Geometry constants (metres). World: x = along floor (left/right of shaft), y = up, z = depth. */
export const GEO = {
  shaftWidth: 4,
  cellWidth: 6,
  cellHeight: 3.5,
  cellDepth: 8,
  slab: 0.5,
  /** Vertical distance between floor surfaces. */
  floorPitch: 4,
  cellsPerSide: 4,
  /** Door centre z (doors along the back of each cell, near the shaft landing). */
  doorZ: -2,
  doorWidth: 2,
  doorHeight: 2.3,
} as const;

export type Side = -1 | 1;
export type SlotState = 'rock' | 'empty' | 'sealed' | 'room';
export type SealKind = 'power' | 'repair' | 'keycard';

export interface Slot {
  id: number;
  floor: number;
  side: Side;
  /** 0 = next to the shaft .. 3 = outermost. */
  index: number;
  state: SlotState;
  roomId: number | null;
  /** For sealed slots: how to open, and what is behind. */
  seal?: {
    kind: SealKind;
    cost: { item: ItemId; qty: number }[];
    hiddenRoom?: RoomTypeId;
    loot?: { item: ItemId; qty: number }[];
  };
}

export interface Room {
  id: number;
  type: RoomTypeId;
  /** 1..3 */
  tier: number;
  /** Slot ids, ordered from shaft outward. */
  slotIds: number[];
  /** Damaged rooms do nothing until repaired. */
  damaged: boolean;
  /** Player toggle. */
  enabled: boolean;
  /** Power priority 1..4 (1 = most critical). */
  priority: number;
  /** Module temperature (°C). */
  temp: number;
  /** Fraction of power supplied last tick (0..1). */
  powered: number;
  /** Fractional progress carried between ticks per effect index (process effects). */
  progress: number[];
  /** Survivors assigned to work here. */
  workers: number[];
}

export type FloorState = 'open' | 'sealed' | 'unexcavated';
export interface Floor {
  index: number;
  state: FloorState;
}

export interface Survivor {
  id: number;
  templateId: string;
  name: string;
  color: string;
  skills: Record<string, number>;
  traits: string[];
  /** 0..100, 100 = satisfied. */
  needs: Record<string, number>;
  health: number;
  stress: number;
  /** Position: floor + continuous x/z within the floor. When riding the elevator, floor = car floor. */
  floor: number;
  x: number;
  z: number;
  /** Facing angle (radians, render only), computed from movement with exact math. */
  heading: number;
  assignedRoom: number | null;
  /** Current action id and its target. */
  action: string;
  actionTarget: number | null;
  actionSince: number;
  /** Remaining waypoint path (world x,z with floor). */
  path: { floor: number; x: number; z: number; via?: 'elevator' }[];
  /** Elevator state for this survivor. */
  elevator: 'none' | 'waiting' | 'riding';
}

export interface Elevator {
  /** Car floor position (continuous; floor index units). */
  pos: number;
  target: number | null;
  /** Pending floor requests (FIFO, unique). */
  queue: number[];
  /** Ticks remaining with doors open at the current floor. */
  doorTicks: number;
  /** Who is in the car (survivor ids). The player rides physically, not tracked here. */
  riders: number[];
}

export interface PowerState {
  produced: number;
  demand: number;
  /** Priorities >= this were shed (5 = nothing shed). */
  shedFrom: number;
}

export interface MachineState {
  id: number;
  type: string;
  roomId: number;
  /** Local grid position inside the room (metres from room's shaft-side/back corner). */
  gx: number;
  gz: number;
  /** 0..3 rotation (90° steps). */
  rot: number;
  recipe: string;
  inputs: Record<ItemId, number>;
  outputs: Record<ItemId, number>;
  progress: number;
  wear: number;
  enabled: boolean;
  powered: number;
}

/**
 * Conveyor lane (Factorio FFF #176 model). Items are stored as gaps; positions are in
 * integer fixed-point units (1 m = 256 units). gaps[0] = distance from lane start to first item;
 * gaps[i] = distance from item i-1 to item i. `tail` = distance from last item to lane end.
 */
export interface Lane {
  id: number;
  /** Polyline in world space (floor-local x/z), all on one floor for Phase 1. */
  floor: number;
  points: { x: number; z: number }[];
  /** Total length in fixed-point units. */
  length: number;
  items: ItemId[];
  gaps: number[];
  /** Fixed-point units moved per tick. */
  speed: number;
  /** Where items come from / go to. */
  from: PortRef | null;
  to: PortRef | null;
}

export type PortRef =
  { kind: 'machine'; id: number; slot: number } | { kind: 'room'; id: number } | { kind: 'store' };

export interface PipeNetwork {
  id: number;
  /** Liquid item carried (e.g. raw_water). */
  fluid: ItemId;
  volume: number;
  capacity: number;
  /** Segments for rendering, floor-local. */
  segments: { floor: number; x1: number; z1: number; x2: number; z2: number }[];
  /** Machine ports that push into / pull from this network. */
  producers: { machineId: number }[];
  consumers: { machineId: number }[];
  /** If true, overflow drains into the bunker store. */
  toStore: boolean;
}

export interface SimState {
  schemaVersion: number;
  seed: string;
  tick: number;
  nextId: number;
  floors: Floor[];
  slots: Slot[];
  rooms: Room[];
  survivors: Survivor[];
  elevator: Elevator;
  store: Record<ItemId, number>;
  power: PowerState;
  /** Bunker-wide CO2 (ppm). */
  co2: number;
  outsideTemp: number;
  machines: MachineState[];
  lanes: Lane[];
  pipes: PipeNetwork[];
  /** Serialized RNG stream states. */
  rng: Record<string, [number, number, number, number]>;
  flags: Record<string, boolean>;
}
