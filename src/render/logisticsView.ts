import * as THREE from 'three';
import type { World } from '../sim';
import { floorY } from '../sim/core/geometry';
import { BoxBatch, disposeTree } from './greybox';
import { UNITS_PER_M, itemPositions } from '../sim/systems/lanes';
import {
  BELT_HEIGHT,
  hopperPort,
  machineCenter,
  machinePort,
  pointAlong,
  tankPort,
} from '../sim/systems/logistics';
import type { InteractTag } from './panelsView';

const MAX_ITEMS = 4096;

/**
 * Machines (one mesh each, clickable), belts + pipes (merged, rebuilt on change) and conveyor items
 * (one InstancedMesh for all items, updated every frame from lane gaps).
 */
export class LogisticsView {
  readonly root = new THREE.Group();
  private statics = new THREE.Group();
  readonly machines = new THREE.Group();
  private items: THREE.InstancedMesh;
  private sig = '';
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  private _shared = (this.mat.userData.shared = true);
  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();
  private pos: number[] = [];

  constructor(private world: World) {
    this.items = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.3, 0.22, 0.3),
      new THREE.MeshStandardMaterial({ roughness: 0.6 }),
      MAX_ITEMS,
    );
    this.items.count = 0;
    this.items.frustumCulled = false;
    this.root.add(this.statics, this.machines, this.items);
  }

  private signature(): string {
    const st = this.world.state;
    return `${st.machines.map((m) => `${m.id}${m.wear >= 1 ? 'b' : ''}`).join(',')}|${st.lanes.map((l) => l.id).join(',')}|${st.pipes.map((p) => p.id).join(',')}`;
  }

  update(): void {
    const w = this.world;
    const sig = this.signature();
    if (sig !== this.sig) {
      this.sig = sig;
      this.rebuild();
    }
    // Items along lanes.
    let n = 0;
    for (const l of w.state.lanes) {
      const y = floorY(l.level) + BELT_HEIGHT + 0.16;
      itemPositions(l, this.pos);
      for (let i = 0; i < this.pos.length && n < MAX_ITEMS; i++) {
        const p = pointAlong(l.points, this.pos[i]! / UNITS_PER_M);
        this.tmpM.makeTranslation(p.x, y, p.z);
        this.items.setMatrixAt(n, this.tmpM);
        this.tmpC.set(w.defs.items[l.items[i]!]?.color ?? '#ccc');
        this.items.setColorAt(n, this.tmpC);
        n++;
      }
    }
    this.items.count = n;
    this.items.instanceMatrix.needsUpdate = true;
    if (this.items.instanceColor) this.items.instanceColor.needsUpdate = true;
  }

  private rebuild(): void {
    const w = this.world;
    for (const g of [this.statics, this.machines]) {
      for (const c of [...g.children]) {
        g.remove(c);
        disposeTree(c);
      }
    }
    // Machines.
    for (const m of w.state.machines) {
      const def = w.defs.machines[m.type]!;
      const c = machineCenter(w, m);
      const y = floorY(w.cell(m.cellId)!.y);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 1.4, 1.8),
        new THREE.MeshStandardMaterial({
          color: m.wear >= 1 ? '#7a5148' : def.color,
          roughness: 0.6,
          metalness: 0.2,
        }),
      );
      mesh.position.set(c.x, y + 0.7, c.z);
      mesh.userData.interact = { kind: 'machine', id: m.id } satisfies InteractTag;
      const portIn = machinePort(w, m, 'in');
      const portOut = machinePort(w, m, 'out');
      const pin = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.35, 0.5),
        new THREE.MeshStandardMaterial({ color: '#4fd1ff' }),
      );
      pin.position.set(portIn.x - c.x, BELT_HEIGHT - 0.7 + 0.1, portIn.z - c.z);
      const pout = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.35, 0.5),
        new THREE.MeshStandardMaterial({ color: '#f08a24' }),
      );
      pout.position.set(portOut.x - c.x, BELT_HEIGHT - 0.7 + 0.1, portOut.z - c.z);
      mesh.add(pin, pout);
      this.machines.add(mesh);
    }
    // Belts, pipes, hatches.
    const b = new BoxBatch();
    const hatchRooms = new Set<number>();
    for (const l of w.state.lanes) {
      const y = floorY(l.level);
      for (let i = 1; i < l.points.length; i++) {
        const a = l.points[i - 1]!;
        const c = l.points[i]!;
        const hw = 0.22;
        b.add(
          Math.min(a.x, c.x) - hw,
          y + 0.1,
          Math.min(a.z, c.z) - hw,
          Math.max(a.x, c.x) + hw,
          y + BELT_HEIGHT,
          Math.max(a.z, c.z) + hw,
          '#2b2f33',
        );
      }
      if (l.from?.kind === 'room') hatchRooms.add(l.from.id);
    }
    for (const p of w.state.pipes) {
      for (const s of p.segments) {
        const y = floorY(s.level) + 2.7;
        b.add(
          Math.min(s.x1, s.x2) - 0.07,
          y,
          Math.min(s.z1, s.z2) - 0.07,
          Math.max(s.x1, s.x2) + 0.07,
          y + 0.14,
          Math.max(s.z1, s.z2) + 0.07,
          '#3fa9f5',
        );
      }
      const first = p.segments[0];
      const last = p.segments[p.segments.length - 1];
      if (first)
        b.add(
          first.x1 - 0.07,
          floorY(first.level) + 0.6,
          first.z1 - 0.07,
          first.x1 + 0.07,
          floorY(first.level) + 2.75,
          first.z1 + 0.07,
          '#3fa9f5',
        );
      if (last)
        b.add(
          last.x2 - 0.07,
          floorY(last.level) + 0.4,
          last.z2 - 0.07,
          last.x2 + 0.07,
          floorY(last.level) + 2.75,
          last.z2 + 0.07,
          '#3fa9f5',
        );
      if (p.toStore) {
        const m = w.state.machines.find((x) => x.id === p.producers[0]?.machineId);
        if (m) {
          const t = tankPort(w, w.room(m.roomId)!);
          const y = floorY(w.cell(m.cellId)!.y);
          b.add(t.x - 0.4, y, t.z - 0.4, t.x + 0.4, y + 0.4, t.z + 0.4, '#1f6fa8');
        }
      }
    }
    for (const id of hatchRooms) {
      const r = w.room(id)!;
      const h = hopperPort(w, r);
      const y = floorY(Math.max(...r.cellIds.map((c) => w.cell(c)!.y)));
      b.add(h.x - 0.4, y, h.z - 0.4, h.x + 0.4, y + 0.3, h.z + 0.4, '#8a6d3b');
    }
    const g = b.build();
    if (g) this.statics.add(new THREE.Mesh(g, this.mat));
  }

  interactables(): THREE.Object3D[] {
    return this.machines.children;
  }
}
