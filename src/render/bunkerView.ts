/**
 * Greybox bunker for the 3D cell layout. Geometry is merged per level (opaque / translucent /
 * ceiling batches, ~3 draw calls per level) and rebuilt only when that level's signature changes.
 * Collider boxes come from the same code (BoxBatch sink). Instanced bands per room cell carry room
 * colour or the power/heat overlay. In overview, levels above the focus and the focus ceiling hide.
 */
import * as THREE from 'three';
import { GEO } from '../sim/core/state';
import type { Cell, Link, Room } from '../sim/core/state';
import { LADDER_SIZE, WELL, cellCenter, cellX0, cellZ0, doorPoint, floorY } from '../sim/core/geometry';
import type { World } from '../sim';
import { BoxBatch, disposeTree } from './greybox';
import type { AABB } from './greybox';
import { makeLabel } from './labels';
import { roomInfo } from '../sim/systems/rooms';

export type Overlay = 'none' | 'power' | 'heat';

const C = {
  slab: '#6f7377',
  wall: '#868b90',
  outer: '#5d6166',
  corridor: '#5b6168',
  sealed: '#e0b73a',
  frozen: '#9fd8ff',
  dark: '#14171a',
  rubble: '#5a4a3c',
  damaged: '#7a5148',
  ladder: '#c7c34a',
  rail: '#c9a227',
  stripe: '#d24b3a',
};
const SEAL_COLOR: Record<string, string> = {
  power: '#4fd1ff',
  thaw: '#9fd8ff',
  repair: '#e0b73a',
  keycard: '#d24b3a',
};

const T = 0.2; // wall thickness
const S = GEO.cell;
const H = GEO.cellHeight;

interface LevelView {
  group: THREE.Group;
  ceiling: THREE.Mesh | null;
  labels: THREE.Group;
  signature: string;
}

