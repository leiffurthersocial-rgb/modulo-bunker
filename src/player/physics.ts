import RAPIER from '@dimforge/rapier3d-compat';
import type { AABB } from '../render/greybox';
import { GEO } from '../sim/core/state';
import { floorY } from '../sim/core/geometry';
import { GENERATED_FLOORS } from '../gen/bunker';

export const PLAYER_RADIUS = 0.3;
export const STAND_HALF = 0.55; // capsule half-height (segment); total height = 2*(half+radius) = 1.7
export const CROUCH_HALF = 0.25; // total 1.1

/** Car footprint (floor-local x/z) — matches ActorsView. */
export const CAR = {
  x0: -(GEO.shaftWidth - 0.5) / 2,
  x1: (GEO.shaftWidth - 0.5) / 2,
  z0: 0,
  z1: 3.6,
} as const;

/**
 * Player-only physics. Static colliders are rebuilt per floor from the same boxes the greybox
 * renderer draws. Rapier is not part of the deterministic sim (see DECISIONS).
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private floorColliders = new Map<number, RAPIER.Collider[]>();
  private gates: RAPIER.Collider[] = [];
  private carBody: RAPIER.RigidBody;
  readonly carCollider: RAPIER.Collider;
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
    // Landing gates (one per floor), toggled by elevator state.
    for (let f = 0; f < GENERATED_FLOORS; f++) {
      const g = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(GEO.shaftWidth / 2, 1.5, 0.05).setTranslation(0, floorY(f) + 1.5, -0.15),
      );
      this.gates.push(g);
    }
    // Elevator car floor (kinematic).
    this.carBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0),
    );
    this.carCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid((CAR.x1 - CAR.x0) / 2, 0.1, (CAR.z1 - CAR.z0) / 2).setTranslation(
        0,
        -0.1,
        (CAR.z0 + CAR.z1) / 2,
      ),
      this.carBody,
    );
    // Player.
    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, -2.5),
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

  setFloorBoxes(floor: number, boxes: AABB[]): void {
    for (const c of this.floorColliders.get(floor) ?? []) this.world.removeCollider(c, false);
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
    this.floorColliders.set(floor, list);
  }

  setGateOpen(floor: number, open: boolean): void {
    this.gates[floor]?.setEnabled(!open);
  }

  setCarY(y: number): void {
    this.carBody.setNextKinematicTranslation({ x: 0, y, z: 0 });
  }

  setCrouched(c: boolean): boolean {
    if (c === this.crouched) return true;
    if (!c) {
      // Standing up: make sure there is head room.
      const p = this.playerBody.translation();
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
    const p = this.playerBody.translation();
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
