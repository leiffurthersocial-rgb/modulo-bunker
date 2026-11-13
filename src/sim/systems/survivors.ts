/**
 * Survivors (Phase 1 slice): needs decay, a simple utility chooser (re-decides at 2 Hz with
 * inertia), movement over the cell navigation graph, elevators and ladders. Full utility AI, moods and relationships
 * come in Phase 2 (same data shapes).
 */
import { AI_INTERVAL_TICKS, DT_HOURS, TICKS_PER_GAME_HOUR, clockOf } from '../core/time';
import { cellCenter, floorY } from '../core/geometry';
import type { Room, Survivor, Waypoint } from '../core/state';
import { GEO } from '../core/state';
import { cellOfPoint, findPath, reachableFrom } from './nav';
import { has, take } from '../core/store';
import type { World } from '../core/world';
import { isInRoom } from './rooms';

/** Metres per tick (0.1 s real at x1 = brisk walk 1.3 m/s on screen). */
export const WALK_PER_TICK = 0.13;
/** Elevator speed in levels per tick (2.4 m/s). */
export const ELEVATOR_PER_TICK = 0.24 / GEO.levelPitch;
const DOOR_TICKS = 25;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export type ActionId = 'idle' | 'work' | 'eat' | 'drink' | 'sleep' | 'warm' | 'relax' | 'downed';

/** Temperature the survivor currently feels. */
export function feltTemp(w: World, s: Survivor): number {
  const c = cellOfPoint(w, s.level, s.x, s.z);
  const r = c && w.room(c.roomId);
  if (r) return r.temp;
  // Corridors / shafts: average of open rooms in the same section, a bit colder.
  let sum = 0;
  let n = 0;
  for (const room of w.state.rooms)
    if (c && room.sectionId === c.sectionId && !room.damaged) {
      sum += room.temp;
      n++;
    }
  return n > 0 ? sum / n - 3 : w.state.outsideTemp + 15;
}

/** Usable rooms of a type the survivor can actually reach. */
function roomsOfType(w: World, type: string, reach: Set<number>): Room[] {
  return w.state.rooms.filter(
    (r) => r.type === type && !r.damaged && w.roomOpen(r) && roomCellIn(w, r, reach) !== null,
  );
}

/** A walkable cell of the room that is in `reach`, or null. */
function roomCellIn(w: World, r: Room, reach: Set<number>): number | null {
  for (const id of r.cellIds) if (reach.has(id)) return id;
  return null;
}

