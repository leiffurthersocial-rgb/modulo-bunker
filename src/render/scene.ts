import * as THREE from 'three';

/** Renderer + scene + lights. Pixel ratio capped (iPad memory/fill-rate). */
export class SceneRig {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  pixelRatioCap = 2;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.pixelRatioCap));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#0d0f11');
    this.scene.fog = new THREE.Fog('#0d0f11', 30, 90);
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 250);
    this.scene.add(new THREE.HemisphereLight('#cfd8e0', '#2a2620', 1.6));
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.35));
    const key = new THREE.DirectionalLight('#ffffff', 0.6);
    key.position.set(5, 10, 12);
    this.scene.add(key);
    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.pixelRatioCap));
    this.renderer.setSize(innerWidth, innerHeight);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
