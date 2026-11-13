# 01 - Three.js practice and asset pipeline

Status: sourced. docs.blender.org is not reachable; Blender guidance comes from the glTF-Blender-IO repo only. Pages were opened with curl via the proxy helper (counts as opened). Items marked "(inference)" are our reasoning, not a source claim.

## 1. Instancing, BatchedMesh, LOD (three.js source)
### Key findings
- `new InstancedMesh(geometry, material, count)` allocates `instanceMatrix` = Float32Array(count*16), all identity. After `setMatrixAt(i, m)` set `instanceMatrix.needsUpdate = true`.
- `setColorAt` lazily creates `instanceColor`; `setMorphAt` stores weights in `morphTexture`.
- Bounding sphere is computed lazily on first need (raycast/cull); `computeBoundingBox()` is not automatic. Recompute after moving instances if relying on culling (gotcha: stale bounds can wrongly cull).
- `InstancedMesh.dispose()` frees instanceMatrix/instanceColor/morphTexture only.
- `BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount = maxVertexCount*2, material)`: one draw call, one material, many geometries. First geometry fixes attribute layout; later ones must match. Per-instance `visible`/`active`; `perObjectFrustumCulled` default true; `sortObjects` default true; `setCustomSort`.
- `LOD.addLevel(object, distance=0, hysteresis=0)`; hysteresis is a fraction of distance (anti-flicker); `autoUpdate` default true; distance divided by `camera.zoom`; no effect with fewer than 2 levels.
- Manual "Optimize Lots of Objects": merging geometry (`BufferGeometryUtils.mergeGeometries`) cuts draw calls; one merged mesh = one material, so per-part colour needs vertex colors (`vertexColors: true`). "Animated" page: animate merged data with morph targets, which require identical vertex counts across targets.
- Forum (topic 7080, "InstanceBufferGeometry Overhead"): a user with ~3000 draw calls at 30fps was told by Mugen87 to reduce draw calls first (CPU bound, lowering poly count will not help). Another poster: merged/instanced geometry loses per-object frustum culling; split into chunks (he uses an 8x8 grid), results vary, test per case.
### Decision for our project
- Conveyor items (2,000): one `InstancedMesh` per item type, write matrices only for moving items; disable frustum culling or set bounds to belt extents.
- Static room-kit pieces: InstancedMesh per piece type; chunk per floor (so a whole floor can be culled/hidden) rather than one giant instance set. BatchedMesh only if we need many distinct geometries under one material.
- Target budget: track `renderer.info.render.calls`; aim for low hundreds of draw calls (our target, not from a source).
- LOD with ~0.1 hysteresis for distant floors in Phase 4; none in Phase 1-3.

## 2. Disposal, render on demand, OffscreenCanvas
### Key findings
- Dispose manual: geometries (`BufferGeometry.dispose()`), materials, textures, render targets and `Skeleton.dispose()` each must be disposed explicitly; material dispose does NOT dispose textures. Removing a mesh from the scene does not dispose its geometry/material. ImageBitmap-sourced textures need `ImageBitmap.close()` by the app.
- The manual's own advice: for a multi-level game, dispose when switching levels by traversing the scene. Disposed resources are recreated if used again (cost: shader recompile hitch). Controls/renderers cannot be reused after dispose.
- `renderer.info` reports cached geometries/textures/programs; some internal ones remain after cleanup and are reused (not leaks).
- Forum topic 6534 (old, r102): disposed objects could still be held by renderer render lists; GC verification is tricky. Treat as historical.
- Rendering on demand: render only on change, use a `renderRequested` flag with `requestAnimationFrame` to avoid loops; needed with damped controls (call `controls.update()` in render).
- OffscreenCanvas: `canvas.transferControlToOffscreen()` + module Worker; workers have no DOM/mouse/keyboard, so sizes and input must be posted as messages. The manual says it was Chrome-only at the time of writing; check current Safari/iPad support at caniuse before relying on it.
- Discover three.js tips (page is dated, uses pre-r150 colour API; ignore those): avoid creating objects in the render loop (reuse Vector3 etc.); 1 unit = 1 meter; keep camera far plane small; limit pixel ratio to 2-3 on mobile; fewer draw calls = better; use LOD; bake lighting; instancing for hundreds/thousands of similar geometries; make shadow frustum and map small, update static shadow maps only on change; point light shadows render 6 times; power-of-two textures and smallest size possible; JPG and PNG of the same dimensions take the same GPU memory.
### Decision for our project
- Write `disposeTree(obj)` (geometry, material, each texture map, InstancedMesh, Skeleton) and call it on floor unload; check `renderer.info.memory` in a dev HUD.
- Share materials/geometries across cells (dispose only when the last user is gone).
- Continuous rAF loop with fixed-timestep simulation (conveyors always animate); an idle/pause screen can use render-on-demand.
- `setPixelRatio(Math.min(devicePixelRatio, 2))` for iPad. No OffscreenCanvas in Phases 1-3.
- Zero allocation in the frame loop: preallocated Matrix4/Vector3 scratch objects.
- Few real-time lights; baked lightmaps (UV2) in Phase 4; one directional shadow with a tight frustum.

