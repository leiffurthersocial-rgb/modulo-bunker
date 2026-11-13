import RAPIER from '@dimforge/rapier3d-compat';
import type { AABB } from '../render/greybox';

export const PLAYER_RADIUS = 0.3;
export const STAND_HALF = 0.55; // capsule half-height (segment); total height = 2*(half+radius) = 1.7
export const CROUCH_HALF = 0.25; // total 1.1

/**
 * Player-only physics. Static colliders are rebuilt per level from the same boxes the greybox
 * renderer draws. Elevator cars are handled by the controller (moving floors), gates are colliders.
 * Rapier is not part of the deterministic sim.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private levelColliders = new Map<number, RAPIER.Collider[]>();
  private gates = new Map<string, RAPIER.Collider>();
  readonly playerBody: RAPIER.RigidBody;
  playerCollider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  crouched = false;

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0),
    );
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(STAND_HALF, PLAYER_RADIUS),
      this.playerBody,
    );
    this.controller = this.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.35, 0.25, false);
    this.controller.enableSnapToGround(0.35);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setSlideEnabled(true);
  }

  setLevelBoxes(level: number, boxes: AABB[]): void {
    for (const c of this.levelColliders.get(level) ?? []) this.world.removeCollider(c, false);
    const list: RAPIER.Collider[] = [];
    for (const b of boxes) {
      const hx = (b.x1 - b.x0) / 2;
      const hy = (b.y1 - b.y0) / 2;
      const hz = (b.z1 - b.z0) / 2;
      if (hx < 0.005 || hy < 0.005 || hz < 0.005) continue;
      list.push(
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(b.x0 + hx, b.y0 + hy, b.z0 + hz),
        ),
      );
    }
    this.levelColliders.set(level, list);
  }

  /** Landing gate collider (created on first use). */
  setGate(key: string, box: AABB, open: boolean): void {
    let g = this.gates.get(key);
    if (!g) {
      const hx = (box.x1 - box.x0) / 2;
      const hy = (box.y1 - box.y0) / 2;
      const hz = (box.z1 - box.z0) / 2;
      g = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(box.x0 + hx, box.y0 + hy, box.z0 + hz),
      );
      this.gates.set(key, g);
    }
    g.setEnabled(!open);
  }

  setCrouched(c: boolean): boolean {
    if (c === this.crouched) return true;
    const p = this.playerBody.translation();
    if (!c) {
      const shape = new RAPIER.Capsule(STAND_HALF, PLAYER_RADIUS - 0.02);
      const hit = this.world.intersectionWithShape(
        { x: p.x, y: p.y + (STAND_HALF - CROUCH_HALF) + 0.02, z: p.z },
        { x: 0, y: 0, z: 0, w: 1 },
        shape,
        undefined,
        undefined,
        this.playerCollider,
      );
      if (hit) return false;
    }
    const dy = c ? -(STAND_HALF - CROUCH_HALF) : STAND_HALF - CROUCH_HALF;
    this.world.removeCollider(this.playerCollider, false);
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(c ? CROUCH_HALF : STAND_HALF, PLAYER_RADIUS),
      this.playerBody,
    );
    this.playerBody.setTranslation({ x: p.x, y: p.y + dy, z: p.z }, true);
    this.crouched = c;
    return true;
  }

  get halfHeight(): number {
    return this.crouched ? CROUCH_HALF : STAND_HALF;
  }

  step(): void {
    this.world.step();
  }
}
