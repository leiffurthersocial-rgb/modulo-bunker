import type { World } from '../sim';
import type { TabletView } from '../ui/tabletTypes';
import { storeCapacity, storeUsed } from '../sim/core/store';

/** Builds the tablet's read-only view of the sim (called at UI rate while the tablet is open). */
export function buildTabletView(w: World): TabletView {
  const d = w.defs;
  const st = w.state;
  return {
    survivors: st.survivors.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      action: s.action,
      health: s.health,
      stress: s.stress,
      needs: Object.values(d.needs).map((n) => ({
        id: n.id,
        name: n.name,
        value: s.needs[n.id] ?? 0,
        low: n.low,
        critical: n.critical,
      })),
      skills: Object.values(d.skills).map((k) => ({ id: k.id, name: k.name, level: s.skills[k.id] ?? 0 })),
      traits: s.traits.map((t) => ({
        name: d.traits[t]?.name ?? t,
        description: d.traits[t]?.description ?? '',
      })),
      assignedRoomId: s.assignedRoom,
      floor: s.floor + 1,
    })),
    rooms: st.rooms.map((r) => {
      const def = d.rooms[r.type]!;
      return {
        id: r.id,
        name: def.name,
        short: def.short,
        color: def.color,
        floor: w.slot(r.slotIds[0]!)!.floor + 1,
        tier: r.tier,
        width: r.slotIds.length,
        damaged: r.damaged,
        enabled: r.enabled,
        priority: r.priority,
        powered: r.powered,
        temp: r.temp,
        workers: [...r.workers],
        capacity: def.tiers[r.tier - 1]!.workersPerCell * r.slotIds.length,
        skill: def.skill ? (d.skills[def.skill]?.name ?? def.skill) : null,
      };
    }),
    store: Object.entries(st.store)
      .filter(([, q]) => q > 0.05)
      .map(([id, qty]) => ({
        id,
        name: d.items[id]?.name ?? id,
        qty,
        color: d.items[id]?.color ?? '#888',
        category: d.items[id]?.category ?? 'other',
      })),
    storeUsed: storeUsed(w),
    storeCap: storeCapacity(w),
  };
}
