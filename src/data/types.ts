/**
 * Content definition types. All game content lives in JSON next to this file and is checked by
 * validate.ts in tests/dev. Ids are lowercase snake_case strings and are referenced across files.
 */

export type ItemId = string;
export type RoomTypeId = string;
export type SkillId = string;
export type MachineTypeId = string;

export interface ItemStack {
  item: ItemId;
  qty: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Greybox colour (hex) for belt items and UI chips. */
  color: string;
  /** Can travel on conveyors (bulk liquids cannot). */
  conveyable: boolean;
  /** Fraction lost per game day while in the store (food spoilage). 0 = never. */
  spoilPerDay?: number;
  /** HUD group. */
  category: 'raw' | 'material' | 'food' | 'water' | 'medical' | 'part' | 'mystery';
}

/**
 * A room effect, scaled each tick by: cells (merge width) x tier values x staffing x power.
 * Effects are listed per tier so upgrades can change layout and numbers freely.
 */
export type RoomEffect =
  /** Generates electrical power (kW) per cell. */
  | { type: 'power'; kw: number }
  /** Pushes heat (kW) into the bunker heating loop per cell (boiler). */
  | { type: 'heatSupply'; kw: number }
  /** Removes CO2 (ppm-units per game hour over the whole bunker volume) per cell. */
  | { type: 'scrub'; perHour: number; consumes?: ItemStack[] }
  /** Converts inputs to outputs per game hour per cell at full efficiency. */
  | { type: 'process'; perHour: number; inputs: ItemStack[]; outputs: ItemStack[]; unstaffed?: number }
  /** Adds store capacity (units) per cell. */
  | { type: 'storage'; capacity: number }
  /** Beds per cell (sleep need recovers fastest here). */
  | { type: 'beds'; count: number }
  /** Place to eat; meals cooked here restore more hunger. */
  | { type: 'dining'; seats: number }
  /** Recovers social/purpose needs for survivors spending time here. */
  | { type: 'recreation'; perHour: number }
  /** Medical treatment rate (health per game hour) per cell. */
  | { type: 'medical'; perHour: number }
  /** Unlocks/feeds the mystery feed (Phase 2). */
  | { type: 'signal'; strength: number };

export interface RoomTierDef {
  /** Cost to build (tier 1) or to upgrade into this tier, per cell. */
  cost: ItemStack[];
  /** Electrical draw per cell (kW) when enabled. */
  powerDraw: number;
  /** Waste heat into the module (kW per cell); positive warms the room. */
  wasteHeat: number;
  /** Worker slots per cell. 0 = no staffing needed. */
  workersPerCell: number;
  effects: RoomEffect[];
  /** Greybox: number of prop blocks per cell (visual tier read-out). */
  blocks: number;
}

export interface RoomDef {
  id: RoomTypeId;
  name: string;
  /** Short label for floating text. */
  short: string;
  color: string;
  category: 'power' | 'life' | 'production' | 'social' | 'special';
  /** Max merged width in cells (1-3). */
  maxWidth: 1 | 2 | 3;
  /** Can the player build this type from the build menu. */
  buildable: boolean;
  /** Skill that boosts this room's output when staffed. */
  skill?: SkillId;
  /** Default power priority 1 (critical) .. 4 (luxury). Shed from 4 first. */
  priority: 1 | 2 | 3 | 4;
  /** Production multiplier per merged width, index = width-1. e.g. [1, 2.2, 3.6]. */
  mergeBonus: [number, number, number];
  tiers: [RoomTierDef, RoomTierDef, RoomTierDef];
  description: string;
}

export interface RecipeDef {
  id: string;
  machine: MachineTypeId;
  inputs: ItemStack[];
  outputs: ItemStack[];
  /** Game seconds per craft at tier 1. */
  seconds: number;
}

export interface MachineDef {
  id: MachineTypeId;
  name: string;
  color: string;
  /** Footprint in 1 m grid units inside a room. */
  size: { w: number; d: number };
  powerDraw: number;
  /** Wear gained per game hour of operation (0..1 scale; 1 = broken). */
  wearPerHour: number;
  inputSlots: number;
  outputSlots: number;
  /** Max items buffered per slot. */
  slotCapacity: number;
  recipes: string[];
  /** Room types this machine may be placed in. Empty = any operational room. */
  allowedRooms: RoomTypeId[];
  cost: ItemStack[];
}

export interface ConveyorTierDef {
  id: string;
  /** Items per game minute at full flow. */
  itemsPerMinute: number;
  /** Belt speed in metres per game second. */
  speed: number;
  cost: ItemStack[];
}

export interface SkillDef {
  id: SkillId;
  name: string;
}

export interface NeedDef {
  id: string;
  name: string;
  /** Decay per game hour at rest (0..100 scale; 100 = fully satisfied). */
  decayPerHour: number;
  /** Below this the survivor considers it urgent. */
  low: number;
  critical: number;
  /** Health damage per game hour while at 0. */
  healthDamagePerHour: number;
}

export interface TraitDef {
  id: string;
  name: string;
  description: string;
  /** Multipliers on need decay keyed by need id, e.g. { "social": 1.5 }. */
  needDecay?: Record<string, number>;
  /** Additive skill offsets applied at roll time. */
  skillBonus?: Record<SkillId, number>;
  /** Added to mental-break threshold (Phase 2). */
  breakThreshold?: number;
  /** Trait ids that can't be rolled together with this one. */
  excludes?: string[];
}

export interface SurvivorTemplate {
  /** Stable id; Phase 5 characters plug in by this id. */
  id: string;
  name: string;
  /** Greybox capsule colour. */
  color: string;
  /** Skills that roll higher for this survivor. */
  aptitudes: SkillId[];
}

export interface BalanceDef {
  outsideTempStart: number;
  outsideTempPerDay: number;
  outsideTempMin: number;
  /** Rock leak conductance per cell (kW per °C). */
  cellLeakKwPerC: number;
  /** Heat capacity per cell (kJ per °C). */
  cellHeatCapacity: number;
  comfortTemp: number;
  /** CO2 added per survivor per game hour (ppm-units). */
  co2PerPersonHour: number;
  co2Ambient: number;
  co2Bad: number;
  co2Lethal: number;
  /** Lights etc. drawn by every operational cell (kW). */
  baseCellDraw: number;
  /** Base store capacity without storage rooms. */
  baseStorage: number;
  /** Refund fraction on demolish. */
  demolishRefund: number;
  startingStore: ItemStack[];
  repairCostPerCell: ItemStack[];
  openFloorCost: ItemStack[];
  /** Spare power (kW) needed to re-energize a power-sealed door. */
  powerSealSurplusKw: number;
}

export interface Defs {
  items: Record<ItemId, ItemDef>;
  rooms: Record<RoomTypeId, RoomDef>;
  machines: Record<MachineTypeId, MachineDef>;
  recipes: Record<string, RecipeDef>;
  conveyors: ConveyorTierDef[];
  skills: Record<SkillId, SkillDef>;
  needs: Record<string, NeedDef>;
  traits: Record<string, TraitDef>;
  survivors: SurvivorTemplate[];
  balance: BalanceDef;
}
