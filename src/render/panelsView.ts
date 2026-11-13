import * as THREE from 'three';
import type { World } from '../sim';
import { GEO } from '../sim/core/state';
import { floorY } from '../sim/core/geometry';
import { GENERATED_FLOORS } from '../gen/bunker';
import { makeLabel } from './labels';

export type InteractTag =
  | { kind: 'callButton'; floor: number }
  | { kind: 'carPanel' }
  | { kind: 'unsealFloor'; floor: number }
  | { kind: 'survivor'; id: number };

/** Interactive greybox panels: landing call buttons and floor-unseal panels. */
export class PanelsView {
  readonly root = new THREE.Group();
  readonly callButtons: THREE.Mesh[] = [];
  private unseal = new Map<number, THREE.Group>();
  private mat = new THREE.MeshStandardMaterial({ color: '#3fbf5f', emissive: '#0d3a17', roughness: 0.5 });
  private sealMat = new THREE.MeshStandardMaterial({ color: '#e0b73a', emissive: '#3a2a05', roughness: 0.5 });

  constructor(private world: World) {
    const geo = new THREE.BoxGeometry(0.3, 0.4, 0.08);
    for (let f = 0; f < GENERATED_FLOORS; f++) {
      const m = new THREE.Mesh(geo, this.mat);
      // On the shaft-side post to the right of the gate, facing the landing (-z side).
      m.position.set(GEO.shaftWidth / 2 - 0.35, floorY(f) + 1.25, -0.3);
      m.userData.interact = { kind: 'callButton', floor: f } satisfies InteractTag;
      this.callButtons.push(m);
      this.root.add(m);
    }
    this.sync();
  }

  /** Show an unseal panel on the lowest open floor if the floor below is sealed. */
  sync(): void {
    const st = this.world.state;
    let lowest = 0;
    while (st.floors[lowest + 1]?.state === 'open') lowest++;
    const target = st.floors[lowest + 1]?.state === 'sealed' ? lowest : -1;
    for (const [f, g] of this.unseal) {
      if (f !== target) {
        this.root.remove(g);
        this.unseal.delete(f);
      }
    }
    if (target >= 0 && !this.unseal.has(target)) {
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.1), this.sealMat);
      panel.userData.interact = { kind: 'unsealFloor', floor: target + 1 } satisfies InteractTag;
      g.add(panel);
      const lbl = makeLabel([{ text: `Floor ${target + 2} below: sealed`, color: '#e0b73a' }, { text: 'E: unseal', size: 0.7 }], 0.35);
      lbl.position.y = 0.6;
      g.add(lbl);
      g.position.set(0.6, floorY(target) + 1.4, -GEO.cellDepth / 2 + 0.06);
      this.unseal.set(target, g);
      this.root.add(g);
    }
    for (let f = 0; f < this.callButtons.length; f++) this.callButtons[f]!.visible = st.floors[f]?.state === 'open';
  }

  interactables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = this.callButtons.filter((b) => b.visible);
    for (const g of this.unseal.values()) out.push(g.children[0]!);
    return out;
  }
}
