// Probes headless Chromium for WebGL2 support under several flag sets.
// Usage: node scripts/check-webgl.mjs
import { chromium } from 'playwright';

const flagSets = {
  default: [],
  'angle-swiftshader': ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  'gl-angle-swiftshader': [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
};
for (const [name, args] of Object.entries(flagSets)) {
  const browser = await chromium.launch({ args });
  const page = await browser.newPage();
  const info = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: true,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      webgpu: 'gpu' in navigator,
    };
  });
  console.log(name, JSON.stringify(info));
  await browser.close();
}
