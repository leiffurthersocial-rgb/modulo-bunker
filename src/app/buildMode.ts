import * as THREE from 'three';
import type { Command, World } from '../sim';
import { checkCommand } from '../sim';
import { repairCost, roomCost } from '../sim/core/commands';
import { cellX0, cellZ0, floorY, doorPoint } from '../sim/core/geometry';
import { GEO } from '../sim/core/state';
import type { ItemStack } from '../data/types';
import { has } from '../sim/core/store';
import { freeSpot, inputConnected, outputConnected, recipeOf } from '../sim/systems/logistics';

export interface BuildAction {
  id: string;
  label: string;
  key: string;
  cost: ItemStack[];
  ok: boolean;
  reason?: string;
  command: Command;
  danger?: boolean;
}

export interface BuildTargetInfo {
  key: string;
  title: string;
  subtitle: string;
  actions: BuildAction[];
}

export interface BuildOption {
  id: string;
  short: string;
  name: string;
  color: string;
  cost: ItemStack[];
  affordable: boolean;
}

export type ManageTarget =
  | { kind: 'cell'; cellId: number; point?: { x: number; z: number } }
  | { kind: 'bulkhead'; linkId: number }
  | { kind: 'shaft'; shaftId: number }
  | { kind: 'machine'; id: number };

/**
 * Manage mode (the bunker is pre-built): repair / upgrade / refit rooms, open bulkheads, repair
 * shafts, place and connect machines. The chips choose the refit target type.
 */
export class BuildMode {
  active = false;
  selected = 'hydroponics';
  readonly ghost: THREE.Mesh;
  private ghostMat: THREE.MeshBasicMaterial;
  private armedRemove: { id: number; until: number } | null = null;

