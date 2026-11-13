import type { Intent } from '../input/input';
import { PLAYER_RADIUS, CAR } from './physics';
import type { PhysicsWorld } from './physics';
import { GEO } from '../sim/core/state';
import { floorY } from '../sim/core/geometry';

const WALK = 3.4;
const SPRINT = 5.6;
const CROUCH = 1.7;
const GROUND_ACCEL = 38;
const AIR_ACCEL = 6;
const GRAVITY = -22;
const JUMP_V = 5.2;
const LADDER_SPEED = 2.4;
const EYE_ABOVE_CENTER_STAND = 0.75;
const EYE_ABOVE_CENTER_CROUCH = 0.35;
const COYOTE = 0.12;

/** Ladder column (floor-local), matches the hole in the landing slab. */
export const LADDER = {
  x0: -GEO.shaftWidth / 2,
  x1: -GEO.shaftWidth / 2 + 0.8,
  z0: -GEO.cellDepth / 2,
  z1: -GEO.cellDepth / 2 + 0.8,
};

export type MoveMode = 'walk' | 'ladder';

/** First-person controller on a Rapier KinematicCharacterController. */
export class FirstPersonController {
  yaw = Math.PI; // facing -z... set by spawn
  pitch = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  grounded = false;
  mode: MoveMode = 'walk';
  private sinceGround = 0;
  /** Highest feet y since leaving the ground (fall-recovery safety net). */
  private fallStart = 0;
  /** Lowest open floor (ladder bottom). Set by the game. */
  lowestOpenFloor = 0;
  /** Head-bob phase (render only). */
  private bob = 0;
  bobEnabled = true;

  constructor(private phys: PhysicsWorld) {}

  get position() {
    return this.phys.playerBody.translation();
  }

  /** Feet y. */
  get feetY(): number {
    return this.position.y - this.phys.halfHeight - PLAYER_RADIUS;
  }

  /** Current floor index from feet height. */
  get floor(): number {
    return Math.max(0, Math.round(-this.feetY / GEO.floorPitch));
  }

  teleport(x: number, feetY: number, z: number, yaw: number): void {
    this.phys.playerBody.setTranslation(
      { x, y: feetY + this.phys.halfHeight + PLAYER_RADIUS + 0.02, z },
      true,
    );
    this.yaw = yaw;
    this.vx = this.vy = this.vz = 0;
  }

  /**
   * @param carDeltaY vertical movement of the elevator car this frame (carried when standing in it)
   */
  update(intent: Intent, dt: number, carY: number, carDeltaY: number): void {
    this.yaw -= intent.lookDX;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - intent.lookDY));
    const wantCrouch = intent.crouch;
    if (wantCrouch !== this.phys.crouched) this.phys.setCrouched(wantCrouch);

    const p = this.position;
    const inLadder = p.x > LADDER.x0 && p.x < LADDER.x1 && p.z > LADDER.z0 && p.z < LADDER.z1;
    const ladderBottom = floorY(this.lowestOpenFloor);
    if (inLadder && this.feetY > ladderBottom - 0.05) this.mode = 'ladder';
    else this.mode = 'walk';

    // Desired horizontal velocity in world space.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Forward is -z when yaw = 0.
    const fx = -sin;
    const fz = -cos;
    const rx = cos;
    const rz = -sin;
    const speed = this.phys.crouched ? CROUCH : intent.sprint ? SPRINT : WALK;
    const tx = (fx * intent.moveZ + rx * intent.moveX) * speed;
    const tz = (fz * intent.moveZ + rz * intent.moveX) * speed;

    let dy: number;
    if (this.mode === 'ladder') {
      // W climbs up, S climbs down. Only strafe moves horizontally (to step off onto a landing).
      this.vy = intent.moveZ * LADDER_SPEED;
      this.vx = rx * intent.moveX * WALK * 0.5;
      this.vz = rz * intent.moveX * WALK * 0.5;
      if (intent.jump) {
        this.vx = -fx * 2.5;
        this.vz = -fz * 2.5;
        this.vy = 2;
        this.mode = 'walk';
      }
      dy = this.vy * dt;
      // Do not climb above the top floor's landing.
      if (this.feetY + dy > floorY(0) + 0.05 && dy > 0) dy = Math.max(0, floorY(0) + 0.05 - this.feetY);
      if (this.feetY + dy < ladderBottom && dy < 0) dy = ladderBottom - this.feetY;
    } else {
      const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
      this.vx += clampDelta(tx - this.vx, accel * dt);
      this.vz += clampDelta(tz - this.vz, accel * dt);
      if (this.grounded) this.sinceGround = 0;
      else this.sinceGround += dt;
      if (intent.jump && this.sinceGround < COYOTE && !this.phys.crouched) {
        this.vy = JUMP_V;
        this.sinceGround = COYOTE;
      }
      this.vy = this.grounded && this.vy < 0 ? -1 : this.vy + GRAVITY * dt;
      dy = this.vy * dt;
    }

    const c = this.phys.controller;
    const car = this.phys.carCollider;
    c.computeColliderMovement(
      this.phys.playerCollider,
      { x: this.vx * dt, y: dy, z: this.vz * dt },
      undefined,
      undefined,
      (col) => col !== car,
    );
    const m = c.computedMovement();
    let ny = p.y + m.y;
    this.grounded = c.computedGrounded();
    // Elevator car floor handled by hand (it moves every frame; KCC ignores it).
    const nx = p.x + m.x;
    const nz = p.z + m.z;
    const inCar = nx > CAR.x0 && nx < CAR.x1 && nz > CAR.z0 && nz < CAR.z1;
    const off = this.phys.halfHeight + PLAYER_RADIUS;
    const newFeet = ny - off;
    if (
      this.mode === 'walk' &&
      inCar &&
      newFeet < carY + 0.02 &&
      this.feetY > carY - 0.6 - Math.max(0, -carDeltaY)
    ) {
      ny = carY + off;
      this.grounded = true;
      if (this.vy < 0) this.vy = 0;
    } else if (this.mode === 'walk' && inCar && Math.abs(this.feetY - carY) < 0.05 && carDeltaY > 0) {
      ny = carY + off;
    }
    this.phys.playerBody.setTranslation({ x: nx, y: ny, z: nz }, true);
    if (this.grounded && this.vy > 0 && m.y < this.vy * dt * 0.5) this.vy = 0;
    if (Math.abs(m.y) < Math.abs(dy) * 0.5 && dy > 0) this.vy = Math.min(this.vy, 0); // bonk head
    // Safety net: a long fall (e.g. into the elevator shaft) puts you back on the nearest landing.
    if (this.grounded || this.mode === 'ladder') this.fallStart = this.feetY;
    else if (this.fallStart - this.feetY > 4.5) {
      const f = Math.max(0, Math.round(-this.fallStart / GEO.floorPitch));
      this.teleport(0.6, floorY(f), -2.6, this.yaw);
      this.fallStart = floorY(f);
      return;
    }
    const hs = Math.hypot(this.vx, this.vz);
    if (this.grounded && hs > 0.5) this.bob += dt * hs * 2.2;
  }

  /** Eye position for the camera (call after physics step). */
  eye(): { x: number; y: number; z: number } {
    const p = this.position;
    const e = this.phys.crouched ? EYE_ABOVE_CENTER_CROUCH : EYE_ABOVE_CENTER_STAND;
    const bob = this.bobEnabled ? Math.sin(this.bob) * 0.035 : 0;
    return { x: p.x, y: p.y + e + bob, z: p.z };
  }
}

function clampDelta(d: number, max: number): number {
  return d > max ? max : d < -max ? -max : d;
}
