import type * as THREE from 'three';
import { floorY } from '../sim/core/geometry';

/**
 * Cutaway "Fallout Shelter" view: camera in front of the bunker (front walls hidden) looking at a
 * focus floor. Used for the overview/tablet mode and for screenshots. Pan with drag/keys, zoom.
 */
export class OverviewCamera {
  floor = 1;
  x = 0;
  distance = 24;

  apply(cam: THREE.PerspectiveCamera): void {
    const y = floorY(this.floor) + 1.75;
    cam.position.set(this.x, y + 2, this.distance);
    cam.lookAt(this.x, y, 0);
  }
}
