import type { Defs, ItemStack } from './types';

/**
 * Cross-reference and sanity checks for content. Returns a list of human-readable problems
 * (empty = valid). Run in unit tests and in dev builds at startup.
 */
export function validateDefs(d: Defs): string[] {
  const errs: string[] = [];
  const err = (m: string) => errs.push(m);
  const stacks = (where: string, list: ItemStack[]) => {
    for (const s of list) {
      if (!d.items[s.item]) err(`${where}: unknown item "${s.item}"`);
      if (!(s.qty > 0)) err(`${where}: qty must be > 0 (${s.item})`);
    }
  };
  const idOk = (where: string, id: string) => {
    if (!/^[a-z][a-z0-9_]*$/.test(id)) err(`${where}: bad id "${id}"`);
  };
  const color = (where: string, c: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(c)) err(`${where}: bad color "${c}"`);
  };

  for (const it of Object.values(d.items)) {
    idOk('item', it.id);
    color(`item ${it.id}`, it.color);
  }
  for (const r of Object.values(d.rooms)) {
    idOk('room', r.id);
    color(`room ${r.id}`, r.color);
    if (r.tiers.length !== 3) err(`room ${r.id}: needs exactly 3 tiers`);
    if (![1, 2, 3].includes(r.maxWidth)) err(`room ${r.id}: maxWidth must be 1..3`);
    if (r.skill && !d.skills[r.skill]) err(`room ${r.id}: unknown skill ${r.skill}`);
    if (r.mergeBonus.length !== 3 || r.mergeBonus[0] !== 1) err(`room ${r.id}: mergeBonus must start at 1`);
    for (let i = 1; i < 3; i++)
      if ((r.mergeBonus[i] ?? 0) < (r.mergeBonus[i - 1] ?? 0))
        err(`room ${r.id}: mergeBonus must not decrease`);
    r.tiers.forEach((t, i) => {
      const w = `room ${r.id} tier ${i + 1}`;
      stacks(`${w} cost`, t.cost);
      if (t.powerDraw < 0) err(`${w}: negative powerDraw`);
      if (t.blocks < 1) err(`${w}: blocks must be >= 1`);
      for (const e of t.effects) {
        if (e.type === 'process') {
          stacks(`${w} process in`, e.inputs);
          stacks(`${w} process out`, e.outputs);
          if (e.outputs.length === 0) err(`${w}: process without outputs`);
        }
        if (e.type === 'scrub' && e.consumes) stacks(`${w} scrub`, e.consumes);
      }
    });
  }
  for (const m of Object.values(d.machines)) {
    idOk('machine', m.id);
    stacks(`machine ${m.id} cost`, m.cost);
    for (const rid of m.recipes) if (!d.recipes[rid]) err(`machine ${m.id}: unknown recipe ${rid}`);
    for (const rid of m.allowedRooms) if (!d.rooms[rid]) err(`machine ${m.id}: unknown room ${rid}`);
  }
  for (const r of Object.values(d.recipes)) {
    idOk('recipe', r.id);
    if (!d.machines[r.machine]) err(`recipe ${r.id}: unknown machine ${r.machine}`);
    stacks(`recipe ${r.id} in`, r.inputs);
    stacks(`recipe ${r.id} out`, r.outputs);
    if (!(r.seconds > 0)) err(`recipe ${r.id}: seconds must be > 0`);
  }
  for (const t of Object.values(d.traits)) {
    for (const k of Object.keys(t.needDecay ?? {})) if (!d.needs[k]) err(`trait ${t.id}: unknown need ${k}`);
    for (const k of Object.keys(t.skillBonus ?? {}))
      if (!d.skills[k]) err(`trait ${t.id}: unknown skill ${k}`);
    for (const k of t.excludes ?? []) if (!d.traits[k]) err(`trait ${t.id}: unknown excluded trait ${k}`);
  }
  for (const s of d.survivors)
    for (const a of s.aptitudes) if (!d.skills[a]) err(`survivor ${s.id}: unknown aptitude ${a}`);
  stacks('balance startingStore', d.balance.startingStore);

  // Recipe graph: every item must be obtainable from something (starting store, a room process,
  // a machine recipe) or be explicitly a pure input like ice from the intake.
  const producible = new Set<string>(d.balance.startingStore.map((s) => s.item));
  for (const r of Object.values(d.rooms))
    for (const t of r.tiers)
      for (const e of t.effects) if (e.type === 'process') e.outputs.forEach((o) => producible.add(o.item));
  for (const r of Object.values(d.recipes)) r.outputs.forEach((o) => producible.add(o.item));
  for (const it of Object.values(d.items)) if (!producible.has(it.id)) err(`item ${it.id}: not obtainable`);

  return errs;
}
