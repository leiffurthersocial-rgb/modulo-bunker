/**
 * The complete, JSON-serializable simulation state. Saves are `SimState` + schema version.
 * Everything is plain data, indexed by numeric ids, iterated in id order (determinism).
 */
import type { ItemId, RoomTypeId } from '../../data/types';

export const SAVE_SCHEMA_VERSION = 2;

/** Geometry constants (metres). World: x/z horizontal (cell grid), y up. Level 0 = top level. */
export const GEO = {
  /** Cell footprint (x and z). */
  cell: 6,
  /** Clear interior height of one level. */
  cellHeight: 3.5,
  slab: 0.5,
  /** Vertical distance between level floor surfaces. */
  levelPitch: 4,
  doorWidth: 2,
  doorHeight: 2.3,
} as const;

export type CellKind = 'room' | 'corridor' | 'shaft';
export type SealKind = 'power' | 'repair' | 'keycard' | 'thaw';

/** One grid cell. Cells only exist where the bunker is; everything else is rock. */
export interface Cell {
  id: number;
  x: number;
  /** Level index: 0 = top, increasing downward. */
  y: number;
  z: number;
  kind: CellKind;
  roomId: number | null;
  shaftId: number | null;
  sectionId: number;
}

/** A doorway / opening between two horizontally adjacent cells (or a hatch between levels). */
export interface Link {
  id: number;
  a: number;
  b: number;
  kind: 'door' | 'bulkhead';
  /** Bulkheads start sealed and gate whole sections. */
  sealed: boolean;
  seal?: { kind: SealKind; cost: { item: ItemId; qty: number }[]; label: string };
}

/** Vertical connector: elevator (one car) or ladder. Occupies a column of shaft cells. */
export interface Shaft {
  id: number;
  kind: 'elevator' | 'ladder';
  x: number;
  z: number;
  top: number;
  bottom: number;
  /** Broken shafts cannot be used until repaired. */
  broken: boolean;
  repairCost: { item: ItemId; qty: number }[];
}

export interface Section {
  id: number;
  template: string;
  name: string;
  /** True once the section's bulkhead is open (or for the starting core). */
  open: boolean;
  /** Flavour state while sealed: what is wrong in there. */
  condition: 'ok' | 'frozen' | 'dark' | 'collapsed' | 'sealed';
}

export interface Room {
  id: number;
  type: RoomTypeId;
  /** 1..3 */
  tier: number;
  /** Cell ids (any 3D shape). */
  cellIds: number[];
  sectionId: number;
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
  /** Position: level + continuous world x/z. While riding an elevator, level follows the car. */
  level: number;
  x: number;
  z: number;
  /** Facing angle (radians, render only), computed from movement with exact math. */
  heading: number;
  assignedRoom: number | null;
  /** Current action id and its target. */
  action: string;
  actionTarget: number | null;
  actionSince: number;
  /** Remaining waypoint path. `via` marks a vertical move (elevator ride or ladder climb). */
  path: Waypoint[];
  /** Elevator state for this survivor. */
  elevator: 'none' | 'waiting' | 'riding';
  /** Shaft id of the elevator being waited for / ridden. */
  elevatorId: number | null;
  /** Fractional level while climbing a ladder. */
  climb?: number;
}

export interface Waypoint {
  level: number;
  x: number;
  z: number;
  via?: { kind: 'elevator' | 'ladder'; shaftId: number };
}

export interface Elevator {
  shaftId: number;
  /** Car position (continuous; level units). */
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
  /** Cell the machine stands in, and its 1 m grid position inside that cell. */
  cellId: number;
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
  /** Polyline in world x/z, all on one level for Phase 1. */
  level: number;
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
  segments: { level: number; x1: number; z1: number; x2: number; z2: number }[];
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
  cells: Cell[];
  links: Link[];
  shafts: Shaft[];
  sections: Section[];
  rooms: Room[];
  survivors: Survivor[];
  elevators: Elevator[];
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
