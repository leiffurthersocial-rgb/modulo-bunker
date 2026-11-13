import * as THREE from 'three';
import type { World } from '../sim';
import { GEO } from '../sim/core/state';
import { LADDER_SIZE, cellX0, cellZ0, doorPoint, floorY } from '../sim/core/geometry';
import { wellOf } from './actorsView';

export type InteractTag =
  | { kind: 'callButton'; shaftId: number; level: number }
  | { kind: 'carPanel'; shaftId: number }
  | { kind: 'bulkhead'; linkId: number }
  | { kind: 'shaft'; shaftId: number }
  | { kind: 'machine'; id: number }
  | { kind: 'survivor'; id: number };

/**
 * Interactive greybox elements: elevator call buttons on every landing, and invisible hit boxes
 * on sealed bulkheads and broken ladders (so you interact with the thing itself).
 */
export class PanelsView {
  readonly root = new THREE.Group();
  readonly callButtons: THREE.Mesh[] = [];
  private hits = new THREE.Group();
  private mat = new THREE.MeshStandardMaterial({ color: '#3fbf5f', emissive: '#0d3a17', roughness: 0.5 });
  private hitMat = new THREE.MeshBasicMaterial({ visible: false });
  private sig = '';

  constructor(private world: World) {
    const geo = new THREE.BoxGeometry(0.3, 0.4, 0.08);
    for (const sh of world.state.shafts.filter((s) => s.kind === 'elevator')) {
      const well = wellOf(sh);
      for (let y = sh.top; y <= sh.bottom; y++) {
        const cell = world.cellAt(sh.x, y, sh.z);
        if (!cell || world.linksOf(cell.id).length === 0) continue; // no landing here
        const m = new THREE.Mesh(geo, this.mat);
        m.position.set(well.x1 + 0.25, floorY(y) + 1.25, well.z0 - 0.3);
        m.userData.interact = { kind: 'callButton', shaftId: sh.id, level: y } satisfies InteractTag;
        this.callButtons.push(m);
        this.root.add(m);
      }
    }
    this.root.add(this.hits);
    this.sync();
  }

  /** Rebuild hit boxes for sealed bulkheads and broken ladders when they change. */
  sync(): void {
    const w = this.world;
    const sig =
      w.state.links
        .filter((l) => l.sealed)
        .map((l) => l.id)
        .join(',') +
      '|' +
      w.state.shafts
        .filter((s) => s.broken)
        .map((s) => s.id)
        .join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    for (const c of [...this.hits.children]) {
      this.hits.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    for (const l of w.state.links) {
      if (!l.sealed) continue;
      const a = w.cell(l.a)!;
      const b = w.cell(l.b)!;
      const p = doorPoint(a, b);
      const alongX = a.z !== b.z;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? GEO.doorWidth : 0.4, GEO.doorHeight, alongX ? 0.4 : GEO.doorWidth),
        this.hitMat,
      );
      m.position.set(p.x, floorY(a.y) + GEO.doorHeight / 2, p.z);
      m.userData.interact = { kind: 'bulkhead', linkId: l.id } satisfies InteractTag;
      this.hits.add(m);
    }
    for (const s of w.state.shafts) {
      if (!s.broken || s.kind !== 'ladder') continue;
      const x0 = cellX0(s);
      const z0 = cellZ0(s);
      const top = floorY(s.top) + 1.6;
      const bottom = floorY(s.bottom);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(LADDER_SIZE + 0.4, top - bottom, LADDER_SIZE + 0.4),
        this.hitMat,
      );
      m.position.set(x0 + LADDER_SIZE / 2, (top + bottom) / 2, z0 + LADDER_SIZE / 2);
      m.userData.interact = { kind: 'shaft', shaftId: s.id } satisfies InteractTag;
      this.hits.add(m);
    }
  }

  interactables(): THREE.Object3D[] {
    return [...this.callButtons, ...this.hits.children];
  }
}
