import * as THREE from 'three';
import type { InteractTag } from '../render/panelsView';
import { gridAt, levelAtY } from '../sim/core/geometry';
import type { World } from '../sim';

export type Target =
  (InteractTag & { distance: number }) | { kind: 'cell'; cellId: number; distance: number } | null;

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
    this.highlight = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: '#ffd84a', depthTest: false, transparent: true }),
    );
    this.highlight.renderOrder = 20;
    this.highlight.visible = false;
  }

  pick(
    camera: THREE.Camera,
    solids: THREE.Object3D[],
    interactables: THREE.Object3D[],
    ndc: { x: number; y: number } = this.center,
    far = CELL_RANGE,
  ): Target {
    this.ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    this.ray.far = far;
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
        if (h.distance <= SURVIVOR_RANGE)
          return { kind: 'survivor', id: o.userData.survivorId as number, distance: h.distance };
        continue;
      }
      if ((h.object as THREE.Object3D & { isSprite?: boolean }).isSprite || h.object.type === 'LineSegments')
        continue;
      // World geometry: nudge into the surface and find the cell.
      const p = h.point.clone().addScaledVector(this.ray.ray.direction, 0.05);
      const level = levelAtY(p.y);
      const g = gridAt(p.x, p.z);
      const cell = this.world.cellAt(g.x, level, g.z);
      if (!cell) return null;
      // Upper part of a tall room: report the room's lowest cell so actions apply to the room.
      return { kind: 'cell', cellId: cell.id, distance: h.distance };
    }
    return null;
  }

  /** Positions the highlight box around a target. */
  showHighlight(
    t: Target,
    objFor: (t: Target) => THREE.Object3D | null,
    cellBox: (cellId: number) => THREE.Box3 | null,
  ): void {
    const h = this.highlight;
    if (!t) {
      h.visible = false;
      return;
    }
    let box: THREE.Box3 | null = null;
    if (t.kind === 'cell') box = cellBox(t.cellId);
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
