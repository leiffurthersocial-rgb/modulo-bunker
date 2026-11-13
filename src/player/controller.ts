import type { Intent } from '../input/input';
import { PLAYER_RADIUS } from './physics';
import type { PhysicsWorld } from './physics';
import { levelAtY } from '../sim/core/geometry';

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

/** A moving elevator floor (world x/z footprint, current top y, and its movement this frame). */
export interface CarZone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  dy: number;
}
/** A climbable ladder column (world footprint, bottom/top feet heights). */
export interface LadderZone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  bottom: number;
  top: number;
}

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
  /** Elevator cars and ladders, refreshed by the game every frame. */
  cars: CarZone[] = [];
  ladders: LadderZone[] = [];
  /** Head-bob phase (render only). */
  private bob = 0;
  bobEnabled = true;
  /** Called after a long fall with the level fallen from (game puts the player back somewhere safe). */
  onFall: ((level: number) => void) | null = null;
  /** Debug free camera: fly through walls. */
  noclip = false;

  constructor(private phys: PhysicsWorld) {}

  get position() {
    return this.phys.playerBody.translation();
  }

  /** Feet y. */
  get feetY(): number {
    return this.position.y - this.phys.halfHeight - PLAYER_RADIUS;
  }

  /** Current level from feet height. */
  get level(): number {
    return Math.max(0, levelAtY(this.feetY + 0.1));
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
  update(intent: Intent, dt: number): void {
    this.yaw -= intent.lookDX;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - intent.lookDY));
    const wantCrouch = intent.crouch;
    if (wantCrouch !== this.phys.crouched) this.phys.setCrouched(wantCrouch);

    if (this.noclip) {
      const p0 = this.position;
      const sp = (intent.sprint ? 14 : 6) * dt;
      const cp = Math.cos(this.pitch);
      const fx0 = -Math.sin(this.yaw) * cp;
      const fy0 = Math.sin(this.pitch);
      const fz0 = -Math.cos(this.yaw) * cp;
      this.phys.playerBody.setTranslation(
        {
          x: p0.x + (fx0 * intent.moveZ + Math.cos(this.yaw) * intent.moveX) * sp,
          y: p0.y + fy0 * intent.moveZ * sp + (intent.jump ? 1 : 0),
          z: p0.z + (fz0 * intent.moveZ - Math.sin(this.yaw) * intent.moveX) * sp,
        },
        true,
      );
      return;
    }
    const p = this.position;
    const ladder = this.ladders.find(
      (l) =>
        p.x > l.x0 &&
        p.x < l.x1 &&
        p.z > l.z0 &&
        p.z < l.z1 &&
        this.feetY > l.bottom - 0.05 &&
        this.feetY < l.top + 0.3,
    );
    this.mode = ladder ? 'ladder' : 'walk';

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
      // Step-off assist: moving sideways near a floor lifts/lowers you onto it.
      if (Math.abs(intent.moveX) > 0.3) {
        const nearest = -Math.round(-this.feetY / 4) * 4;
        const diff = nearest + 0.03 - this.feetY;
        if (Math.abs(diff) < 0.6) dy = Math.sign(diff) * Math.min(Math.abs(diff), 3 * dt);
      }
      // Stay within the ladder's span.
      if (ladder && dy > 0 && this.feetY + dy > ladder.top + 0.05)
        dy = Math.max(0, ladder.top + 0.05 - this.feetY);
      if (ladder && dy < 0 && this.feetY + dy < ladder.bottom) dy = ladder.bottom - this.feetY;
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
    c.computeColliderMovement(this.phys.playerCollider, { x: this.vx * dt, y: dy, z: this.vz * dt });
    const m = c.computedMovement();
    let ny = p.y + m.y;
    this.grounded = c.computedGrounded();
    // Elevator car floors are handled by hand (they move every frame).
    const nx = p.x + m.x;
    const nz = p.z + m.z;
    const off = this.phys.halfHeight + PLAYER_RADIUS;
    const newFeet = ny - off;
    for (const car of this.cars) {
      const inCar = nx > car.x0 && nx < car.x1 && nz > car.z0 && nz < car.z1;
      if (!inCar || this.mode !== 'walk') continue;
      if (newFeet < car.y + 0.02 && this.feetY > car.y - 0.6 - Math.max(0, -car.dy)) {
        ny = car.y + off;
        this.grounded = true;
        if (this.vy < 0) this.vy = 0;
      } else if (Math.abs(this.feetY - car.y) < 0.05 && car.dy > 0) ny = car.y + off;
    }
    this.phys.playerBody.setTranslation({ x: nx, y: ny, z: nz }, true);
    if (this.grounded && this.vy > 0 && m.y < this.vy * dt * 0.5) this.vy = 0;
    if (Math.abs(m.y) < Math.abs(dy) * 0.5 && dy > 0) this.vy = Math.min(this.vy, 0); // bonk head
    // Safety net: a long fall (e.g. into the elevator shaft) puts you back on the nearest landing.
    if (this.grounded || this.mode === 'ladder') this.fallStart = this.feetY;
    else if (this.fallStart - this.feetY > 4.5) {
      this.onFall?.(Math.max(0, levelAtY(this.fallStart + 0.1)));
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
