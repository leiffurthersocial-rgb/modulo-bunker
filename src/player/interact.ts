import * as THREE from 'three';
import type { InteractTag } from '../render/panelsView';
import { cellAtX } from '../sim/core/geometry';
import { GEO } from '../sim/core/state';
import type { World } from '../sim';

export type Target =
  | (InteractTag & { distance: number })
  | { kind: 'cell'; slotId: number; distance: number }
  | null;

const PANEL_RANGE = 3.2;
const SURVIVOR_RANGE = 5;
const CELL_RANGE = 18;

/**
 * Resolves what the crosshair points at. Panels/survivors are tested as meshes; for the bunker
 * itself we take the first hit on world geometry and map the hit point to the cell containing it.
 */
export class Interactor {
  private ray = new THREE.Raycaster();
  private center = new THREE.Vector2(0, 0);
  readonly highlight: THREE.LineSegments;

  constructor(private world: World) {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.highlight = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffd84a', depthTest: false, transparent: true }));
    this.highlight.renderOrder = 20;
    this.highlight.visible = false;
  }

  pick(camera: THREE.Camera, solids: THREE.Object3D[], interactables: THREE.Object3D[]): Target {
    this.ray.setFromCamera(this.center, camera);
    this.ray.far = CELL_RANGE;
    const hits = this.ray.intersectObjects([...solids, ...interactables], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.interact && !o.userData.survivorId) o = o.parent;
      if (o?.userData.interact) {
        const tag = o.userData.interact as InteractTag;
        if (h.distance <= PANEL_RANGE) return { ...tag, distance: h.distance };
        continue;
      }
      if (o?.userData.survivorId) {
        if (h.distance <= SURVIVOR_RANGE) return { kind: 'survivor', id: o.userData.survivorId as number, distance: h.distance };
        continue;
      }
      if ((h.object as THREE.Object3D & { isSprite?: boolean }).isSprite || h.object.type === "LineSegments") continue;
      // World geometry: nudge into the surface and find the cell.
      const p = h.point.clone().addScaledVector(this.ray.ray.direction, 0.05);
      const floor = Math.floor((-p.y + GEO.cellHeight) / GEO.floorPitch);
      const cell = cellAtX(p.x);
      if (!cell || floor < 0) return null;
      const slot = this.world.slotAt(floor, cell.side, cell.index);
      return slot ? { kind: 'cell', slotId: slot.id, distance: h.distance } : null;
    }
    return null;
  }

  /** Positions the highlight box around a target. */
  showHighlight(t: Target, objFor: (t: Target) => THREE.Object3D | null, cellBox: (slotId: number) => THREE.Box3 | null): void {
    const h = this.highlight;
    if (!t) {
      h.visible = false;
      return;
    }
    let box: THREE.Box3 | null = null;
    if (t.kind === 'cell') box = cellBox(t.slotId);
    else {
      const o = objFor(t);
      if (o) box = new THREE.Box3().setFromObject(o).expandByScalar(0.05);
    }
    if (!box) {
      h.visible = false;
      return;
    }
    box.getCenter(h.position);
    box.getSize(h.scale);
    h.visible = true;
  }
}
