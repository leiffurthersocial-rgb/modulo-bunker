/**
 * Greybox bunker: per-floor merged static geometry (~2-3 draw calls per floor), rebuilt only when
 * that floor's layout signature changes; instanced ceiling bands per cell carry room colour or the
 * power/heat overlay colour; floating labels per cell.
 */
import * as THREE from 'three';
import { GEO } from '../sim/core/state';
import type { Room, Slot } from '../sim/core/state';
import { cellInnerX, cellsXRange, floorY } from '../sim/core/geometry';
import type { World } from '../sim';
import { BoxBatch, disposeTree } from './greybox';
import type { AABB } from './greybox';
import { makeLabel } from './labels';
import { roomInfo } from '../sim/systems/rooms';
import { GENERATED_FLOORS } from '../gen/bunker';

export type Overlay = 'none' | 'power' | 'heat';

const C = {
  slab: '#6f7377',
  wall: '#868b90',
  wallDark: '#5d6166',
  rock: '#2b2723',
  empty: '#4f5a63',
  sealed: '#e0b73a',
  damaged: '#7a5148',
  landing: '#5b6168',
  ladder: '#c7c34a',
  stripe: '#d24b3a',
};

const T = 0.2; // wall thickness
const HALF_D = GEO.cellDepth / 2;
const HALF_S = GEO.shaftWidth / 2;

interface FloorView {
  group: THREE.Group;
  front: THREE.Mesh | null;
  labels: THREE.Group;
  signature: string;
  labelTexts: Map<THREE.Sprite, string>;
}

