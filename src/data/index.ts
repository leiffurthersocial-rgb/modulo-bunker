import items from './items.json';
import rooms from './rooms.json';
import machines from './machines.json';
import survivors from './survivors.json';
import balance from './balance.json';
import type { Defs, ItemDef, MachineDef, NeedDef, RecipeDef, RoomDef, SkillDef, TraitDef } from './types';

function byId<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list) out[x.id] = x;
  return out;
}

/** Builds the content database from the bundled JSON. JSON is cast; validate.ts checks it. */
export function loadDefs(): Defs {
  return {
    items: byId(items as ItemDef[]),
    rooms: byId(rooms as unknown as RoomDef[]),
    machines: byId(machines.machines as MachineDef[]),
    recipes: byId(machines.recipes as RecipeDef[]),
    conveyors: machines.conveyors,
    pipes: machines.pipes,
    handTicks: machines.handling.handTicks,
    skills: byId(survivors.skills as SkillDef[]),
    needs: byId(survivors.needs as NeedDef[]),
    traits: byId(survivors.traits as TraitDef[]),
    survivors: survivors.templates,
    balance,
  };
}

export type { Defs } from './types';