export class BunkerView {
  readonly root = new THREE.Group();
  private levels = new Map<number, LevelView>();
  private mats = {
    opaque: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 }),
    translucent: new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
    band: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }),
    light: new THREE.MeshBasicMaterial({ color: '#fff3d6' }),
  };
  private bands: THREE.InstancedMesh;
  private bandCells: number[] = [];
  /** Solid boxes per level (for physics). */
  readonly colliders = new Map<number, AABB[]>();
  onLevelBuilt: ((level: number, boxes: AABB[]) => void) | null = null;
  overlay: Overlay = 'none';
  focusLevel = 0;
  overview = false;
  readonly maxLevel: number;
  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();
  private bandOverlay: Overlay | null = null;

  constructor(private world: World) {
    for (const m of Object.values(this.mats)) m.userData.shared = true;
    this.maxLevel = Math.max(...world.state.cells.map((c) => c.y));
    const bandGeo = new THREE.BoxGeometry(S - 0.4, 0.12, S - 0.4);
    this.bands = new THREE.InstancedMesh(bandGeo, this.mats.band, Math.max(1, world.state.cells.length));
    this.bands.frustumCulled = false;
    this.bands.renderOrder = 2;
    this.root.add(this.bands);
    this.sync(true);
  }

  /** Rebuild levels whose layout changed. Cheap when nothing changed. */
  sync(force = false): void {
    for (let y = 0; y <= this.maxLevel; y++) {
      const sig = this.signature(y);
      const lv = this.levels.get(y);
      if (!force && lv && lv.signature === sig) continue;
      if (lv) {
        this.root.remove(lv.group);
        disposeTree(lv.group);
      }
      this.levels.set(y, this.buildLevel(y, sig));
      this.onLevelBuilt?.(y, this.colliders.get(y)!);
    }
    // One band per room cell at the room's true ceiling (skip lower cells of tall rooms).
    this.bandCells = this.world.state.cells
      .filter((c) => c.roomId !== null && this.world.cellAt(c.x, c.y - 1, c.z)?.roomId !== c.roomId)
      .map((c) => c.id);
    this.bands.count = this.bandCells.length;
    this.bandOverlay = null;
    this.update();
    this.applyVisibility();
  }

  update(): void {
    if (this.bandOverlay !== this.overlay) this.layoutBands();
    this.bandCells.forEach((id, i) => {
      const c = this.world.cell(id)!;
      this.tmpC.set(this.bandColor(this.world.room(c.roomId)!));
      this.bands.setColorAt(i, this.tmpC);
    });
    if (this.bands.instanceColor) this.bands.instanceColor.needsUpdate = true;
  }

  private layoutBands(): void {
    this.bandOverlay = this.overlay;
    const full = this.overlay !== 'none';
    this.mats.band.opacity = full ? 0.38 : 0.55;
    this.bandCells.forEach((id, i) => {
      const c = this.world.cell(id)!;
      const p = cellCenter(c);
      if (this.overview && c.y < this.focusLevel) {
        this.tmpM.makeScale(0, 0, 0);
        this.bands.setMatrixAt(i, this.tmpM);
        return;
      }
      const h = full ? H - 0.1 : 0.12;
      const y = floorY(c.y) + (full ? H / 2 : H - 0.1);
      this.tmpM.makeScale(1, h / 0.12, 1).setPosition(p.x, y, p.z);
      this.bands.setMatrixAt(i, this.tmpM);
    });
    this.bands.instanceMatrix.needsUpdate = true;
  }

  private bandColor(r: Room): THREE.ColorRepresentation {
    if (this.overlay === 'heat') return heatColor(r.temp);
    if (this.overlay === 'power') {
      if (r.damaged || !r.enabled || !this.world.roomOpen(r)) return '#555';
      const info = roomInfo(this.world, r);
      if (info.tier.effects.some((e) => e.type === 'power')) return '#4fd1ff';
      return r.powered >= 0.999 ? '#3fbf5f' : r.powered > 0 ? '#e0b73a' : '#d24b3a';
    }
    if (!this.world.roomOpen(r)) return '#333a40';
    return r.damaged ? C.damaged : this.world.defs.rooms[r.type]!.color;
  }

  setFocus(level: number): void {
    const f = Math.max(0, Math.min(this.maxLevel, Math.round(level)));
    if (f !== this.focusLevel) {
      this.focusLevel = f;
      this.applyVisibility();
    }
  }
  setOverview(on: boolean): void {
    this.overview = on;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    for (const [y, lv] of this.levels) {
      lv.group.visible = this.overview ? y >= this.focusLevel : true;
      if (lv.ceiling) lv.ceiling.visible = !(this.overview && y === this.focusLevel);
      lv.labels.visible = this.overview ? y === this.focusLevel : Math.abs(y - this.focusLevel) <= 1;
      const k = this.overview ? 2.3 : 1;
      for (const o of lv.labels.children) {
        const base = o.userData.baseScale as THREE.Vector3 | undefined;
        if (base) o.scale.set(base.x * k, base.y * k, 1);
        const sm = (o as THREE.Sprite).material;
        if (sm) sm.depthTest = !this.overview;
      }
    }
    this.layoutBands();
  }

  private signature(y: number): string {
    const w = this.world;
    const parts: string[] = [];
    for (const c of w.state.cells) {
      if (c.y !== y && c.y !== y - 1 && c.y !== y + 1) continue;
      const r = w.room(c.roomId);
      const sh = w.shaft(c.shaftId);
      parts.push(
        `${c.id}${w.cellOpen(c) ? 'o' : 's'}${r ? `${r.type}${r.tier}${r.damaged ? 'd' : ''}` : ''}${sh?.broken ? 'b' : ''}`,
      );
    }
    for (const l of w.state.links) if (l.sealed) parts.push(`L${l.id}`);
    for (const m of w.state.machines) parts.push(`m${m.id}`);
    return parts.join('|');
  }

  private buildLevel(y: number, signature: string): LevelView {
    const w = this.world;
    const y0 = floorY(y);
    const sink: AABB[] = [];
    this.colliders.set(y, sink);
    const opaque = new BoxBatch(sink);
    const translucent = new BoxBatch(sink);
    const ceiling = new BoxBatch(sink);
    const fx = new BoxBatch(); // visual-only translucent (tints)
    const lights = new BoxBatch(); // emissive ceiling strips (visual only)
    const group = new THREE.Group();
    group.name = `level-${y}`;
    const labels = new THREE.Group();
    const cells = w.state.cells.filter((c) => c.y === y);

    for (const c of cells) {
      const x0 = cellX0(c);
      const z0 = cellZ0(c);
      const room = w.room(c.roomId);
      const shaft = w.shaft(c.shaftId);
      const below = w.cellAt(c.x, y + 1, c.z);
      const above = w.cellAt(c.x, y - 1, c.z);
      const open = w.cellOpen(c);
      const tallUpper = room && below && below.roomId === room.id; // no floor: room continues below

      // --- Floor slab ---
      const floorCol = c.kind === 'corridor' ? C.corridor : C.slab;
      if (!tallUpper) {
        if (shaft?.kind === 'elevator' && below?.shaftId === shaft.id) {
          const i = WELL.inset;
          opaque.add(x0, y0 - GEO.slab, z0, x0 + S, y0, z0 + i, floorCol);
          opaque.add(x0, y0 - GEO.slab, z0 + S - i, x0 + S, y0, z0 + S, floorCol);
          opaque.add(x0, y0 - GEO.slab, z0 + i, x0 + i, y0, z0 + S - i, floorCol);
          opaque.add(x0 + S - i, y0 - GEO.slab, z0 + i, x0 + S, y0, z0 + S - i, floorCol);
        } else if (shaft?.kind === 'ladder' && below?.shaftId === shaft.id) {
          const L = LADDER_SIZE;
          opaque.add(x0 + L, y0 - GEO.slab, z0, x0 + S, y0, z0 + S, floorCol);
          opaque.add(x0, y0 - GEO.slab, z0 + L, x0 + L, y0, z0 + S, floorCol);
        } else opaque.add(x0, y0 - GEO.slab, z0, x0 + S, y0, z0 + S, floorCol);
      }
      // --- Ceiling light strip in open, non-shaft cells (none in sealed / tall-upper cells) ---
      const tallLower = room && above && above.roomId === room.id;
      if (open && c.kind !== 'shaft' && !tallUpper) {
        const ly = tallLower ? y0 + H * 2 + GEO.slab - 0.12 : y0 + H - 0.08;
        lights.add(x0 + 1.5, ly, z0 + S / 2 - 0.12, x0 + S - 1.5, ly + 0.06, z0 + S / 2 + 0.12, '#ffffff');
      }
      // --- Ceiling where nothing is above ---
      if (!above) ceiling.add(x0, y0 + H, z0, x0 + S, y0 + H + GEO.slab, z0 + S, C.slab);

      // --- Walls (each shared wall drawn once, from the lower id) ---
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const n = w.cellAt(c.x + dx, y, c.z + dz);
        if (n && room && n.roomId === room.id) continue;
        if (n && n.id < c.id) continue;
        const link = n ? w.linksOf(c.id).find((l) => l.a === n.id || l.b === n.id) : undefined;
        this.wall(opaque, translucent, c, dx, dz, y0, link, !n);
      }

      // --- Shaft details ---
      if (shaft?.kind === 'elevator') {
        const i = WELL.inset;
        if (below?.shaftId === shaft.id || above?.shaftId === shaft.id) {
          // Guide posts in the well corners.
          for (const [px, pz] of [
            [x0 + i, z0 + i],
            [x0 + S - i - 0.15, z0 + i],
            [x0 + i, z0 + S - i - 0.15],
            [x0 + S - i - 0.15, z0 + S - i - 0.15],
          ] as const)
            opaque.add(px, y0 - GEO.slab, pz, px + 0.15, y0 + H, pz + 0.15, C.outer, false);
          // Railings on three sides of the well (the -z side has the gate, see ActorsView/physics).
          opaque.add(x0 + i, y0, z0 + S - i - 0.06, x0 + S - i, y0 + 1.1, z0 + S - i, C.rail);
          opaque.add(x0 + i - 0.06, y0, z0 + i, x0 + i, y0 + 1.1, z0 + S - i, C.rail);
          opaque.add(x0 + S - i, y0, z0 + i, x0 + S - i + 0.06, y0 + 1.1, z0 + S - i, C.rail);
        }
      }
      if (shaft?.kind === 'ladder') {
        const top = above?.shaftId === shaft.id ? y0 + H + GEO.slab : y0 + 1.2;
        const bottom = y0 - GEO.slab;
        const col = shaft.broken ? C.stripe : C.ladder;
        opaque.add(x0 + 0.05, bottom, z0 + 0.02, x0 + 0.12, top, z0 + 0.12, col, false);
        opaque.add(x0 + 0.68, bottom, z0 + 0.02, x0 + 0.75, top, z0 + 0.12, col, false);
        for (let k = 0; k < 9; k++) {
          const yy = bottom + 0.15 + k * 0.42;
          if (yy > top) break;
          if (shaft.broken && k % 3 === 1) continue; // missing rungs
          opaque.add(x0 + 0.12, yy, z0 + 0.04, x0 + 0.68, yy + 0.05, z0 + 0.1, col, false);
        }
        if (shaft.broken && y === shaft.top)
          this.label(labels, x0 + 1.2, y0 + 1.8, z0 + 1.2, [
            { text: 'BROKEN LADDER', color: '#ff7a6a' },
            { text: 'E: repair', size: 0.6 },
          ]);
      }

      // --- Room interiors ---
      if (room && !tallUpper) this.roomProps(opaque, room, c, y0);

      // --- Sealed section tint / rubble ---
      if (!open) {
        const sec = w.state.sections.find((s) => s.id === c.sectionId)!;
        const tint = sec.condition === 'frozen' ? C.frozen : sec.condition === 'dark' ? C.dark : null;
        if (tint) fx.add(x0 + 0.15, y0 + 0.02, z0 + 0.15, x0 + S - 0.15, y0 + H - 0.05, z0 + S - 0.15, tint);
        if (sec.condition === 'collapsed' && c.kind === 'corridor')
          for (let k = 0; k < 4; k++)
            opaque.add(
              x0 + 1 + k * 1.1,
              y0,
              z0 + 1.5 + (k % 2),
              x0 + 1.9 + k * 1.1,
              y0 + 0.5 + (k % 3) * 0.4,
              z0 + 2.6 + (k % 2),
              C.rubble,
              false,
            );
      }
    }

    // Room labels (at the room's lowest level centre).
    for (const r of w.state.rooms) {
      const rc = r.cellIds.map((id) => w.cell(id)!);
      const lowest = Math.max(...rc.map((c) => c.y));
      if (lowest !== y) continue;
      const floorCells = rc.filter((c) => c.y === lowest);
      const cx = floorCells.reduce((a, c) => a + cellCenter(c).x, 0) / floorCells.length;
      const cz = floorCells.reduce((a, c) => a + cellCenter(c).z, 0) / floorCells.length;
      const def = w.defs.rooms[r.type]!;
      const open = w.roomOpen(r);
      const tall = new Set(rc.map((c) => c.y)).size > 1;
      this.label(labels, cx, y0 + 2.5, cz, [
        {
          text: `${def.short} T${r.tier}${rc.length > 1 ? ` ·${rc.length}` : ''}${tall ? ' ↕' : ''}`,
          color: open ? def.color : '#8a8f94',
        },
        { text: def.name, size: 0.6 },
        {
          text: !open ? 'SEALED SECTION' : r.damaged ? 'DAMAGED - repair' : 'OK',
          size: 0.6,
          color: !open ? '#e0b73a' : r.damaged ? '#ff7a6a' : '#8fd18f',
        },
      ]);
    }
    // Bulkhead labels.
    for (const l of w.state.links) {
      if (!l.sealed || !l.seal) continue;
      const a = w.cell(l.a)!;
      if (a.y !== y) continue;
      const p = doorPoint(a, w.cell(l.b)!);
      this.label(labels, p.x, y0 + 2.6, p.z, [
        { text: 'SEALED BULKHEAD', color: SEAL_COLOR[l.seal.kind] ?? '#e0b73a' },
        { text: l.seal.label, size: 0.55 },
      ]);
    }

    const add = (batch: BoxBatch, mat: THREE.Material, name: string, order = 0) => {
      const g = batch.build();
      if (!g) return null;
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      m.renderOrder = order;
      group.add(m);
      return m;
    };
    add(opaque, this.mats.opaque, 'opaque');
    add(translucent, this.mats.translucent, 'translucent', 3);
    add(fx, this.mats.translucent, 'tint', 3);
    add(lights, this.mats.light, 'lights');
    const ceil = add(ceiling, this.mats.opaque, 'ceiling');
    group.add(labels);
    this.root.add(group);
    return { group, ceiling: ceil, labels, signature };
  }

  /** One cell face: outer rock wall, plain wall, doorway, or sealed bulkhead panel. */
  private wall(
    opaque: BoxBatch,
    translucent: BoxBatch,
    c: Cell,
    dx: number,
    dz: number,
    y0: number,
    link: Link | undefined,
    outer: boolean,
  ): void {
    const x0 = cellX0(c);
    const z0 = cellZ0(c);
    const col = outer ? C.outer : C.wall;
    const y1 = y0 + H;
    const yb = y0 - GEO.slab;
    // Face plane coordinate and extent along the face.
    const alongX = dz !== 0; // wall runs along x
    const plane = alongX ? (dz > 0 ? z0 + S : z0) : dx > 0 ? x0 + S : x0;
    const a0 = alongX ? x0 : z0;
    const a1 = a0 + S;
    const box = (u0: number, u1: number, v0: number, v1: number, color: string, batch = opaque) => {
      if (alongX) batch.add(u0, v0, plane - T / 2, u1, v1, plane + T / 2, color);
      else batch.add(plane - T / 2, v0, u0, plane + T / 2, v1, u1, color);
    };
    if (!link) {
      box(a0, a1, yb, y1, col);
      return;
    }
    const mid = (a0 + a1) / 2;
    const d0 = mid - GEO.doorWidth / 2;
    const d1 = mid + GEO.doorWidth / 2;
    box(a0, d0, yb, y1, col);
    box(d1, a1, yb, y1, col);
    box(d0, d1, y0 + GEO.doorHeight, y1, col);
    if (link.sealed)
      box(d0, d1, y0, y0 + GEO.doorHeight, SEAL_COLOR[link.seal?.kind ?? 'repair'] ?? C.sealed, translucent);
  }

  /** Greybox props: floor tint + `blocks` boxes along the walls (machine corners stay free). */
  private roomProps(batch: BoxBatch, r: Room, c: Cell, y0: number): void {
    const def = this.world.defs.rooms[r.type]!;
    const tier = def.tiers[r.tier - 1]!;
    const open = this.world.roomOpen(r);
    const color = new THREE.Color(!open ? '#3a3f45' : r.damaged ? C.damaged : def.color);
    const x0 = cellX0(c);
    const z0 = cellZ0(c);
    batch.add(
      x0 + 0.15,
      y0,
      z0 + 0.15,
      x0 + S - 0.15,
      y0 + 0.02,
      z0 + S - 0.15,
      color.clone().multiplyScalar(0.45),
    );
    const machineRoom = Object.values(this.world.defs.machines).some((m) => m.allowedRooms.includes(r.type));
    // Prop spots: wall-side spots between the corners and the door gaps.
    const spots: [number, number][] = [
      [0.25, 1.0],
      [0.25, 4.0],
      [S - 1.05, 1.0],
      [S - 1.05, 4.0],
      [1.0, 0.25],
      [4.0, 0.25],
      [1.0, S - 1.05],
      [4.0, S - 1.05],
    ];
    const n = machineRoom ? Math.min(2, tier.blocks) : tier.blocks;
    for (let b = 0; b < Math.min(n, spots.length); b++) {
      const [sx, sz] = spots[(b * 3 + c.id) % spots.length]!;
      const h = 0.7 + ((b * 37 + r.tier * 11) % 9) * 0.1;
      batch.add(x0 + sx, y0, z0 + sz, x0 + sx + 0.8, y0 + h, z0 + sz + 0.8, color);
    }
    if (r.damaged)
      for (let k = 0; k < 3; k++)
        batch.add(x0 + 1.2 + k * 1.4, y0 + 0.02, z0 + 2.8, x0 + 1.8 + k * 1.4, y0 + 0.05, z0 + 3.2, C.stripe);
  }

  private label(
    group: THREE.Group,
    x: number,
    y: number,
    z: number,
    lines: { text: string; color?: string; size?: number }[],
  ): void {
    const sprite = makeLabel(lines, 0.7 + 0.2 * (lines.length - 1));
    sprite.position.set(x, y, z);
    sprite.userData.baseScale = sprite.scale.clone();
    group.add(sprite);
  }

  dispose(): void {
    disposeTree(this.root);
    for (const m of Object.values(this.mats)) m.dispose();
  }
}

/** Blue (cold) -> green (comfortable) -> red (hot). */
export function heatColor(t: number): THREE.Color {
  const c = new THREE.Color();
  if (t <= 0) return c.set('#2f5bd8');
  if (t < 12) return c.set('#2f5bd8').lerp(new THREE.Color('#3fbfbf'), t / 12);
  if (t < 22) return c.set('#3fbfbf').lerp(new THREE.Color('#3fbf5f'), (t - 12) / 10);
  if (t < 32) return c.set('#3fbf5f').lerp(new THREE.Color('#e0b73a'), (t - 22) / 10);
  return c.set('#e0b73a').lerp(new THREE.Color('#d24b3a'), Math.min(1, (t - 32) / 10));
}