export class BunkerView {
  readonly root = new THREE.Group();
  private floors = new Map<number, FloorView>();
  private mats = {
    opaque: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 }),
    translucent: new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      roughness: 0.6,
    }),
    band: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }),
  };
  /** Instanced ceiling bands, one instance per room/empty cell (all floors). */
  private bands: THREE.InstancedMesh;
  private bandSlots: number[] = [];
  /** Solid boxes per floor (for physics). */
  readonly colliders = new Map<number, AABB[]>();
  /** Called after a floor is (re)built with its collider boxes. */
  onFloorBuilt: ((floor: number, boxes: AABB[]) => void) | null = null;
  overlay: Overlay = 'none';
  showFront = true;
  focusFloor = 0;
  visibleRange = 2;
  overview = false;
  /** Rock mass behind/above the bunker, shown in the overview cutaway. */
  private backdrop: THREE.Mesh;
  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();

  constructor(private world: World) {
    for (const m of Object.values(this.mats)) m.userData.shared = true;
    const bandGeo = new THREE.BoxGeometry(GEO.cellWidth - 0.4, 0.12, GEO.cellDepth - 0.4);
    this.bands = new THREE.InstancedMesh(bandGeo, this.mats.band, GEO.cellsPerSide * 2 * GENERATED_FLOORS);
    this.bands.frustumCulled = false;
    this.bands.renderOrder = 2;
    this.root.add(this.bands);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#1d1a17', roughness: 1 });
    this.backdrop = new THREE.Mesh(new THREE.BoxGeometry(80, 120, 1), rockMat);
    this.backdrop.position.set(0, -40, -GEO.cellDepth / 2 - 0.8);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(80, 6, GEO.cellDepth + 1),
      new THREE.MeshStandardMaterial({ color: '#d9e4ea', roughness: 0.9 }),
    );
    cap.position.set(0, GEO.cellHeight + GEO.slab + 3, 0);
    this.backdrop.add(cap);
    cap.position.z = GEO.cellDepth / 2 + 0.8;
    this.root.add(this.backdrop);
    this.sync(true);
  }

  /** Rebuild floors whose layout changed. Call every frame (cheap when nothing changed). */
  sync(force = false): void {
    const st = this.world.state;
    for (let f = 0; f < GENERATED_FLOORS; f++) {
      const sig = this.signature(f);
      const fv = this.floors.get(f);
      if (!force && fv && fv.signature === sig) continue;
      if (fv) {
        this.root.remove(fv.group);
        disposeTree(fv.group);
      }
      this.floors.set(f, this.buildFloor(f, sig));
      this.onFloorBuilt?.(f, this.colliders.get(f)!);
    }
    // Band instances: one per non-rock, non-sealed cell on open/sealed floors.
    this.bandSlots = st.slots
      .filter((s) => s.floor < GENERATED_FLOORS && (s.state === 'room' || s.state === 'empty'))
      .map((s) => s.id);
    this.bands.count = this.bandSlots.length;
    this.layoutBands();
    this.updateColors();
    this.applyVisibility();
  }

  private bandOverlay: Overlay | null = null;

  /** Per-frame cheap updates: overlay colours (and band shape when the overlay changes). */
  update(): void {
    if (this.bandOverlay !== this.overlay) this.layoutBands();
    this.updateColors();
  }

  /** Thin ceiling band normally; full-height translucent block per cell while an overlay is on. */
  private layoutBands(): void {
    this.bandOverlay = this.overlay;
    const full = this.overlay !== 'none';
    const h = full ? GEO.cellHeight - 0.1 : 0.12;
    this.mats.band.opacity = full ? 0.38 : 0.55;
    this.bandSlots.forEach((id, i) => {
      const s = this.world.slot(id)!;
      const cx = (cellInnerX(s.side, s.index) + cellInnerX(s.side, s.index + 1)) / 2;
      const y = floorY(s.floor) + (full ? GEO.cellHeight / 2 : GEO.cellHeight - 0.1);
      this.tmpM.makeScale(1, h / 0.12, 1).setPosition(cx, y, 0);
      this.bands.setMatrixAt(i, this.tmpM);
    });
    this.bands.instanceMatrix.needsUpdate = true;
  }

  private signature(f: number): string {
    const st = this.world.state;
    const parts: string[] = [st.floors[f]!.state, st.floors[f + 1]?.state ?? ''];
    for (const s of st.slots) {
      if (s.floor !== f) continue;
      const r = this.world.room(s.roomId);
      parts.push(
        `${s.index}${s.side}${s.state}${r ? `${r.id}:${r.type}:${r.tier}:${r.damaged ? 1 : 0}` : ''}${s.seal?.kind ?? ''}`,
      );
    }
    return parts.join('|');
  }

  private applyVisibility(): void {
    for (const [f, fv] of this.floors) {
      const near = Math.abs(f - this.focusFloor) <= this.visibleRange;
      fv.group.visible = this.overview || near;
      if (fv.front) fv.front.visible = this.showFront && !this.overview;
      fv.labels.visible = this.overview
        ? Math.abs(f - this.focusFloor) <= 3
        : Math.abs(f - this.focusFloor) <= 1;
      const k = this.overview ? 1.6 : 1;
      for (const o of fv.labels.children) {
        const base = o.userData.baseScale as THREE.Vector3 | undefined;
        if (base) o.scale.set(base.x * k, base.y * k, 1);
        const sm = (o as THREE.Sprite).material;
        if (sm) sm.depthTest = !this.overview;
      }
    }
    this.backdrop.visible = this.overview;
  }

  setFocus(floor: number): void {
    const f = Math.max(0, Math.min(GENERATED_FLOORS - 1, Math.round(floor)));
    if (f !== this.focusFloor) {
      this.focusFloor = f;
      this.applyVisibility();
    }
  }
  setOverview(on: boolean): void {
    this.overview = on;
    this.applyVisibility();
  }

  private updateColors(): void {
    const st = this.world.state;
    this.bandSlots.forEach((id, i) => {
      const s = this.world.slot(id)!;
      const r = this.world.room(s.roomId);
      this.tmpC.set(this.bandColor(s, r, st.outsideTemp));
      this.bands.setColorAt(i, this.tmpC);
    });
    if (this.bands.instanceColor) this.bands.instanceColor.needsUpdate = true;
  }

  private bandColor(s: Slot, r: Room | undefined, _outside: number): THREE.ColorRepresentation {
    if (this.overlay === 'heat') {
      if (!r) return '#334455';
      return heatColor(r.temp);
    }
    if (this.overlay === 'power') {
      if (!r) return '#333';
      if (r.damaged || !r.enabled) return '#555';
      const info = roomInfo(this.world, r);
      const produces = info.tier.effects.some((e) => e.type === 'power');
      if (produces) return '#4fd1ff';
      return r.powered >= 0.999 ? '#3fbf5f' : r.powered > 0 ? '#e0b73a' : '#d24b3a';
    }
    if (!r) return C.empty;
    if (r.damaged) return C.damaged;
    return this.world.defs.rooms[r.type]!.color;
  }

  private buildFloor(f: number, signature: string): FloorView {
    const st = this.world.state;
    const y0 = floorY(f);
    const H = GEO.cellHeight;
    const sink: AABB[] = [];
    this.colliders.set(f, sink);
    const opaque = new BoxBatch(sink);
    const translucent = new BoxBatch(sink);
    const front = new BoxBatch(sink);
    const group = new THREE.Group();
    group.name = `floor-${f}`;
    const labels = new THREE.Group();
    const labelTexts = new Map<THREE.Sprite, string>();
    const floorState = st.floors[f]!.state;

    const slotsOf = (side: -1 | 1) =>
      st.slots.filter((s) => s.floor === f && s.side === side).sort((a, b) => a.index - b.index);

    // --- Shaft landing (always built for generated floors) ---
    opaque.add(-HALF_S + 0.8, y0 - GEO.slab, -HALF_D, HALF_S, y0, -0.2, C.landing);
    opaque.add(-HALF_S, y0 - GEO.slab, -HALF_D + 0.8, -HALF_S + 0.8, y0, -0.2, C.landing);
    // Ladder rails in the hole (back-left corner of the landing).
    opaque.add(
      -HALF_S + 0.05,
      y0 - GEO.slab,
      -HALF_D + 0.02,
      -HALF_S + 0.12,
      y0 + H,
      -HALF_D + 0.12,
      C.ladder,
    );
    opaque.add(
      -HALF_S + 0.68,
      y0 - GEO.slab,
      -HALF_D + 0.02,
      -HALF_S + 0.75,
      y0 + H,
      -HALF_D + 0.12,
      C.ladder,
    );
    for (let k = 0; k < 9; k++) {
      const yy = y0 - GEO.slab + 0.15 + k * 0.42;
      opaque.add(-HALF_S + 0.12, yy, -HALF_D + 0.04, -HALF_S + 0.68, yy + 0.05, -HALF_D + 0.1, C.ladder);
    }
    // Shaft back wall and front wall.
    opaque.add(-HALF_S, y0 - GEO.slab, -HALF_D - T, HALF_S, y0 + H, -HALF_D, C.wall);
    front.add(-HALF_S, y0 - GEO.slab, HALF_D, HALF_S, y0 + H, HALF_D + T, C.wall);
    // Elevator well side guides (thin posts at the shaft edge).
    opaque.add(-HALF_S, y0, -0.2, -HALF_S + 0.15, y0 + H, 0.0, C.wallDark);
    opaque.add(HALF_S - 0.15, y0, -0.2, HALF_S, y0 + H, 0.0, C.wallDark);
    if (f === 0) opaque.add(-HALF_S, y0 + H, -HALF_D - T, HALF_S, y0 + H + GEO.slab, HALF_D + T, C.slab);
    if (floorState === 'sealed') {
      // Sealed landing: bulkhead across the landing on both sides.
      translucent.add(-HALF_S, y0, -HALF_D, -HALF_S + 0.1, y0 + H, -0.2, C.sealed);
      translucent.add(HALF_S - 0.1, y0, -HALF_D, HALF_S, y0 + H, -0.2, C.sealed);
      this.addLabel(labels, labelTexts, 0, y0 + 2.4, [
        { text: `FLOOR ${f + 1} SEALED`, color: '#e0b73a' },
        { text: 'Unseal at landing panel', size: 0.6 },
      ]);
    }

    for (const side of [-1, 1] as const) {
      const cells = slotsOf(side);
      for (const s of cells) {
        const [x0, x1] = cellsXRange(side, [s.index]);
        if (s.state === 'rock') {
          opaque.add(x0, y0 - GEO.slab, -HALF_D - T, x1, y0 + H + 0.001, HALF_D + T, C.rock);
          continue;
        }
        // Floor slab + back wall + front wall for every non-rock cell.
        opaque.add(x0, y0 - GEO.slab, -HALF_D, x1, y0, HALF_D, C.slab);
        opaque.add(x0, y0 - GEO.slab, -HALF_D - T, x1, y0 + H, -HALF_D, C.wall);
        front.add(x0, y0 - GEO.slab, HALF_D, x1, y0 + H, HALF_D + T, C.wall);
        if (f === 0) opaque.add(x0, y0 + H, -HALF_D - T, x1, y0 + H + GEO.slab, HALF_D + T, C.slab);
        // Ceiling where the cell above is rock/unbuilt is covered by the rock block above; fine.

        if (s.state === 'sealed') {
          translucent.add(
            x0 + 0.1,
            y0 + 0.01,
            -HALF_D + 0.1,
            x1 - 0.1,
            y0 + H - 0.05,
            HALF_D - 0.1,
            C.sealed,
          );
          const seal = s.seal!;
          const costTxt = seal.cost.map((c) => `${c.qty} ${c.item}`).join(', ');
          const how =
            seal.kind === 'keycard'
              ? 'Needs keycard'
              : seal.kind === 'power'
                ? `Needs spare power${costTxt ? ' + ' + costTxt : ''}`
                : `Repair: ${costTxt}`;
          this.addLabel(labels, labelTexts, (x0 + x1) / 2, y0 + 2.2, [
            { text: 'SEALED', color: '#e0b73a' },
            { text: how, size: 0.6 },
          ]);
          continue;
        }
        const r = this.world.room(s.roomId);
        if (s.state === 'empty') {
          opaque.add(x0 + 0.3, y0, -HALF_D + 0.3, x1 - 0.3, y0 + 0.02, HALF_D - 0.3, C.empty);
          this.addLabel(labels, labelTexts, (x0 + x1) / 2, y0 + 2.2, [
            { text: 'EMPTY', color: '#9fb3c4' },
            { text: 'B: build', size: 0.6, color: '#9aa' },
          ]);
        } else if (r && r.slotIds[0] === s.id) {
          this.addRoom(opaque, r, y0);
          const def = this.world.defs.rooms[r.type]!;
          const [rx0, rx1] = cellsXRange(
            side,
            r.slotIds.map((id) => this.world.slot(id)!.index),
          );
          this.addLabel(labels, labelTexts, (rx0 + rx1) / 2, y0 + 2.45, [
            {
              text: `${def.short} T${r.tier}${r.slotIds.length > 1 ? ` x${r.slotIds.length}` : ''}`,
              color: def.color,
            },
            { text: def.name, size: 0.6 },
            {
              text: r.damaged ? 'DAMAGED - repair' : 'OK',
              size: 0.6,
              color: r.damaged ? '#ff7a6a' : '#8fd18f',
            },
          ]);
        }
      }
      // Partition walls between consecutive cells (boundary k between index k-1 and k; k=0 is shaft).
      for (let k = 0; k <= GEO.cellsPerSide; k++) {
        const inner = k === 0 ? null : cells[k - 1]!;
        const outer = k === GEO.cellsPerSide ? null : cells[k]!;
        const innerOpen = k === 0 ? true : inner!.state !== 'rock';
        const outerOpen = outer ? outer.state !== 'rock' : false;
        if (!innerOpen && !outerOpen) continue;
        if (!innerOpen || (!outerOpen && k !== GEO.cellsPerSide && outer)) continue; // rock block seals it
        const sameRoom = inner && outer && inner.roomId !== null && inner.roomId === outer.roomId;
        if (sameRoom) continue;
        const xb = side * (k === 0 ? HALF_S : cellInnerX(side, k) * side);
        const xa = xb - (side * T) / 2;
        const xc = xb + (side * T) / 2;
        const lo = Math.min(xa, xc);
        const hi = Math.max(xa, xc);
        const hasDoor = outer !== null && k < GEO.cellsPerSide;
        if (!hasDoor) {
          opaque.add(lo, y0, -HALF_D, hi, y0 + H, HALF_D, C.wall);
          continue;
        }
        const dz0 = GEO.doorZ - GEO.doorWidth / 2;
        const dz1 = GEO.doorZ + GEO.doorWidth / 2;
        opaque.add(lo, y0, -HALF_D, hi, y0 + H, dz0, C.wall);
        opaque.add(lo, y0, dz1, hi, y0 + H, HALF_D, C.wall);
        opaque.add(lo, y0 + GEO.doorHeight, dz0, hi, y0 + H, dz1, C.wall);
      }
    }

    const add = (batch: BoxBatch, mat: THREE.Material, name: string) => {
      const g = batch.build();
      if (!g) return null;
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      group.add(m);
      return m;
    };
    add(opaque, this.mats.opaque, 'opaque');
    const tm = add(translucent, this.mats.translucent, 'translucent');
    if (tm) tm.renderOrder = 3;
    const fm = add(front, this.mats.opaque, 'front');
    group.add(labels);
    this.root.add(group);
    return { group, front: fm, labels, signature, labelTexts };
  }

  /** Greybox room interior: tinted floor and `blocks` prop boxes per cell (tier read-out). */
  private addRoom(batch: BoxBatch, r: Room, y0: number): void {
    const def = this.world.defs.rooms[r.type]!;
    const tier = def.tiers[r.tier - 1]!;
    const color = new THREE.Color(r.damaged ? C.damaged : def.color);
    const floorTint = color.clone().multiplyScalar(0.45);
    for (const id of r.slotIds) {
      const s = this.world.slot(id)!;
      const [x0, x1] = cellsXRange(s.side, [s.index]);
      batch.add(x0 + 0.15, y0, -HALF_D + 0.15, x1 - 0.15, y0 + 0.02, HALF_D - 0.15, floorTint);
      // Prop blocks along the front half, deterministic layout by index.
      for (let b = 0; b < tier.blocks; b++) {
        const col = b % 4;
        const row = Math.floor(b / 4);
        const bx = x0 + 0.6 + col * 1.25;
        const bz = 0.4 + row * 1.6;
        const h = 0.7 + ((b * 37 + r.tier * 11) % 9) * 0.1;
        batch.add(bx, y0, bz, bx + 1, y0 + h, bz + 1.1, color);
      }
      if (r.damaged) {
        // Hazard stripes on the floor.
        for (let k = 0; k < 3; k++)
          batch.add(x0 + 1 + k * 1.6, y0 + 0.02, -1.2, x0 + 1.6 + k * 1.6, y0 + 0.05, -0.8, C.stripe);
      }
    }
  }

  private addLabel(
    group: THREE.Group,
    texts: Map<THREE.Sprite, string>,
    x: number,
    y: number,
    lines: { text: string; color?: string; size?: number }[],
  ): void {
    const sprite = makeLabel(lines, 0.75 + 0.2 * (lines.length - 1));
    sprite.position.set(x, y, 0);
    sprite.userData.baseScale = sprite.scale.clone();
    group.add(sprite);
    texts.set(sprite, lines.map((l) => l.text).join('\n'));
  }

  dispose(): void {
    disposeTree(this.root);
    for (const m of Object.values(this.mats)) m.dispose();
  }
}

/** Blue (cold) -> green (comfortable) -> red (hot). Colourblind-safer palette later (Phase 6). */
export function heatColor(t: number): THREE.Color {
  const c = new THREE.Color();
  if (t <= 0) return c.set('#2f5bd8');
  if (t < 12) return c.set('#2f5bd8').lerp(new THREE.Color('#3fbfbf'), t / 12);
  if (t < 22) return c.set('#3fbfbf').lerp(new THREE.Color('#3fbf5f'), (t - 12) / 10);
  if (t < 32) return c.set('#3fbf5f').lerp(new THREE.Color('#e0b73a'), (t - 22) / 10);
  return c.set('#e0b73a').lerp(new THREE.Color('#d24b3a'), Math.min(1, (t - 32) / 10));
}