  constructor(private world: World) {
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: '#ffd84a',
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat);
    this.ghost.renderOrder = 15;
    this.ghost.visible = false;
  }

  options(): BuildOption[] {
    return Object.values(this.world.defs.rooms)
      .filter((r) => r.buildable)
      .map((r) => {
        const cost = roomCost(this.world, r.id, 1, 1);
        return {
          id: r.id,
          short: r.short,
          name: r.name,
          color: r.color,
          cost,
          affordable: has(this.world, cost),
        };
      });
  }

  private act(a: Omit<BuildAction, 'ok' | 'reason'>): BuildAction {
    const r = checkCommand(this.world, a.command);
    return r.ok ? { ...a, ok: true } : { ...a, ok: false, reason: r.reason };
  }

  analyze(t: ManageTarget | null): BuildTargetInfo | null {
    if (!t) return null;
    const w = this.world;
    if (t.kind === 'bulkhead') {
      const l = w.state.links.find((x) => x.id === t.linkId);
      if (!l?.seal || !l.sealed) return null;
      const sec = w.state.sections.find(
        (s) => s.id === (w.cellOpen(w.cell(l.a)!) ? w.cell(l.b)! : w.cell(l.a)!).sectionId,
      )!;
      return {
        key: `b${l.id}`,
        title: `Sealed bulkhead → ${sec.name}`,
        subtitle: l.seal.label,
        actions: [
          this.act({
            id: 'open',
            label: 'Open',
            key: 'E',
            cost: l.seal.cost,
            command: { type: 'openBulkhead', linkId: l.id },
          }),
        ],
      };
    }
    if (t.kind === 'shaft') {
      const s = w.shaft(t.shaftId);
      if (!s) return null;
      return {
        key: `s${s.id}`,
        title: s.broken ? `Broken ${s.kind}` : s.kind === 'elevator' ? 'Elevator' : 'Ladder',
        subtitle: `Levels ${s.top + 1}-${s.bottom + 1}`,
        actions: s.broken
          ? [
              this.act({
                id: 'repairShaft',
                label: 'Repair',
                key: 'E',
                cost: s.repairCost,
                command: { type: 'repairShaft', shaftId: s.id },
              }),
            ]
          : [],
      };
    }
    if (t.kind === 'machine') return this.analyzeMachine(t.id);
    const c = w.cell(t.cellId);
    if (!c) return null;
    const where = `Level ${c.y + 1}`;
    if (c.kind === 'corridor') return { key: `c${c.id}`, title: 'Corridor', subtitle: where, actions: [] };
    if (c.kind === 'shaft') {
      const s = w.shaft(c.shaftId)!;
      return this.analyze({ kind: 'shaft', shaftId: s.id });
    }
    const r = w.room(c.roomId)!;
    const def = w.defs.rooms[r.type]!;
    const actions: BuildAction[] = [];
    if (r.damaged)
      actions.push(
        this.act({
          id: 'repair',
          label: 'Repair',
          key: 'E',
          cost: repairCost(w, r),
          command: { type: 'repair', roomId: r.id },
        }),
      );
    if (def.buildable && r.tier < 3)
      actions.push(
        this.act({
          id: 'upgrade',
          label: `Upgrade to T${r.tier + 1}`,
          key: 'U',
          cost: roomCost(w, r.type, r.tier + 1, r.cellIds.length),
          command: { type: 'upgrade', roomId: r.id },
        }),
      );
    if ((def.buildable || r.type === 'empty') && this.selected !== r.type) {
      const target = w.defs.rooms[this.selected]!;
      actions.push(
        this.act({
          id: 'refit',
          label: `Refit → ${target.name}`,
          key: 'F',
          cost: roomCost(w, target.id, 1, r.cellIds.length),
          command: { type: 'refit', roomId: r.id, roomType: target.id },
        }),
      );
    }
    for (const m of Object.values(w.defs.machines)) {
      if (m.allowedRooms.length && !m.allowedRooms.includes(r.type)) continue;
      const spot = freeSpot(w, r.id, m.id, t.point);
      actions.push(
        this.act({
          id: `place:${m.id}`,
          label: `Place ${m.name}`,
          key: '',
          cost: m.cost,
          command: spot
            ? { type: 'placeMachine', machine: m.id, ...spot }
            : { type: 'placeMachine', machine: m.id, cellId: -1, gx: 0, gz: 0 },
        }),
      );
    }
    if (!actions.length || !actions[0]!.ok) {
      // Keep the most useful action first: repair > upgrade > refit.
    }
    const open = w.roomOpen(r);
    return {
      key: `r${r.id}`,
      title: `${def.name} T${r.tier}${r.damaged ? ' (damaged)' : ''}`,
      subtitle: `${where} · ${r.cellIds.length} cell(s) · ${open ? `${r.workers.length} worker(s)` : 'sealed section'}`,
      actions,
    };
  }

  private analyzeMachine(id: number): BuildTargetInfo | null {
    const w = this.world;
    const m = w.state.machines.find((x) => x.id === id);
    if (!m) return null;
    const def = w.defs.machines[m.type]!;
    const rec = recipeOf(w, m);
    const actions: BuildAction[] = [];
    const conveyIn = rec.inputs.find((i) => w.defs.items[i.item]?.conveyable);
    if (conveyIn && !inputConnected(w, m))
      actions.push(
        this.act({
          id: 'belt',
          label: `Belt ${conveyIn.item} from hopper`,
          key: '1',
          cost: [],
          command: { type: 'connectBelt', from: { kind: 'room', id: m.roomId }, toMachine: m.id },
        }),
      );
    const out = rec.outputs[0]!;
    if (!outputConnected(w, m)) {
      const liquid = !w.defs.items[out.item]?.conveyable;
      let k = 2;
      for (const other of w.state.machines) {
        if (other === m || other.roomId !== m.roomId) continue;
        if (!recipeOf(w, other).inputs.some((i) => i.item === out.item) || inputConnected(w, other)) continue;
        const name = w.defs.machines[other.type]!.name;
        actions.push(
          this.act({
            id: `to${other.id}`,
            label: `${liquid ? 'Pipe' : 'Belt'} ${out.item} → ${name}`,
            key: String(k++),
            cost: [],
            command: liquid
              ? { type: 'connectPipe', fromMachine: m.id, toMachine: other.id }
              : { type: 'connectBelt', from: { kind: 'machine', id: m.id, slot: 0 }, toMachine: other.id },
          }),
        );
      }
      if (liquid)
        actions.push(
          this.act({
            id: 'tank',
            label: `Pipe ${out.item} → tank`,
            key: String(k),
            cost: [],
            command: { type: 'connectPipe', fromMachine: m.id, toMachine: 'tank' },
          }),
        );
    }
    if (m.wear >= 0.05)
      actions.push(
        this.act({
          id: 'repairM',
          label: 'Repair',
          key: 'R',
          cost: [{ item: 'parts', qty: m.wear >= 1 ? 2 : 1 }],
          command: { type: 'repairMachine', machineId: m.id },
        }),
      );
    const armed = this.armedRemove?.id === m.id && performance.now() < this.armedRemove.until;
    actions.push(
      this.act({
        id: 'remove',
        label: armed ? 'Confirm remove' : 'Remove',
        key: 'X',
        cost: [],
        command: { type: 'removeMachine', machineId: m.id },
        danger: true,
      }),
    );
    const fmt = (o: Record<string, number>) =>
      Object.entries(o)
        .filter(([, q]) => q > 0.05)
        .map(([k2, q]) => `${q.toFixed(0)} ${k2}`)
        .join(', ') || 'empty';
    return {
      key: `m${m.id}`,
      title: `${def.name}${m.wear >= 1 ? ' (broken)' : ''}`,
      subtitle: `in: ${fmt(m.inputs)} · out: ${fmt(m.outputs)} · ${(m.progress * 100).toFixed(0)}% · wear ${(m.wear * 100).toFixed(0)}% · ${m.powered > 0 ? 'powered' : 'NO POWER'}`,
      actions,
    };
  }

  /** Returns the command to issue for an action, handling the remove confirmation. */
  trigger(a: BuildAction): Command | null {
    if (!a.ok) return null;
    if (a.id === 'remove' && a.command.type === 'removeMachine') {
      const armed =
        this.armedRemove?.id === a.command.machineId && performance.now() < this.armedRemove.until;
      if (!armed) {
        this.armedRemove = { id: a.command.machineId, until: performance.now() + 2500 };
        return null;
      }
      this.armedRemove = null;
    }
    return a.command;
  }

  /** Highlights the targeted room / bulkhead (yellow) while manage mode is active. */
  updateGhost(t: ManageTarget | null): void {
    const w = this.world;
    this.ghost.visible = false;
    if (!this.active || !t) return;
    if (t.kind === 'cell') {
      const c = w.cell(t.cellId);
      if (!c) return;
      const r = w.room(c.roomId);
      const cells = r ? r.cellIds.map((id) => w.cell(id)!) : [c];
      const box = new THREE.Box3();
      for (const cc of cells) {
        box.expandByPoint(new THREE.Vector3(cellX0(cc) + 0.1, floorY(cc.y) + 0.05, cellZ0(cc) + 0.1));
        box.expandByPoint(
          new THREE.Vector3(
            cellX0(cc) + GEO.cell - 0.1,
            floorY(cc.y) + GEO.cellHeight - 0.05,
            cellZ0(cc) + GEO.cell - 0.1,
          ),
        );
      }
      box.getCenter(this.ghost.position);
      box.getSize(this.ghost.scale);
      this.ghost.visible = true;
    } else if (t.kind === 'bulkhead') {
      const l = w.state.links.find((x) => x.id === t.linkId);
      if (!l) return;
      const a = w.cell(l.a)!;
      const p = doorPoint(a, w.cell(l.b)!);
      this.ghost.position.set(p.x, floorY(a.y) + GEO.doorHeight / 2, p.z);
      this.ghost.scale.set(GEO.doorWidth + 0.4, GEO.doorHeight + 0.2, GEO.doorWidth + 0.4);
      this.ghost.visible = true;
    }
  }
}