## 3. three-mesh-bvh (README)
### Key findings
- Setup: assign `computeBoundsTree`/`disposeBoundsTree` to `BufferGeometry.prototype` and `acceleratedRaycast` to `Mesh.prototype.raycast`, then `geom.computeBoundsTree()`. Batched variants exist.
- `raycaster.firstHitOnly = true` uses the faster `raycastFirst`. README claim: 500 rays vs 80,000 polygons at 60fps.
- Direct queries `bvh.raycastFirst(ray)`, `bvh.intersectsSphere(sphere)`; transform into geometry local space first.
- Shapecast API on each BVH; README lists a player movement demo (`characterMovement.html`) and sphere physics demo, but no capsule code.
- BVH is static: no morph/skinned geometry (a newer `SkinnedMeshBVH` exists, API may change). Refit or rebuild after editing vertices.
- `GenerateMeshBVHWorker` (`three-mesh-bvh/worker`) builds off-thread; `ParallelMeshBVHWorker` needs SharedArrayBuffer.
### Decision
- BVH per static kit geometry (worker for big ones); shapecast capsule collision following characterMovement; `firstHitOnly` interaction rays.
- Not on skinned characters; use capsule/AABB proxies for the 5 characters.
- Greybox phases may use grid/AABB collision from the module cell grid.

## 4. glTF-Transform (gltf-transform.dev CLI page, v4.5.0)
### Key findings
- Install: `npm install --global @gltf-transform/cli` (Sharp used for images). One-shot: `gltf-transform optimize in.glb out.glb --compress draco --texture-compress webp`. `inspect` reports whether the scene is geometry-heavy, texture-heavy or has too many draw calls.
- Full command list includes: inspect, validate, copy, optimize, merge, partition, dedup, prune, gzip, center, **instance** ("Create GPU instances from shared mesh references", uses EXT_mesh_gpu_instancing), flatten, join (reduce draw calls), draco, meshopt (geometry and animation), quantize, weld, tangents, simplify, reorder, palette (palette textures, merge materials), resize, **etc1s**, **uastc**, ktxdecompress, ktxfix, avif, webp, png, jpeg, resample, sparse.
- KTX2 dependency: the CLI page does not name it. The glTF-Transform CHANGELOG (GitHub) says the CLI was upgraded to KTX-Software v4.3 and later added a `--mipmaps` flag and a `toktx()` function; so KTX-Software must be installed for `etc1s`/`uastc` (inference from the changelog; check `gltf-transform help etc1s`). Flags seen earlier: `--slots --level --rdo --rdo-lambda --zstd --quality`.
### Decision
- Build script: `dedup` -> `instance` (repeated kit pieces) -> `join`/`palette` where useful -> `meshopt` -> `resize` -> `etc1s`/`uastc` per slot. Check three.js loaders: meshopt needs MeshoptDecoder, instancing needs GLTFLoader's EXT_mesh_gpu_instancing support (verify).
- Install KTX-Software in CI and dev docs; pin the glTF-Transform version.
- Prefer meshopt over Draco (we also have animated characters; meshopt covers geometry and animation).

