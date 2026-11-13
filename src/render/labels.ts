import * as THREE from 'three';

export interface LabelLine {
  text: string;
  color?: string;
  size?: number;
}

/**
 * Canvas-texture sprite label (greybox floating text). World height ~`height` metres.
 * Uses depthTest so labels hide behind walls.
 */
export function makeLabel(lines: LabelLine[], height = 0.9, bg = 'rgba(10,12,14,0.72)'): THREE.Sprite {
  const pad = 14;
  const base = 44;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fonts = lines.map((l) => `600 ${Math.round(base * (l.size ?? 1))}px ui-monospace, Menlo, monospace`);
  let w = 0;
  let h = pad;
  lines.forEach((l, i) => {
    ctx.font = fonts[i]!;
    w = Math.max(w, ctx.measureText(l.text).width);
    h += base * (l.size ?? 1) * 1.15;
  });
  h += pad - base * 0.15;
  canvas.width = Math.ceil(w + pad * 2);
  canvas.height = Math.ceil(h);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 14);
  ctx.fill();
  let y = pad;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    ctx.font = fonts[i]!;
    ctx.fillStyle = l.color ?? '#e8e8e8';
    ctx.fillText(l.text, pad, y);
    y += base * (l.size ?? 1) * 1.15;
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  const hh = height * (canvas.height / (base * 1.15 * lines.length + pad * 2));
  sprite.scale.set(hh * aspect, hh, 1);
  sprite.renderOrder = 10;
  return sprite;
}
