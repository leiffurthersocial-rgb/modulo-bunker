import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface AABB {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/**
 * Accumulates axis-aligned boxes with per-box vertex colour, then merges into one geometry.
 * Solid boxes are also recorded into `sink` (physics colliders come from the same layout code).
 */
export class BoxBatch {
  private parts: THREE.BufferGeometry[] = [];
  private tmpColor = new THREE.Color();

  constructor(private sink?: AABB[]) {}

  /** Box from min/max corners. */
  add(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    color: THREE.ColorRepresentation,
    solid = true,
  ): void {
    if (solid && this.sink)
      this.sink.push({
        x0: Math.min(x0, x1),
        y0: Math.min(y0, y1),
        z0: Math.min(z0, z1),
        x1: Math.max(x0, x1),
        y1: Math.max(y0, y1),
        z1: Math.max(z0, z1),
      });
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.tmpColor.set(color);
    const n = g.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = this.tmpColor.r;
      colors[i * 3 + 1] = this.tmpColor.g;
      colors[i * 3 + 2] = this.tmpColor.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    this.parts.push(g);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    return merged;
  }
}

/** Disposes geometries/materials/textures of an object tree (three.js manual: dispose is manual). */
export function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const x of mats) {
      for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
      if (!x.userData.shared) x.dispose();
    }
  });
}