## 5. KTX2 / Basis (Khronos KTX Artist Guide, KTX-Software, KTX2Loader)
### Key findings
- ETC1S: smallest, for flat/monochrome, non-PBR/toon/UI textures; poor on complex ones. UASTC: higher quality for detailed colour, packed ORM and normal maps.
- Normal maps artifact-prone; use UASTC (or PNG). Use `--assign_oetf linear --assign_primaries none` for normal/ORM.
- GPU memory: KTX stays compressed on GPU; JPG/PNG decompress on upload. Example 13 MB disk (JPG+PNG) = 96 MB GPU vs 10 MB disk KTX = 21 MB GPU (~22%). Duck 512x512: 1.5 MB -> 277 KB.
- Mipmaps (`--genmipmap`); power-of-two, multiples of 4 for KHR_texture_basisu.
- toktx: ETC1S `--encode etc1s --clevel 4 --qlevel 255`; UASTC `--encode uastc --uastc_quality 4 --uastc_rdo_l .5 --zcmp 22`. KTX-Software now ships a unified `ktx` tool (`convert`, `encode`, `transcode`, `deflate`, `info`, `validate`).
- KTX2Loader: needs WebAssembly; `setTranscoderPath()` to `basis_transcoder.js/.wasm`; `detectSupport(renderer)` before load; `setWorkerLimit()`; `dispose()`. Priority UASTC: ASTC 4x4, BC7, ETC2, ETC1, BC1/3, PVRTC; ETC1S: ETC2, ETC1, BC7, BC1/3, PVRTC. PVRTC only power-of-two.
### Decision
- Albedo/emissive: ETC1S (sRGB). Normal and ORM: UASTC. 512/1024 power-of-two, mipmaps on.
- Host the transcoder in `public/basis/`; one shared KTX2Loader.
- Trim sheet/atlas for the kit to save memory across 160 cells.

## 6. Blender -> glTF (glTF-Blender-IO README only)
### Key findings
- The repo points to the Blender manual's glTF page (not reachable here). It mentions Blender 5.0 current stable, 4.5 LTS; CI validates exports with the Khronos glTF Validator.
- Not verified from a source: modular-kit naming, custom properties, UV2 lightmap handling.
### Decision
- Pin Blender 4.5 LTS; run glTF Validator in CI.
- Convention to confirm in Phase 4: meters, origin at cell corner, names like `kit_wall_A`, gameplay data as custom properties (exported as extras), UV2 for baked light.

## Sources opened
- https://threejs.org/manual/pages/how-to-dispose-of-objects.html - dispose rules, FAQ.
- https://threejs.org/manual/pages/optimize-lots-of-objects.html - merging geometry, vertex colors.
- https://threejs.org/manual/pages/optimize-lots-of-objects-animated.html - morph targets for animated merged data.
- https://threejs.org/manual/pages/rendering-on-demand.html - on-demand loop pattern.
- https://threejs.org/manual/pages/offscreencanvas.html - worker rendering, DOM limits.
- https://discoverthreejs.com/tips-and-tricks/ - tips list (partly dated API).
- https://gltf-transform.dev/cli - full CLI command list, v4.5.0.
- https://gltf-transform.dev/functions - function list incl. instance, join, palette.
- https://raw.githubusercontent.com/donmccurdy/glTF-Transform/main/CHANGELOG.md - KTX-Software v4.3, toktx().
- https://discourse.threejs.org/t/7080.json - InstanceBufferGeometry overhead thread.
- https://discourse.threejs.org/t/6534.json - dispose thread (old).
- https://github.com/gkjohnson/three-mesh-bvh and https://raw.githubusercontent.com/gkjohnson/three-mesh-bvh/master/README.md - BVH.
- https://github.com/mrdoob/three.js/blob/dev/src/objects/InstancedMesh.js, .../BatchedMesh.js, .../LOD.js, .../examples/jsm/loaders/KTX2Loader.js
- https://raw.githubusercontent.com/mrdoob/three.js/dev/docs/pages/KTX2Loader.html.md
- https://github.com/donmccurdy/glTF-Transform and https://raw.githubusercontent.com/donmccurdy/glTF-Transform/main/packages/cli/README.md
- https://github.com/KhronosGroup/KTX-Software; https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md
- https://github.com/KhronosGroup/glTF-Blender-IO

## Failed fetches
- docs.blender.org (host not allowed).
- WebFetch on threejs.org, discoverthreejs.com, gltf-transform.dev (stale DNS; replaced by curl helper).
- raw.githubusercontent.com three.js manual paths (404, wrong path).
- Not found: a forum "100 tips" or game-architecture thread (search returned unrelated results), so only 2 forum threads cited.
