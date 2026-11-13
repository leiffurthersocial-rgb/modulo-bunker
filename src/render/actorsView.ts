import * as THREE from 'three';
import type { World } from '../sim';
import type { Snapshot } from '../app/simRunner';
import { GEO } from '../sim/core/state';
import { WELL, cellX0, cellZ0, floorY } from '../sim/core/geometry';
import { makeLabel } from './labels';

const ACTION_ICON: Record<string, string> = {
  idle: '·',
  work: '⚒',
  eat: '🍲',
  drink: '💧',
  sleep: 'z',
  warm: '🔥',
  relax: '♣',
  downed: '✚',
};

/** Well footprint (world x/z) of an elevator shaft. */
export function wellOf(shaft: { x: number; z: number }) {
  const x0 = shaft.x * GEO.cell + WELL.inset;
  const z0 = shaft.z * GEO.cell + WELL.inset;
  const size = GEO.cell - 2 * WELL.inset;
  return { x0, z0, x1: x0 + size, z1: z0 + size };
}

interface CarView {
  shaftId: number;
  group: THREE.Group;
  panel: THREE.Mesh;
  /** Gate meshes keyed by landing level. */
  gates: Map<number, THREE.Mesh>;
}

/** Survivor capsules + labels; elevator cars + landing gates. Reads sim snapshots, interpolates. */
export class ActorsView {
  readonly root = new THREE.Group();
  private survivors = new Map<
    number,
    { mesh: THREE.Mesh; label: THREE.Sprite; text: string; group: THREE.Group }
  >();
  readonly cars: CarView[] = [];
  private capsuleGeo = new THREE.CapsuleGeometry(0.28, 1.05, 4, 10);

  constructor(private world: World) {
    for (const s of world.state.survivors) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(
        this.capsuleGeo,
        new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.7 }),
      );
      mesh.position.y = 0.81;
      const nose = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.1, 0.2),
        new THREE.MeshStandardMaterial({ color: '#222' }),
      );
      nose.position.set(0, 0.54, 0.26);
      mesh.add(nose);
      group.add(mesh);
      const label = makeLabel([{ text: s.name }], 0.32);
      label.position.y = 2.05;
      group.add(label);
      group.userData.survivorId = s.id;
      this.root.add(group);
      this.survivors.set(s.id, { mesh, label, text: s.name, group });
    }
    const frameMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.5, metalness: 0.3 });
    const floorMat = new THREE.MeshStandardMaterial({ color: '#4a4f55', roughness: 0.9 });
    const gateMat = new THREE.MeshStandardMaterial({ color: '#d24b3a', transparent: true, opacity: 0.85 });
    for (const sh of world.state.shafts.filter((s) => s.kind === 'elevator')) {
      const well = wellOf(sh);
      const W = well.x1 - well.x0 - 0.1;
      const group = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, W), floorMat);
      base.position.set(0, -0.1, 0);
      group.add(base);
      for (const [x, z] of [
        [-W / 2, -W / 2],
        [W / 2, -W / 2],
        [-W / 2, W / 2],
        [W / 2, W / 2],
      ] as const) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), frameMat);
        post.position.set(x, 1.3, z);
        group.add(post);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, W), frameMat);
      roof.position.set(0, 2.6, 0);
      group.add(roof);
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.6, 0.08),
        new THREE.MeshStandardMaterial({ color: '#2d6' }),
      );
      panel.position.set(W / 2 - 0.35, 1.3, W / 2 - 0.1);
      panel.userData.interact = { kind: 'carPanel', shaftId: sh.id };
      group.add(panel);
      group.position.set((well.x0 + well.x1) / 2, 0, (well.z0 + well.z1) / 2);
      this.root.add(group);
      const gates = new Map<number, THREE.Mesh>();
      for (let y = sh.top; y <= sh.bottom; y++) {
        const g = new THREE.Mesh(new THREE.BoxGeometry(well.x1 - well.x0, 1.1, 0.08), gateMat);
        g.position.set((well.x0 + well.x1) / 2, floorY(y) + 0.55, well.z0 - 0.04);
        this.root.add(g);
        gates.set(y, g);
      }
      this.cars.push({ shaftId: sh.id, group, panel, gates });
    }
  }

  /** In overview, actors above this level are hidden (null = show all). */
  hideAbove: number | null = null;

  update(prev: Snapshot, cur: Snapshot, alpha: number): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    for (let i = 0; i < cur.survivors.length; i++) {
      const c = cur.survivors[i]!;
      const p = prev.survivors[i] ?? c;
      const v = this.survivors.get(c.id);
      if (!v) continue;
      const ly = lerp(p.y, c.y);
      v.group.position.set(lerp(p.x, c.x), floorY(ly), lerp(p.z, c.z));
      v.group.visible = this.hideAbove === null || ly > this.hideAbove - 0.5;
      const s = this.world.survivor(c.id)!;
      v.mesh.rotation.y = s.heading;
      v.mesh.rotation.z = s.action === 'downed' ? Math.PI / 2 : 0;
      v.mesh.position.y = s.action === 'downed' ? 0.3 : 0.81;
      const text = `${s.name} ${ACTION_ICON[s.action] ?? ''}`;
      if (text !== v.text) {
        v.group.remove(v.label);
        v.label.material.map?.dispose();
        v.label.material.dispose();
        v.label = makeLabel([{ text, color: s.health < 40 ? '#ff7a6a' : '#e8e8e8' }], 0.32);
        v.label.position.y = 2.05;
        v.group.add(v.label);
        v.text = text;
      }
    }
    for (const car of this.cars) {
      const a = prev.elevators[car.shaftId] ?? cur.elevators[car.shaftId] ?? 0;
      const b = cur.elevators[car.shaftId] ?? a;
      const cl = lerp(a, b);
      car.group.position.y = floorY(cl);
      car.group.visible = this.hideAbove === null || cl > this.hideAbove - 0.5;
      for (const [y, g] of car.gates)
        g.visible = !this.gateOpen(car.shaftId, y) && (this.hideAbove === null || y >= this.hideAbove);
    }
  }

  /** Is the landing gate of shaft `shaftId` at level y open (car there, doors open)? */
  gateOpen(shaftId: number, y: number): boolean {
    const el = this.world.elevator(shaftId);
    return !!el && el.doorTicks > 0 && Math.abs(el.pos - y) < 1e-6;
  }

  carY(shaftId: number): number {
    return this.cars.find((c) => c.shaftId === shaftId)?.group.position.y ?? 0;
  }
}

export { cellX0, cellZ0 };
