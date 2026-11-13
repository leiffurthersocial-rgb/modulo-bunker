import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
world.createCollider(RAPIER.ColliderDesc.cuboid(1.6, 0.25, 1.9).setTranslation(0.4, -0.25, -2.1));
const body = world.createRigidBody(
  RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0.6, 0.87, -2.6),
);
const col = world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.3), body);
const kcc = world.createCharacterController(0.02);
kcc.setUp({ x: 0, y: 1, z: 0 });
kcc.enableAutostep(0.35, 0.25, false);
kcc.enableSnapToGround(0.35);
const variant = process.argv[2] ?? 'next';
let vy = 0;
for (let i = 0; i < 30; i++) {
  vy = vy - 22 * 0.016;
  kcc.computeColliderMovement(col, { x: 0, y: vy * 0.016, z: 0 });
  const m = kcc.computedMovement();
  const p = body.translation();
  if (variant === 'next') body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
  else body.setTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z }, true);
  world.step();
  if (kcc.computedGrounded()) vy = 0;
}
console.log(
  variant,
  'center y',
  body.translation().y.toFixed(3),
  'collider y',
  col.translation().y.toFixed(3),
);
