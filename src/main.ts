// Hello-world scene proving the toolchain (Vite + TS + Three.js + WebGL2 + Vercel).
import * as THREE from 'three';
import { Rng } from './gen/rng';

const seed = new URLSearchParams(location.search).get('seed') ?? 'hello';
const rng = Rng.stream(seed, 'hello');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1c1e);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 1.7, 6);

scene.add(new THREE.HemisphereLight(0xbfd4e6, 0x302820, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 6, 4);
scene.add(sun);

// Greybox: one 6 x 3.5 x 8 m module cell with a few seeded blocks.
const cell = new THREE.Mesh(
  new THREE.BoxGeometry(6, 3.5, 8),
  new THREE.MeshStandardMaterial({ color: 0x8a8f94, side: THREE.BackSide }),
);
cell.position.y = 1.75;
scene.add(cell);
const blocks: THREE.Mesh[] = [];
for (let i = 0; i < 5; i++) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rng.next(), 0.5, 0.5) }),
  );
  m.position.set(-2 + i, 0.4 + rng.next() * 1.5, -1);
  scene.add(m);
  blocks.push(m);
}

const hud = document.getElementById('hud');
const gl = renderer.getContext();
const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
(window as unknown as { __webgl2: boolean }).__webgl2 = isWebGL2;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop((t) => {
  blocks.forEach((b, i) => (b.rotation.y = t * 0.001 * (i + 1) * 0.3));
  if (hud) hud.textContent = `Modulo: Bunker | hello world | seed=${seed} | WebGL2=${isWebGL2}`;
  renderer.render(scene, camera);
});
