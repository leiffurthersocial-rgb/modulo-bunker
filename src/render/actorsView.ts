import * as THREE from 'three';
import type { World } from '../sim';
import type { Snapshot } from '../app/simRunner';
import { GEO } from '../sim/core/state';
import { floorY } from '../sim/core/geometry';
import { makeLabel } from './labels';
import { GENERATED_FLOORS } from '../gen/bunker';

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

/** Survivor capsules + labels, elevator car + landing gates. Reads sim snapshots and interpolates. */
export class ActorsView {
  readonly root = new THREE.Group();
  private survivors = new Map<
    number,
    { mesh: THREE.Mesh; label: THREE.Sprite; text: string; group: THREE.Group }
  >();
  readonly car: THREE.Group;
  private gates: THREE.Mesh[] = [];
  private capsuleGeo = new THREE.CapsuleGeometry(0.28, 1.05, 4, 10);

  constructor(private world: World) {
    for (const s of world.state.survivors) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(
        this.capsuleGeo,
        new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.7 }),
      );
      mesh.position.y = 0.81;
      // A "nose" so facing reads in greybox.
      const nose = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.1, 0.2),
        new THREE.MeshStandardMaterial({ color: '#222' }),
      );
      nose.position.set(0, 1.35, 0.26);
      mesh.add(nose);
      mesh.position.y = 0.81;
      group.add(mesh);
      const label = makeLabel([{ text: s.name }], 0.32);
      label.position.y = 2.05;
      group.add(label);
      group.userData.survivorId = s.id;
      this.root.add(group);
      this.survivors.set(s.id, { mesh, label, text: s.name, group });
    }
    // Elevator car: open frame cage.
    this.car = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.5, metalness: 0.3 });
    const floorMat = new THREE.MeshStandardMaterial({ color: '#4a4f55', roughness: 0.9 });
    const W = GEO.shaftWidth - 0.5;
    const D = 3.6;
    const base = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), floorMat);
    base.position.set(0, -0.1, 1.8);
    this.car.add(base);
    for (const [x, z] of [
      [-W / 2, 0],
      [W / 2, 0],
      [-W / 2, D],
      [W / 2, D],
    ] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), frameMat);
      post.position.set(x, 1.3, z);
      this.car.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), frameMat);
    roof.position.set(0, 2.6, 1.8);
    this.car.add(roof);
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.6, 0.08),
      new THREE.MeshStandardMaterial({ color: '#2d6' }),
    );
    panel.position.set(W / 2 - 0.3, 1.3, 0.1);
    panel.name = 'elevator-panel';
    this.car.add(panel);
    this.root.add(this.car);
    // Landing gates (one per generated floor) - a bar across the shaft opening.
    const gateMat = new THREE.MeshStandardMaterial({ color: '#d24b3a', transparent: true, opacity: 0.85 });
    for (let f = 0; f < GENERATED_FLOORS; f++) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(GEO.shaftWidth - 0.3, 1.1, 0.08), gateMat);
      g.position.set(0, floorY(f) + 0.55, -0.15);
      this.gates.push(g);
      this.root.add(g);
    }
  }

  update(prev: Snapshot, cur: Snapshot, alpha: number): void {
    const st = this.world.state;
    for (let i = 0; i < cur.survivors.length; i++) {
      const c = cur.survivors[i]!;
      const p = prev.survivors[i] ?? c;
      const v = this.survivors.get(c.id);
      if (!v) continue;
      const lerp = (a: number, b: number) => a + (b - a) * alpha;
      v.group.position.set(lerp(p.x, c.x), floorY(lerp(p.y, c.y)), lerp(p.z, c.z));
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
    const carPos = prev.elevator + (cur.elevator - prev.elevator) * alpha;
    this.car.position.y = floorY(carPos);
    const el = st.elevator;
    this.gates.forEach((g, f) => {
      const open = el.doorTicks > 0 && Math.abs(el.pos - f) < 1e-6;
      g.visible = !open && st.floors[f]?.state !== 'unexcavated';
    });
  }

  /** Is the landing gate at floor f open (for the player's collider)? */
  gateOpen(f: number): boolean {
    const el = this.world.state.elevator;
    return el.doorTicks > 0 && Math.abs(el.pos - f) < 1e-6;
  }
}
