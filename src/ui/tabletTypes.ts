/** Data contract between the game and the in-world "tablet" UI (survivors, rooms, store). */

export interface TabletNeed {
  id: string;
  name: string;
  /** 0..100, 100 = satisfied. */
  value: number;
  /** Below this the need is urgent (show warning colour). */
  low: number;
  critical: number;
}

export interface TabletSurvivor {
  id: number;
  name: string;
  color: string;
  /** Current action id: idle | work | eat | drink | sleep | warm | relax | downed */
  action: string;
  health: number;
  stress: number;
  needs: TabletNeed[];
  skills: { id: string; name: string; level: number }[];
  traits: { name: string; description: string }[];
  assignedRoomId: number | null;
  /** 1-based floor for display. */
  floor: number;
}

export interface TabletRoom {
  id: number;
  name: string;
  short: string;
  color: string;
  /** 1-based floor for display. */
  floor: number;
  tier: number;
  width: number;
  damaged: boolean;
  enabled: boolean;
  /** 1 (critical) .. 4 (luxury); shed from 4 first in a brownout. */
  priority: number;
  /** 0..1 power supplied last tick. */
  powered: number;
  temp: number;
  /** Survivor ids working here. */
  workers: number[];
  /** Worker slots (0 = nobody works here). */
  capacity: number;
  /** Skill name that boosts this room, if any. */
  skill: string | null;
}

export interface TabletItem {
  id: string;
  name: string;
  qty: number;
  color: string;
  category: string;
}

export interface TabletView {
  survivors: TabletSurvivor[];
  rooms: TabletRoom[];
  store: TabletItem[];
  storeUsed: number;
  storeCap: number;
}

export interface TabletActions {
  assign(survivorId: number, roomId: number | null): void;
  setPriority(roomId: number, priority: number): void;
  toggleRoom(roomId: number, enabled: boolean): void;
  close(): void;
}
