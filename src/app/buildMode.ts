import * as THREE from 'three';
import type { Command, World } from '../sim';
import { checkCommand } from '../sim';
import { neighbours, repairCost, roomCost } from '../sim/core/commands';
import { cellsXRange, floorY } from '../sim/core/geometry';
import { GEO } from '../sim/core/state';
import type { ItemStack } from '../data/types';
import { has } from '../sim/core/store';

export interface BuildAction {
  id: 'build' | 'upgrade' | 'merge' | 'repair' | 'demolish' | 'openSeal';
  label: string;
  key: string;
  cost: ItemStack[];
  ok: boolean;
  reason?: string;
  command: Command;
  danger?: boolean;
}

export interface BuildTargetInfo {
  slotId: number;
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

/** Build-mode logic: options, target analysis and the ghost preview. Pure apart from the ghost mesh. */
export class BuildMode {
  active = false;
  selected = 'hydroponics';
  readonly ghost: THREE.Mesh;
  private ghostMat: THREE.MeshBasicMaterial;
  /** Demolish needs a second press within 2.5 s. */
  private armedDemolish: { roomId: number; until: number } | null = null;

  constructor(private world: World) {
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: '#3fbf5f',
      transparent: true,
      opacity: 0.28,
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

  analyze(slotId: number | null): BuildTargetInfo | null {
    if (slotId === null) return null;
    const w = this.world;
    const s = w.slot(slotId);
    if (!s) return null;
    const where = `Floor ${s.floor + 1} · ${s.side < 0 ? 'west' : 'east'} ${s.index + 1}`;
    const act = (a: Omit<BuildAction, 'ok' | 'reason'>): BuildAction => {
      const r = checkCommand(w, a.command);
      return r.ok ? { ...a, ok: true } : { ...a, ok: false, reason: r.reason };
    };
    if (s.state === 'rock')
      return { slotId, title: 'Solid rock', subtitle: `${where} · excavation comes later`, actions: [] };
    if (s.state === 'sealed') {
      const cost = s.seal?.cost ?? [];
      return {
        slotId,
        title: 'Sealed shell',
        subtitle: where,
        actions: [
          act({ id: 'openSeal', label: 'Open', key: 'E', cost, command: { type: 'openSeal', slotId } }),
        ],
      };
    }
    if (s.state === 'empty') {
      const def = w.defs.rooms[this.selected]!;
      return {
        slotId,
        title: 'Empty cell',
        subtitle: where,
        actions: [
          act({
            id: 'build',
            label: `Build ${def.name}`,
            key: 'E',
            cost: roomCost(w, def.id, 1, 1),
            command: { type: 'build', slotId, roomType: def.id },
          }),
        ],
      };
    }
    const r = w.room(s.roomId)!;
    const def = w.defs.rooms[r.type]!;
    const actions: BuildAction[] = [];
    if (r.damaged)
      actions.push(
        act({
          id: 'repair',
          label: 'Repair',
          key: 'R',
          cost: repairCost(w, r),
          command: { type: 'repair', roomId: r.id },
        }),
      );
    if (r.tier < 3)
      actions.push(
        act({
          id: 'upgrade',
          label: `Upgrade to T${r.tier + 1}`,
          key: 'U',
          cost: roomCost(w, r.type, r.tier + 1, r.slotIds.length),
          command: { type: 'upgrade', roomId: r.id },
        }),
      );
    const mergeWith = neighbours(w, r).find((n) => n.type === r.type);
    if (mergeWith)
      actions.push(
        act({
          id: 'merge',
          label: 'Merge with neighbour',
          key: 'M',
          cost: [],
          command: { type: 'merge', roomId: r.id, otherRoomId: mergeWith.id },
        }),
      );
    if (def.buildable) {
      const armed = this.armedDemolish?.roomId === r.id && performance.now() < this.armedDemolish.until;
      actions.push(
        act({
          id: 'demolish',
          label: armed ? 'Confirm demolish' : 'Demolish',
          key: 'X',
          cost: [],
          command: { type: 'demolish', roomId: r.id },
          danger: true,
        }),
      );
    }
    const width = r.slotIds.length > 1 ? ` · ${r.slotIds.length} wide` : '';
    return {
      slotId,
      title: `${def.name} T${r.tier}${r.damaged ? ' (damaged)' : ''}`,
      subtitle: `${where}${width} · ${r.workers.length} worker(s)`,
      actions,
    };
  }

  /** Returns the command to issue for an action, handling the demolish confirmation. */
  trigger(a: BuildAction): Command | null {
    if (!a.ok) return null;
    if (a.id === 'demolish' && a.command.type === 'demolish') {
      const armed =
        this.armedDemolish?.roomId === a.command.roomId && performance.now() < this.armedDemolish.until;
      if (!armed) {
        this.armedDemolish = { roomId: a.command.roomId, until: performance.now() + 2500 };
        return null;
      }
      this.armedDemolish = null;
    }
    return a.command;
  }

  /** Places the ghost box over the target cell (selected room colour, red when invalid). */
  updateGhost(info: BuildTargetInfo | null): void {
    if (!this.active || !info) {
      this.ghost.visible = false;
      return;
    }
    const w = this.world;
    const s = w.slot(info.slotId)!;
    const r = w.room(s.roomId);
    const idx = r ? r.slotIds.map((id) => w.slot(id)!.index) : [s.index];
    const [x0, x1] = cellsXRange(s.side, idx);
    const y0 = floorY(s.floor);
    this.ghost.position.set((x0 + x1) / 2, y0 + GEO.cellHeight / 2, 0);
    this.ghost.scale.set(x1 - x0 - 0.2, GEO.cellHeight - 0.1, GEO.cellDepth - 0.2);
    const primary = info.actions[0];
    const ok = primary?.ok ?? false;
    const color =
      s.state === 'empty'
        ? ok
          ? w.defs.rooms[this.selected]!.color
          : '#d24b3a'
        : ok
          ? '#ffd84a'
          : '#8a8f94';
    this.ghostMat.color.set(color);
    this.ghost.visible = true;
  }
}
