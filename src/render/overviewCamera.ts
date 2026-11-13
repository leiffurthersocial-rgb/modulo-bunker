import type * as THREE from 'three';
import { floorY } from '../sim/core/geometry';

/**
 * Dollhouse overview: orbits a target on the focus level, looking down at ~50°. Levels above the
 * focus (and the focus ceiling) are hidden by BunkerView, so you look straight into one level.
 */
export class OverviewCamera {
  level = 0;
  x = 15;
  z = 9;
  yaw = 0.6;
  pitch = 0.95;
  distance = 34;

  apply(cam: THREE.PerspectiveCamera): void {
    const ty = floorY(this.level);
    const h = Math.sin(this.pitch) * this.distance;
    const r = Math.cos(this.pitch) * this.distance;
    cam.position.set(this.x + Math.sin(this.yaw) * r, ty + h, this.z + Math.cos(this.yaw) * r);
    cam.lookAt(this.x, ty, this.z);
  }

  /** Pan in screen-aligned directions (right, forward) in metres. */
  pan(right: number, forward: number): void {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    this.x += right * c - forward * s;
    this.z += -right * s - forward * c;
  }
}