function nearestRoom(w: World, s: Survivor, rooms: Room[]): Room | undefined {
  let best: Room | undefined;
  let bestD = Infinity;
  for (const r of rooms) {
    const c = w.cell(r.cellIds[0]!)!;
    const p = cellCenter(c);
    const d = Math.abs(c.y - s.level) * 20 + Math.abs(p.x - s.x) + Math.abs(p.z - s.z);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

function foodAvailable(w: World): boolean {
  const st = w.state.store;
  return (st.meal ?? 0) >= 1 || (st.ration ?? 0) >= 1 || (st.produce ?? 0) >= 1;
}

interface Candidate {
  action: ActionId;
  target: Room | undefined;
  score: number;
}

function decide(w: World, s: Survivor): Candidate {
  const reach = reachableFrom(w, s.level, s.x, s.z);
  const n = s.needs;
  const hour = clockOf(w.state.tick).hour;
  const night = hour >= 22 || hour < 6;
  const inv = (v: number | undefined) => {
    const x = 1 - (v ?? 100) / 100;
    return x * x;
  };
  const c: Candidate[] = [{ action: 'idle', target: undefined, score: 0.05 }];
  const kitchen = nearestRoom(w, s, roomsOfType(w, 'kitchen', reach));
  if (foodAvailable(w))
    c.push({ action: 'eat', target: kitchen, score: inv(n.hunger) * 1.3 + (n.hunger! < 25 ? 0.4 : 0) });
  if ((w.state.store.water ?? 0) >= 0.5) {
    const tgt = kitchen ?? nearestRoom(w, s, roomsOfType(w, 'water_plant', reach));
    c.push({ action: 'drink', target: tgt, score: inv(n.thirst) * 1.5 + (n.thirst! < 25 ? 0.5 : 0) });
  }
  const beds = nearestRoom(w, s, roomsOfType(w, 'quarters', reach));
  c.push({ action: 'sleep', target: beds, score: inv(n.sleep) * 1.2 + (night && n.sleep! < 80 ? 0.3 : 0) });
  if (n.warmth! < 60) {
    let warmest: Room | undefined;
    for (const r of w.state.rooms)
      if (!r.damaged && roomCellIn(w, r, reach) !== null && (!warmest || r.temp > warmest.temp)) warmest = r;
    if (warmest && warmest.temp > feltTemp(w, s) + 2)
      c.push({ action: 'warm', target: warmest, score: inv(n.warmth) * 1.2 });
  }
  const assigned = w.room(s.assignedRoom);
  if (assigned && !assigned.damaged && roomCellIn(w, assigned, reach) !== null)
    c.push({ action: 'work', target: assigned, score: night ? 0.12 : 0.42 });
  const common = nearestRoom(w, s, roomsOfType(w, 'common', reach));
  if (common) {
    const m = Math.min(n.social ?? 100, n.purpose ?? 100);
    const x = 1 - m / 100;
    c.push({ action: 'relax', target: common, score: x * Math.sqrt(x) * 0.6 });
  }
  // Inertia: stick with the current action unless something is clearly better.
  for (const k of c) if (k.action === s.action && (k.target?.id ?? null) === s.actionTarget) k.score += 0.15;
  let best = c[0]!;
  for (const k of c) if (k.score > best.score) best = k;
  return best;
}

/** Is the current action complete (need satisfied)? */
function actionDone(s: Survivor): boolean {
  switch (s.action) {
    case 'eat':
      return s.needs.hunger! >= 90;
    case 'drink':
      return s.needs.thirst! >= 92;
    case 'sleep':
      return s.needs.sleep! >= 96;
    case 'warm':
      return s.needs.warmth! >= 80;
    default:
      return true;
  }
}

/** Spot inside a room for survivor k (spreads people out over its walkable cells). */
function spotIn(
  w: World,
  r: Room,
  k: number,
  reach: Set<number>,
): { cell: number; x: number; z: number } | null {
  const cells = r.cellIds.filter((id) => reach.has(id));
  if (cells.length === 0) return null;
  const cell = w.cell(cells[k % cells.length]!)!;
  const c = cellCenter(cell);
  const ox = ((k * 37) % 5) * 0.6 - 1.2;
  const oz = ((k * 53) % 3) * 0.9 - 0.4;
  return { cell: cell.id, x: c.x + ox, z: c.z + oz };
}

export function stepSurvivors(w: World): void {
  const st = w.state;
  const b = w.defs.balance;
  const decideNow = st.tick % AI_INTERVAL_TICKS === 0;
  for (const s of st.survivors) {
    // --- Needs ---
    const traitMul = (need: string) => {
      let m = 1;
      for (const t of s.traits) m *= w.defs.traits[t]?.needDecay?.[need] ?? 1;
      return m;
    };
    const resting = s.action === 'sleep' && s.path.length === 0;
    for (const [id, def] of Object.entries(w.defs.needs)) {
      if (id === 'warmth') continue;
      let decay = def.decayPerHour * traitMul(id);
      if (id === 'sleep' && resting) decay = 0;
      if (resting && id !== 'sleep') decay *= 0.5;
      s.needs[id] = clamp(s.needs[id]! - decay * DT_HOURS, 0, 100);
    }
    // Warmth tracks felt temperature (comfortable >= 16 °C, miserable <= 0 °C).
    const t = feltTemp(w, s);
    const target = clamp(((t - 0) / 16) * 100, 0, 100);
    s.needs.warmth = s.needs.warmth! + clamp(target - s.needs.warmth!, -25 * DT_HOURS, 25 * DT_HOURS);
    // Health: damage from depleted needs and bad air; slow regen when fine.
    let dmg = 0;
    for (const [id, def] of Object.entries(w.defs.needs))
      if (s.needs[id]! <= 0.01) dmg += def.healthDamagePerHour;
    if (st.co2 > b.co2Bad) dmg += ((st.co2 - b.co2Bad) / (b.co2Lethal - b.co2Bad)) * 4;
    const allOk = Object.entries(w.defs.needs).every(([id, def]) => s.needs[id]! > def.low);
    s.health = clamp(s.health - dmg * DT_HOURS + (allOk ? 0.8 * DT_HOURS : 0), 0, 100);
    // Stress: rises with unmet needs, falls with rest/recreation.
    let lows = 0;
    for (const [id, def] of Object.entries(w.defs.needs)) if (s.needs[id]! < def.low) lows++;
    const relief = resting || s.action === 'relax' ? 3 : 0;
    s.stress = clamp(s.stress + (lows * 1.5 - relief - 0.3) * DT_HOURS, 0, 100);

    if (s.health <= 0 && s.action !== 'downed') {
      s.action = 'downed';
      s.path = [];
      w.emit({ type: 'notice', text: `${s.name} has collapsed`, severity: 'danger' });
    }
    if (s.action === 'downed') {
      if (s.health > 25) s.action = 'idle';
      else {
        s.health = clamp(s.health + (allOk ? 0.5 : 0) * DT_HOURS, 0, 100);
        continue;
      }
    }

    // --- Decide ---
    const committed = (s.action === 'eat' || s.action === 'drink' || s.action === 'sleep') && !actionDone(s);
    if (decideNow && !committed && s.elevator === 'none') {
      const d = decide(w, s);
      const tid = d.target?.id ?? null;
      if (d.action !== s.action || tid !== s.actionTarget) {
        s.action = d.action;
        s.actionTarget = tid;
        s.actionSince = st.tick;
        const k = d.target ? Math.max(0, d.target.workers.indexOf(s.id)) + s.id : s.id;
        const reach = reachableFrom(w, s.level, s.x, s.z);
        const spot = d.target ? spotIn(w, d.target, k, reach) : null;
        const here = cellOfPoint(w, s.level, s.x, s.z);
        const path = spot
          ? findPath(w, s, spot.cell, spot)
          : here
            ? findPath(w, s, here.id, { x: s.x + ((s.id % 3) - 1) * 0.6, z: s.z })
            : null;
        s.path = path ?? [];
      }
    }

    // --- Move ---
    moveAlongPath(w, s);

    // --- Perform (only when arrived) ---
    if (s.path.length === 0) perform(w, s);
  }
}

function perform(w: World, s: Survivor): void {
  const st = w.state;
  const h = DT_HOURS;
  switch (s.action) {
    case 'eat': {
      // One portion every 20 game minutes until satisfied.
      if (s.needs.hunger! < 90 && st.tick % (TICKS_PER_GAME_HOUR / 3) === 0) {
        const food = (st.store.meal ?? 0) >= 1 ? 'meal' : (st.store.ration ?? 0) >= 1 ? 'ration' : 'produce';
        const gain = food === 'meal' ? 45 : food === 'ration' ? 35 : 18;
        if (take(w, [{ item: food, qty: 1 }])) s.needs.hunger = clamp(s.needs.hunger! + gain, 0, 100);
        else s.action = 'idle';
      }
      break;
    }
    case 'drink':
      if (s.needs.thirst! < 92 && st.tick % (TICKS_PER_GAME_HOUR / 6) === 0) {
        if (has(w, [{ item: 'water', qty: 0.5 }])) {
          take(w, [{ item: 'water', qty: 0.5 }]);
          s.needs.thirst = clamp(s.needs.thirst! + 40, 0, 100);
        } else s.action = 'idle';
      }
      break;
    case 'sleep': {
      const inBed = s.actionTarget !== null;
      s.needs.sleep = clamp(s.needs.sleep! + (inBed ? 16 : 8) * h, 0, 100);
      break;
    }
    case 'work':
      s.needs.purpose = clamp(s.needs.purpose! + 3 * h, 0, 100);
      break;
    case 'relax': {
      const r = w.room(s.actionTarget);
      const fx = r && w.defs.rooms[r.type]!.tiers[r.tier - 1]!.effects.find((e) => e.type === 'recreation');
      const rate = fx && fx.type === 'recreation' ? fx.perHour : 6;
      s.needs.social = clamp(s.needs.social! + rate * h, 0, 100);
      s.needs.purpose = clamp(s.needs.purpose! + rate * 0.5 * h, 0, 100);
      break;
    }
  }
}

/** Ladder climb speed in levels per tick (0.06 m/tick on a 4 m pitch). */
const CLIMB_PER_TICK = 0.06 / GEO.levelPitch;

function moveAlongPath(w: World, s: Survivor): void {
  if (s.elevator === 'riding') {
    const el = w.elevator(s.elevatorId!)!;
    const next = s.path[0];
    s.level = Math.round(el.pos);
    if (next && el.doorTicks > 0 && Math.abs(el.pos - next.level) < 1e-6) {
      s.elevator = 'none';
      s.elevatorId = null;
      s.level = next.level;
      s.x = next.x;
      s.z = next.z;
      el.riders = el.riders.filter((id) => id !== s.id);
      s.path.shift();
    }
    return;
  }
  let budget = WALK_PER_TICK;
  while (budget > 0 && s.path.length > 0) {
    const wp: Waypoint = s.path[0]!;
    if (wp.via?.kind === 'elevator') {
      const el = w.elevator(wp.via.shaftId);
      if (!el) {
        s.path = [];
        return;
      }
      if (s.elevator === 'none') {
        s.elevator = 'waiting';
        s.elevatorId = el.shaftId;
        if (!el.queue.includes(s.level)) el.queue.push(s.level);
      }
      if (s.elevator === 'waiting' && el.doorTicks > 0 && Math.abs(el.pos - s.level) < 1e-6) {
        s.elevator = 'riding';
        el.riders.push(s.id);
        if (!el.queue.includes(wp.level)) el.queue.push(wp.level);
      }
      return;
    }
    if (wp.via?.kind === 'ladder') {
      // Climb smoothly: `climb` holds the fractional level while on the ladder.
      const from = s.climb ?? s.level;
      const dir = wp.level > from ? 1 : -1;
      const next = from + dir * CLIMB_PER_TICK;
      if ((dir > 0 && next >= wp.level) || (dir < 0 && next <= wp.level)) {
        s.level = wp.level;
        delete s.climb;
        s.path.shift();
      } else s.climb = next;
      return;
    }
    s.level = wp.level;
    const dx = wp.x - s.x;
    const dz = wp.z - s.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= budget) {
      s.x = wp.x;
      s.z = wp.z;
      budget -= d;
      s.path.shift();
    } else {
      s.x += (dx / d) * budget;
      s.z += (dz / d) * budget;
      budget = 0;
    }
    if (d > 1e-6) s.heading = headingOf(dx, dz);
  }
}

/** Coarse 8-way heading without trig (render-only; exactness preserved). */
function headingOf(dx: number, dz: number): number {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  const q = Math.PI / 4;
  if (ax > 2 * az) return dx > 0 ? 2 * q : -2 * q;
  if (az > 2 * ax) return dz > 0 ? 0 : 4 * q;
  if (dx > 0) return dz > 0 ? q : 3 * q;
  return dz > 0 ? -q : -3 * q;
}

export function stepElevators(w: World): void {
  for (const el of w.state.elevators) {
    const shaft = w.shaft(el.shaftId);
    if (!shaft || shaft.broken) continue;
    if (el.doorTicks > 0) {
      el.doorTicks--;
      continue;
    }
    if (el.target === null) {
      const here = el.queue.findIndex((f) => Math.abs(f - el.pos) < 1e-6);
      if (here >= 0) {
        el.queue.splice(here, 1);
        el.doorTicks = DOOR_TICKS;
        continue;
      }
      const next = el.queue.shift();
      if (next === undefined) continue;
      el.target = Math.max(shaft.top, Math.min(shaft.bottom, next));
    }
    const dir = el.target > el.pos ? 1 : -1;
    const remaining = Math.abs(el.target - el.pos);
    if (remaining <= ELEVATOR_PER_TICK) {
      el.pos = el.target;
      el.target = null;
      el.doorTicks = DOOR_TICKS;
      el.queue = el.queue.filter((f) => f !== el.pos);
    } else el.pos += dir * ELEVATOR_PER_TICK;
  }
}

/** World-space y for a survivor (riding survivors follow the car). Render helper. */
export function survivorY(w: World, s: Survivor): number {
  if (s.elevator === 'riding') return floorY(w.elevator(s.elevatorId!)!.pos);
  return floorY(s.climb ?? s.level);
}
