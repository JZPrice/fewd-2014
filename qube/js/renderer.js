import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { characterById } from "./characters.js?v=146";
import { GRID_W, GRID_D, MAX_GRID_W, MAX_GRID_D, TILE, GROUT_INSET, COLORS, CUBE_TYPE, PLAYER_SLIDE_MS, CAM_HALFLIFE_MS } from "./config.js?v=146";

// Cheap value-noise + fbm. Shared by the Lambert noise patch and the
// forbidden-cube lava shader. ~32 hash calls per fragment at 4 octaves;
// fine for the cube count we ever render.
const NOISE_GLSL = `
  float n_hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(n_hash(i + vec3(0,0,0)), n_hash(i + vec3(1,0,0)), f.x),
          mix(n_hash(i + vec3(0,1,0)), n_hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(n_hash(i + vec3(0,0,1)), n_hash(i + vec3(1,0,1)), f.x),
          mix(n_hash(i + vec3(0,1,1)), n_hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
`;

// Patch a MeshLambertMaterial so its diffuse is modulated by procedural
// noise. World-space noise flows seamlessly across the floor / platform;
// local-space noise stays locked to a rolling cube's geometry.
function patchLambertNoise(mat, { scale = 1.4, strength = 0.22, space = "world" } = {}) {
  const useLocal = space === "local";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n  varying vec3 vNoisePos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        ${useLocal
          ? `vNoisePos = position;`
          : `#ifdef USE_INSTANCING
               vNoisePos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
             #else
               vNoisePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
             #endif`}`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vNoisePos;
        ${NOISE_GLSL}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          float n = clamp(fbm3(vNoisePos * ${scale.toFixed(3)}), 0.0, 1.0);
          float mod_ = (1.0 - ${(strength * 0.5).toFixed(3)}) + ${strength.toFixed(3)} * n;
          diffuseColor.rgb *= mod_;
        }`
      );
  };
  mat.customProgramCacheKey = () => `noise|${scale}|${strength}|${space}`;
  mat.needsUpdate = true;
}

// Scratch/scuff patch for forbidden/advantage cubes. High-frequency
// stripe set with per-region noise-driven phase offsets gives thin
// hand-scratched lines instead of regular grooves; a noise gate then
// turns them off across large regions so the marks are sparse and
// random, not gridded. Lambert lighting + the gradient-based edge
// term fake a bump-map feel without an actual normal map.
function patchScratches(mat, opts = {}) {
  const scale = (opts.scale ?? 18.0).toFixed(3);
  const threshold = (opts.threshold ?? 0.965).toFixed(3);
  const darken = (opts.darken ?? 0.5).toFixed(3);
  const lift = opts.lift ?? [0, 0, 0];
  const lr = lift[0].toFixed(3);
  const lg = lift[1].toFixed(3);
  const lb = lift[2].toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n  varying vec3 vScratchPos;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n  vScratchPos = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n  varying vec3 vScratchPos;\n${NOISE_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
          {
            vec3 p = vScratchPos * ${scale};
            // Per-region phase shifts (driven by low-freq noise) make the
            // stripes wobble + read as hand-cut, not perfectly periodic.
            float seed = fbm3(p * 0.16);
            float a = abs(sin(p.x + p.y * 0.4 + seed * 7.3));
            float b = abs(sin(p.y - p.z * 0.6 + seed * 11.1));
            float c = abs(sin(p.z + p.x * 0.3 + seed * 5.7));
            float d = abs(sin((p.x - p.y * 0.7) + p.z * 0.5 + seed * 9.4));
            float lines = max(max(a, b), max(c, d));
            // Narrow threshold = pixel-thin scratches.
            float scratch = step(${threshold}, lines);
            // Sparsity gate so the surface isn't uniformly scratched.
            float gate = step(0.42, fbm3(p * 0.55 + vec3(13.0, 7.0, 3.0)));
            scratch *= gate;
            // Subtle diffuse jitter so the base isn't a flat plate.
            diffuseColor.rgb *= 0.92 + 0.08 * fbm3(p * 0.35);
            diffuseColor.rgb *= 1.0 - ${darken} * scratch;
            diffuseColor.rgb += vec3(${lr}, ${lg}, ${lb}) * scratch;
          }`,
      );
  };
  mat.customProgramCacheKey = () => `scratches|${scale}|${threshold}|${darken}|${lr}|${lg}|${lb}`;
  mat.needsUpdate = true;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.ground);
    this.scene.fog = new THREE.Fog(COLORS.ground, 15, 55);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Current stage's grid dimensions. The renderer pre-allocates floor and
    // underbody instances for the MAX dims, then setStageDimensions hides
    // tiles outside the active stage's actual gridW / gridD.
    this._stageW = GRID_W;
    this._stageD = GRID_D;

    this._lookZ = -(GRID_D - 1) / 2;
    this._baseCamY = 5.8;
    this._baseCamZ = 5.8;
    this._followDZ = 6.0;
    this._lookY = -3.5;
    // Two framing presets. The default per-aspect values come from
    // onResize; the "tight" preset is hand-tuned for moments when the
    // player is right up against the active wave. _tightBlend is eased
    // between 0 and _tightBlendTarget each frame.
    this._defaultFov = 58;
    this._defaultCamY = 5.8;
    this._defaultFollowDZ = 6.0;
    this._defaultLookY = -3.5;
    this._tightFov = 39;
    this._tightCamY = 1.80;
    this._tightFollowDZ = 7.80;
    this._tightLookY = -1.70;
    this._tightBlend = 0;
    this._tightBlendTarget = 0;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    this.camera.position.set(0, this._baseCamY, this._baseCamZ);
    this.camera.lookAt(0, this._lookY, this._lookZ);

    // Inset factor shared by floor tiles, cubes, and underbody columns -
    // see GROUT_INSET in config. Held as an instance field so the debug
    // panel can retune it at runtime via setGroutInset.
    this.groutInset = GROUT_INSET;

    this._buildLights();
    this._buildPlatformBody();
    this._buildFloor();
    this._buildPlayer();
    this._buildMark();
    this._buildBombs();
    this._preloadMobs(["skeleton"]);
    this._buildMarkGhost();

    this.cubeMeshes = new Map();
    this._cubeGeom = new THREE.BoxGeometry(TILE * this.groutInset, TILE * this.groutInset, TILE * this.groutInset);
    // White edge outline shared by every cube mesh. EdgesGeometry only
    // emits lines where adjacent faces are non-coplanar -> the 12 box edges.
    this._cubeEdgesGeom = new THREE.EdgesGeometry(this._cubeGeom);
    this._cubeEdgesMat = new THREE.LineBasicMaterial({ color: 0x202028 });

    // White marble cube bodies. The noise patch adds subtle gray veining
    // for the marble look. Type is conveyed by a faint emissive accent
    // (forbidden = red glow, advantage = green glow) so the player can
    // still tell them apart at a glance against the white.
    const marbleWhite = 0xf2efe6;
    this._normalMat = new THREE.MeshLambertMaterial({ color: marbleWhite });
    patchLambertNoise(this._normalMat, { scale: 2.2, strength: 0.18, space: "world" });

    this._advantageMat = new THREE.MeshLambertMaterial({
      color: marbleWhite,
      emissive: 0x2ad04a,
      emissiveIntensity: 0.30,
    });
    patchLambertNoise(this._advantageMat, { scale: 2.2, strength: 0.18, space: "world" });

    this._forbiddenMat = new THREE.MeshLambertMaterial({
      color: marbleWhite,
      emissive: 0xd22a2a,
      emissiveIntensity: 0.28,
    });
    patchLambertNoise(this._forbiddenMat, { scale: 2.2, strength: 0.18, space: "world" });
    this._installEnvironment();
    this._buildAbyssBackground();
    this._buildPlayerTrail();

    // Critically-damped spring state for the follow camera. Position is
    // tracked separately from velocity so the spring is stable for any dt.
    this._camPosX = 0; this._camVelX = 0;
    this._camPosZ = 0; this._camVelZ = 0;
    this._lookPosX = 0; this._lookVelX = 0;
    this._lookPosZ = this._lookZ; this._lookVelZ = 0;
    this.followHalflife = CAM_HALFLIFE_MS;

    // Impact-shake state.
    this._shakeT0 = 0;
    this._shakeEnd = 0;
    this._shakeAmp = 0;
    this._lastShake = null;

    // Hide MAX-allocated tiles that aren't part of the default stage so the
    // title screen shows a clean 4-wide platform, not the 6-wide max.
    this.setStageDimensions(GRID_W, GRID_D);

    this.onResize();
    window.addEventListener("resize", () => this.onResize());
  }

  // Implicit critically-damped spring. Frame-rate independent, no overshoot.
  // halflifeMs = time for the distance to halve.
  static _springStep(curPos, curVel, targetPos, dt, halflifeMs) {
    const omega = 693.1472 / Math.max(1, halflifeMs);  // ln(2)*1000 / halflife
    const f    = 1 + 2 * omega * dt;
    const oo   = omega * omega;
    const hoo  = dt * oo;
    const hhoo = dt * hoo;
    const inv  = 1 / (f + hhoo);
    return [
      (f * curPos + dt * curVel + hhoo * targetPos) * inv,
      (curVel + hoo * (targetPos - curPos)) * inv,
    ];
  }

  // Trigger a damped jitter on the camera. If a stronger shake is already
  // in flight, the new request is ignored so big events aren't overridden
  // by trailing small ones.
  // Resize the grout inset at runtime: regenerates the three geometry
  // pools (cubes, floor tiles, underbody columns) and re-assigns them
  // to every existing mesh. The old geometries are disposed.
  setGroutInset(v) {
    v = Math.max(0.85, Math.min(1.0, v));
    if (Math.abs(v - this.groutInset) < 0.0005) return;
    this.groutInset = v;
    const size = TILE * v;
    const oldCube = this._cubeGeom;
    this._cubeGeom = new THREE.BoxGeometry(size, size, size);
    for (const entry of this.cubeMeshes.values()) {
      entry.mesh.geometry = this._cubeGeom;
    }
    if (oldCube) oldCube.dispose();
    const oldFloor = this._floorGeom;
    this._floorGeom = new THREE.BoxGeometry(size, size, size);
    if (this.floorMeshes) {
      for (let x = 0; x < this.floorMeshes.length; x++) {
        const col = this.floorMeshes[x];
        if (!col) continue;
        for (let z = 0; z < col.length; z++) {
          if (col[z]) col[z].geometry = this._floorGeom;
        }
      }
    }
    if (oldFloor) oldFloor.dispose();
    const oldUnder = this._underbodyGeom;
    this._underbodyGeom = new THREE.BoxGeometry(size, size, size);
    if (this._underbodyMeshes) {
      for (const m of this._underbodyMeshes) m.geometry = this._underbodyGeom;
    }
    if (oldUnder) oldUnder.dispose();
  }

  shake(amp, durMs) {
    const now = performance.now();
    if (now < this._shakeEnd && this._shakeAmp > amp) return;
    this._shakeT0 = now;
    this._shakeEnd = now + durMs;
    this._shakeAmp = amp;
    this._lastShake = { amp, durMs, at: now };
  }

  // Snap the follow camera state to the player. Use at stage start / death
  // so the camera doesn't lerp across the playfield on respawn.
  resetFollow(player) {
    const target = this._toWorld(player.gx, player.gz);
    this._camPosX = target.x;  this._camVelX = 0;
    this._camPosZ = target.z;  this._camVelZ = 0;
    this._lookPosX = target.x; this._lookVelX = 0;
    this._lookPosZ = target.z - 1.5; this._lookVelZ = 0;
  }

  // World position for a grid coordinate using the current stage's width
  // for centering. Wider stages push the leftmost column further left.
  _toWorld(gx, gz) {
    return {
      x: (gx - (this._stageW - 1) / 2) * TILE,
      z: -gz * TILE,
    };
  }

  // Re-center the floor/underbody for a new stage. Tiles outside the new
  // bounds are hidden; tiles inside are repositioned (their X center depends
  // on the stage's width) and snapped back to rest. Call before grid.reset()
  // / player.reset() on stage transition.
  setStageDimensions(w, d) {
    this._stageW = w;
    this._stageD = d;
    this._lookZ = -(d - 1) / 2;

    // Floor tiles.
    for (let x = 0; x < MAX_GRID_W; x++) {
      for (let z = 0; z < MAX_GRID_D; z++) {
        const m = this.floorMeshes[x][z];
        if (x < w && z < d) {
          const p = this._toWorld(x, z);
          m.position.set(p.x, m.userData.restY, p.z);
          m.rotation.set(0, 0, 0);
          m.userData.targetY = m.userData.restY;
          m.userData.vy = 0;
          m.userData.dropping = false;
          m.userData.dropDelay = 0;
          m.userData.fallNotified = false;
          m.visible = true;
        } else {
          m.visible = false;
        }
      }
    }

    // Underbody columns.
    for (let x = 0; x < MAX_GRID_W; x++) {
      for (let z = 0; z < MAX_GRID_D; z++) {
        const col = this._underbodyDrop[x][z];
        col.y = 0; col.vy = 0; col.dropping = false; col.dropDelay = 0; col.hidden = false;
        if (x < w && z < d) {
          for (let layer = 0; layer < this._underbodyLayers; layer++) {
            this._setUnderbodyInstance(x, z, layer, 0);
          }
        } else {
          this._hideUnderbodyColumn(x, z);
          col.hidden = true;
        }
      }
    }
    for (let layer = 0; layer < this._underbodyLayers; layer++) {
      this._underbodyMeshes[layer].instanceMatrix.needsUpdate = true;
    }
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(COLORS.sky, COLORS.ground, 0.55);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 8, 4);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -8;
    dir.shadow.camera.right = 8;
    dir.shadow.camera.top = 6;
    dir.shadow.camera.bottom = -20;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 36;
    this.scene.add(dir);
  }

  _buildPlatformBody() {
    // One InstancedMesh per Y-layer, each with MAX_GRID_W*MAX_GRID_D instances.
    // We split because iOS Safari appears to silently truncate large single-
    // mesh instance buffers, dropping the deeper instances of a 1700+ mesh.
    // Per layer the instance index is x * MAX_GRID_D + z, so a single
    // column maps to that same instance index across all
    // `_underbodyMeshes[layer]` meshes. Tiles outside the current stage's
    // gridW/gridD are hidden by setStageDimensions.
    const LAYERS = 7;
    const PER_LAYER = MAX_GRID_W * MAX_GRID_D;
    this._underbodyGeom = new THREE.BoxGeometry(TILE * this.groutInset, TILE * this.groutInset, TILE * this.groutInset);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.floor });
    patchLambertNoise(mat, { scale: 1.8, strength: 0.30, space: "world" });

    this._underbodyMeshes = [];
    this._underbodyLayers = LAYERS;
    const dummy = new THREE.Object3D();
    for (let layer = 0; layer < LAYERS; layer++) {
      const y = -TILE / 2 - (layer + 1) * TILE;
      const inst = new THREE.InstancedMesh(this._underbodyGeom, mat, PER_LAYER);
      inst.castShadow = false;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      for (let x = 0; x < MAX_GRID_W; x++) {
        for (let z = 0; z < MAX_GRID_D; z++) {
          const p = this._toWorld(x, z);
          dummy.position.set(p.x, y, p.z);
          dummy.updateMatrix();
          inst.setMatrixAt(x * MAX_GRID_D + z, dummy.matrix);
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
      this._underbodyMeshes.push(inst);
    }
    this._underbodyDummy = dummy;

    // Per-column drop state. y is the current Y offset from rest (0 = at
    // rest, negative while falling). dropDelay staggers the front row
    // so it topples L->R rather than dropping as a slab.
    this._underbodyDrop = [];
    for (let x = 0; x < MAX_GRID_W; x++) {
      this._underbodyDrop[x] = [];
      for (let z = 0; z < MAX_GRID_D; z++) {
        this._underbodyDrop[x][z] = { y: 0, vy: 0, dropping: false, dropDelay: 0, hidden: false };
      }
    }
  }

  // Move the (x, z) column's instance in `layer` to its rest position +
  // a vertical slide offset. Called per-layer during column drop animation.
  _setUnderbodyInstance(x, z, layer, ySlide) {
    const baseY = -TILE / 2 - (layer + 1) * TILE;
    const p = this._toWorld(x, z);
    const d = this._underbodyDummy;
    d.position.set(p.x, baseY + ySlide, p.z);
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    this._underbodyMeshes[layer].setMatrixAt(x * MAX_GRID_D + z, d.matrix);
  }

  _hideUnderbodyColumn(x, z) {
    const d = this._underbodyDummy;
    d.scale.set(0, 0, 0);
    d.position.set(0, -1000, 0);
    d.rotation.set(0, 0, 0);
    d.updateMatrix();
    const idx = x * MAX_GRID_D + z;
    for (let layer = 0; layer < this._underbodyLayers; layer++) {
      this._underbodyMeshes[layer].setMatrixAt(idx, d.matrix);
    }
  }

  // Procedural neutral-room IBL so polished surfaces (onyx forbidden cubes)
  // pick up subtle blurred reflections in addition to direct lighting.
  _installEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = env.texture;
    pmrem.dispose();
  }

  // A wide animated lava plane far below the platform. Visible past the
  // platform edges and through any holes punched by the front-row drop, so
  // dropping a row literally drops you toward the molten floor.
  // Bottomless abyss + rising motes. A glowing green-goo lava plane far
  // below the platform, with motes drifting upward through the void
  // and fading off as they near the platform's level.
  _buildAbyssBackground() {
    this._buildGooLava();

    // Rising motes.
    const COUNT = 360;
    const positions = new Float32Array(COUNT * 3);
    const speeds = new Float32Array(COUNT);
    const seeds = new Float32Array(COUNT);
    const Y_BOTTOM = -8;
    const Y_TOP = 5;
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Y_BOTTOM + Math.random() * (Y_TOP - Y_BOTTOM);
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      speeds[i] = 0.25 + Math.random() * 0.7;
      seeds[i] = Math.random();
    }
    this._abyssParticleData = {
      positions, speeds, seeds, count: COUNT, yBottom: Y_BOTTOM, yTop: Y_TOP,
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("seed",     new THREE.BufferAttribute(seeds, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSize:   { value: 60.0 },
        uTime:   { value: 0 },
      },
      vertexShader: `
        attribute float seed;
        varying float vY;
        varying float vSeed;
        uniform float uSize;
        uniform float uTime;
        void main() {
          vY = position.y;
          vSeed = seed;
          // Tiny lateral drift so they don't rise in straight columns.
          vec3 pos = position;
          pos.x += sin(uTime * 0.35 + seed * 6.28) * 0.25;
          pos.z += cos(uTime * 0.28 + seed * 6.28) * 0.25;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = uSize * (0.6 + seed * 0.7) / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vY;
        varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float soft = 1.0 - smoothstep(0.05, 0.5, d);
          // Peak alpha mid-height, faint at extremes - feels like motes
          // catching light only briefly as they pass through.
          float h = (vY + 8.0) / 13.0;
          float curve = smoothstep(0.0, 0.25, h) * (1.0 - smoothstep(0.7, 1.0, h));
          // Cool blue-white tint with a touch of warm variance per mote,
          // shifting green near the goo at the bottom.
          vec3 col = mix(vec3(0.55, 0.72, 0.95), vec3(0.85, 0.90, 1.0), vSeed);
          col = mix(vec3(0.45, 0.95, 0.45), col, smoothstep(0.0, 0.4, h));
          gl_FragColor = vec4(col, soft * curve * 0.80);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._abyssParticles = new THREE.Points(geo, mat);
    this.scene.add(this._abyssParticles);

    this._buildGhosts();
    this._buildFireballs();
  }

  // Green-goo lava plane far below the platform. A noise-displaced surface
  // tinted between dark green and bright glow-green; the brightest spots
  // pulse over time so the goo feels alive. Replaces the previous flat
  // dark floor.
  _buildGooLava() {
    const geo = new THREE.PlaneGeometry(110, 110, 80, 80);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        uniform float uTime;
        varying vec3 vPos;
        // Coarse value noise for the 3D surface displacement only -
        // color detail is done in the fragment with proper Perlin fBm.
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        void main() {
          vec3 pos = position;
          float n = vnoise(pos.xy * 0.45 + vec2(uTime * 0.15, uTime * 0.10));
          n += 0.5 * vnoise(pos.xy * 0.95 + vec2(-uTime * 0.20, uTime * 0.13));
          n /= 1.5;
          pos.z += (n - 0.5) * 0.45;
          vPos = pos;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vPos;

        // Fast non-sin hash (Dave Hoskins / IQ style). Cheaper than the
        // sin-based hashes for use inside the fBm loop.
        vec2 hash22(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
        }
        // 2D Perlin gradient noise -> [0, 1].
        float perlin(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0));
          float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
          float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
          float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
          float ab = mix(a, b, u.x);
          float cd = mix(c, d, u.x);
          return mix(ab, cd, u.y) * 0.5 + 0.5;
        }
        // 4-octave fBm gives the fine bubble grain.
        float fbm(vec2 p) {
          float v = 0.0;
          float amp = 0.55;
          for (int i = 0; i < 4; i++) {
            v += perlin(p) * amp;
            p *= 2.03;
            amp *= 0.5;
          }
          return v;
        }
        void main() {
          // Higher base frequency + multi-octave fBm = much finer grain
          // than the single-octave value noise we had before.
          vec2 q = vPos.xy * 1.6 + vec2(uTime * 0.11, uTime * 0.08);
          float n = fbm(q);

          // Mostly black void. Bubbles emerge only at noise peaks; they
          // bloom in and recede on their own pulse phases.
          vec3 voidCol = vec3(0.01, 0.015, 0.02);
          vec3 hot     = vec3(0.55, 1.00, 0.40);
          vec3 hotCore = vec3(0.85, 1.00, 0.70);

          // Rare, dim bubbles - we just want hints of green, not a glow.
          float bubble = smoothstep(0.66, 0.80, n);
          float pulse = 0.20 + 0.55 * sin(uTime * 0.9
                          + vPos.x * 0.55 + vPos.y * 0.45);
          pulse = max(0.0, pulse);
          float intensity = bubble * pulse * 0.55;

          vec3 col = voidCol + hot * intensity;
          col += hotCore * smoothstep(0.86, 0.95, n) * pulse * 0.45;

          // Distance fade so the bubbles surface out of the dark.
          float dist = length(vPos.xy);
          float fade = 1.0 - smoothstep(10.0, 30.0, dist);
          col = mix(voidCol, col, fade);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -9;
    this._gooLava = mesh;
    this._gooLavaMat = mat;
    this.scene.add(mesh);
  }

  // Cartoon ghost sprites drifting in slow elliptical orbits around the
  // platform. White round body with two eye dots. Billboards via Points,
  // additive blending for an ethereal glow.
  _buildGhosts() {
    const COUNT = 14;
    const positions = new Float32Array(COUNT * 3);
    const orbits = [];
    for (let i = 0; i < COUNT; i++) {
      const radius = 10 + Math.random() * 16;
      const angle = Math.random() * Math.PI * 2;
      const yBase = -3 - Math.random() * 4;
      orbits.push({
        radius,
        angle,
        speed: (Math.random() < 0.5 ? 1 : -1) * (0.12 + Math.random() * 0.22),
        yBase,
        yAmp: 0.6 + Math.random() * 1.0,
        ySpd: 0.4 + Math.random() * 0.7,
        yPhase: Math.random() * Math.PI * 2,
      });
      positions[i * 3]     = Math.cos(angle) * radius;
      positions[i * 3 + 1] = yBase;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 220.0 } },
      vertexShader: `
        uniform float uSize;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        void main() {
          vec2 uv = gl_PointCoord;
          // Round top of the ghost (centered higher to leave room for skirt)
          vec2 c = uv - vec2(0.5, 0.40);
          float top = length(c);
          float head = 1.0 - smoothstep(0.22, 0.36, top);
          // Wavy bottom skirt
          float skirtTop = 0.45;
          float skirtBottom = 0.78 + 0.06 * sin(uv.x * 24.0);
          float inSkirt = step(abs(uv.x - 0.5), 0.28) * step(uv.y, skirtBottom) * step(skirtTop, uv.y);
          float body = max(head, inSkirt);
          // Eyes
          float eL = step(length(uv - vec2(0.40, 0.42)), 0.045);
          float eR = step(length(uv - vec2(0.60, 0.42)), 0.045);
          float eyes = max(eL, eR);
          vec3 col = mix(vec3(0.85, 0.92, 1.0), vec3(0.05, 0.05, 0.12), eyes);
          float alpha = body * 0.45 - eyes * 0.45;
          if (alpha <= 0.0) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._ghosts = new THREE.Points(geo, mat);
    this._ghostData = orbits;
    this.scene.add(this._ghosts);
  }

  // Orange fireball sprites bobbing around in the abyss. Bright hot core
  // with a softer halo, additive-blended so they glow against the goo.
  _buildFireballs() {
    const COUNT = 9;
    const positions = new Float32Array(COUNT * 3);
    const orbits = [];
    for (let i = 0; i < COUNT; i++) {
      const radius = 7 + Math.random() * 13;
      const angle = Math.random() * Math.PI * 2;
      const yBase = -1 - Math.random() * 5;
      orbits.push({
        radius,
        angle,
        speed: (Math.random() < 0.5 ? 1 : -1) * (0.18 + Math.random() * 0.30),
        yBase,
        yAmp: 0.35 + Math.random() * 0.55,
        ySpd: 0.8 + Math.random() * 1.0,
        yPhase: Math.random() * Math.PI * 2,
        size: 90 + Math.random() * 60,
      });
      positions[i * 3]     = Math.cos(angle) * radius;
      positions[i * 3 + 1] = yBase;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const sizes = new Float32Array(orbits.map(o => o.size));
    const seeds = new Float32Array(orbits.map(() => Math.random()));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize",    new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aSeed",    new THREE.BufferAttribute(seeds, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aSize;
        attribute float aSeed;
        varying float vSeed;
        uniform float uTime;
        void main() {
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float flick = 0.85 + 0.15 * sin(uTime * 6.0 + aSeed * 6.28);
          gl_PointSize = aSize * flick / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float core = 1.0 - smoothstep(0.0, 0.16, d);
          float glow = 1.0 - smoothstep(0.16, 0.50, d);
          vec3 yellow = vec3(1.0, 0.95, 0.55);
          vec3 orange = vec3(1.0, 0.55, 0.10);
          vec3 col = mix(orange, yellow, core);
          float alpha = max(core, glow * 0.55);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._fireballs = new THREE.Points(geo, mat);
    this._fireballData = orbits;
    this._fireballMat = mat;
    this.scene.add(this._fireballs);
  }

  _animateGhosts(dt) {
    if (!this._ghosts) return;
    const pos = this._ghosts.geometry.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < this._ghostData.length; i++) {
      const d = this._ghostData[i];
      d.angle += d.speed * dt;
      d.yPhase += d.ySpd * dt;
      arr[i * 3]     = Math.cos(d.angle) * d.radius;
      arr[i * 3 + 1] = d.yBase + Math.sin(d.yPhase) * d.yAmp;
      arr[i * 3 + 2] = Math.sin(d.angle) * d.radius;
    }
    pos.needsUpdate = true;
  }

  _animateFireballs(dt) {
    if (!this._fireballs) return;
    const pos = this._fireballs.geometry.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < this._fireballData.length; i++) {
      const d = this._fireballData[i];
      d.angle += d.speed * dt;
      d.yPhase += d.ySpd * dt;
      arr[i * 3]     = Math.cos(d.angle) * d.radius;
      arr[i * 3 + 1] = d.yBase + Math.sin(d.yPhase) * d.yAmp;
      arr[i * 3 + 2] = Math.sin(d.angle) * d.radius;
    }
    pos.needsUpdate = true;
    if (this._fireballMat) this._fireballMat.uniforms.uTime.value += dt;
  }

  _animateGoo(dt) {
    if (this._gooLavaMat) this._gooLavaMat.uniforms.uTime.value += dt;
  }

  // Sparkle trail behind the player. Each frame that the player moved more
  // than a threshold, drop a particle at their previous foot position.
  // Particles rise slightly and fade out over ~900ms.
  _buildPlayerTrail() {
    const COUNT = 80;
    const positions = new Float32Array(COUNT * 3);
    const ages = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 1] = -100; // off-screen until spawned
      ages[i] = -1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aAge",     new THREE.BufferAttribute(ages, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 65.0 } },
      vertexShader: `
        attribute float aAge;
        varying float vAge;
        uniform float uSize;
        void main() {
          vAge = aAge;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float life = 0.9;
          float k = clamp(aAge / life, 0.0, 1.0);
          float sz = (1.0 - k * 0.7);
          gl_PointSize = uSize * sz / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAge;
        void main() {
          if (vAge < 0.0) discard;
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float life = 0.9;
          float k = clamp(vAge / life, 0.0, 1.0);
          float soft = 1.0 - smoothstep(0.0, 0.5, d);
          vec3 hot  = vec3(1.0, 0.95, 0.55);
          vec3 cool = vec3(0.65, 0.85, 1.0);
          vec3 col = mix(hot, cool, k);
          float alpha = soft * (1.0 - k) * 0.85;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._trail = new THREE.Points(geo, mat);
    this._trail.frustumCulled = false;
    this._trailData = {
      positions, ages, count: COUNT, nextEmit: 0,
      lastX: 0, lastZ: 0, lastSet: false,
      emitTimer: 0,
    };
    this.scene.add(this._trail);
  }

  _animatePlayerTrail(dt) {
    if (!this._trail) return;
    const data = this._trailData;
    const px = this.playerMesh.position.x;
    const pz = this.playerMesh.position.z;
    // Distance moved since last frame; if non-trivial, emit a particle
    // (rate-limited so a fast slide doesn't carpet the floor).
    data.emitTimer -= dt;
    if (data.lastSet) {
      const dx = px - data.lastX;
      const dz = pz - data.lastZ;
      const moved = Math.hypot(dx, dz);
      if (moved > 0.02 && data.emitTimer <= 0) {
        const idx = data.nextEmit;
        data.positions[idx * 3]     = px - dx * 0.4 + (Math.random() - 0.5) * 0.18;
        data.positions[idx * 3 + 1] = 0.10 + Math.random() * 0.08;
        data.positions[idx * 3 + 2] = pz - dz * 0.4 + (Math.random() - 0.5) * 0.18;
        data.ages[idx] = 0;
        data.nextEmit = (idx + 1) % data.count;
        data.emitTimer = 0.045;
      }
    }
    data.lastX = px;
    data.lastZ = pz;
    data.lastSet = true;

    // Advance ages + slow rise, kill expired
    for (let i = 0; i < data.count; i++) {
      if (data.ages[i] < 0) continue;
      data.ages[i] += dt;
      if (data.ages[i] > 0.9) {
        data.ages[i] = -1;
        data.positions[i * 3 + 1] = -100;
      } else {
        data.positions[i * 3 + 1] += 0.6 * dt;
      }
    }
    this._trail.geometry.attributes.position.needsUpdate = true;
    this._trail.geometry.attributes.aAge.needsUpdate = true;
  }

  _animateAbyssParticles(dt) {
    if (!this._abyssParticleData || !this._abyssParticles) return;
    const { positions, speeds, count, yBottom, yTop } = this._abyssParticleData;
    for (let i = 0; i < count; i++) {
      const yi = i * 3 + 1;
      positions[yi] += speeds[i] * dt;
      if (positions[yi] > yTop) {
        // Wrap to bottom with fresh horizontal scatter.
        positions[i * 3]     = (Math.random() - 0.5) * 60;
        positions[yi]        = yBottom;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      }
    }
    this._abyssParticles.geometry.attributes.position.needsUpdate = true;
    this._abyssParticles.material.uniforms.uTime.value += dt;
  }

  _buildFloor() {
    this.floorGroup = new THREE.Group();
    this.scene.add(this.floorGroup);
    this.floorMeshes = [];
    // Floor tiles are now full unit cubes matching the underbody blocks.
    // Center at y=-0.5, so the top face is at y=0 (where the player walks).
    // Allocated for MAX dims; setStageDimensions hides tiles outside the
    // active stage's bounds and repositions visible ones.
    this._floorGeom = new THREE.BoxGeometry(TILE * this.groutInset, TILE * this.groutInset, TILE * this.groutInset);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.floor });
    patchLambertNoise(mat, { scale: 1.8, strength: 0.30, space: "world" });
    const REST_Y = -TILE / 2;
    for (let x = 0; x < MAX_GRID_W; x++) {
      this.floorMeshes[x] = [];
      for (let z = 0; z < MAX_GRID_D; z++) {
        const m = new THREE.Mesh(this._floorGeom, mat);
        const p = this._toWorld(x, z);
        m.position.set(p.x, REST_Y, p.z);
        m.receiveShadow = true;
        m.castShadow = false;
        m.userData.restY = REST_Y;
        m.userData.targetY = REST_Y;
        m.userData.vy = 0;
        this.floorGroup.add(m);
        this.floorMeshes[x][z] = m;
      }
    }
  }

  _buildPlayer() {
    // Outer group is what the rest of the renderer positions/rotates.
    this.playerMesh = new THREE.Group();
    this.playerMesh.position.y = 0;
    this.scene.add(this.playerMesh);

    // Temporary placeholder boxes while the GLB loads (and visible while
    // the user is cycling between characters in the selector).
    this._placeholder = new THREE.Group();
    const matBody = new THREE.MeshLambertMaterial({ color: COLORS.player });
    const matLeg  = new THREE.MeshLambertMaterial({ color: 0xc28a2a });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.26), matBody);
    torso.position.y = 0.62; torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.24), matBody);
    head.position.y = 0.95;  head.castShadow = true;
    const legGeom = new THREE.BoxGeometry(0.12, 0.38, 0.14);
    const legL = new THREE.Mesh(legGeom, matLeg);
    legL.position.set(-0.10, 0.21, 0); legL.castShadow = true;
    const legR = new THREE.Mesh(legGeom, matLeg);
    legR.position.set( 0.10, 0.21, 0); legR.castShadow = true;
    this._placeholder.add(torso, head, legL, legR);
    this.playerMesh.add(this._placeholder);

    // Heading (smoothed) and animation state.
    this.playerHeading = 0;
    this._mixer = null;
    this._anims = {};         // canonical name -> THREE.AnimationAction
    this._currentAnim = null; // canonical name ("idle" / "walk" / "run" / "death")
    this._modelReady = false;
    this._loadedModel = null;
    this._currentCharDef = null;
  }

  // Load (or swap) the active character. charDef from characters.js:
  //   { id, file, clips: { idle, walk, run, death } }
  setCharacter(charDef) {
    if (!charDef || this._currentCharDef?.id === charDef.id) return;
    this._currentCharDef = charDef;
    this._modelReady = false;

    // Tear down the previous model.
    if (this._loadedModel) {
      this.playerMesh.remove(this._loadedModel);
      this._loadedModel = null;
    }
    if (this._mixer) {
      this._mixer.stopAllAction();
      this._mixer = null;
    }
    this._anims = {};
    this._currentAnim = null;
    this._placeholder.visible = true;

    new GLTFLoader().load(charDef.file, (gltf) => {
      // Only commit if this is still the active request (selector may have
      // moved on while we were loading).
      if (this._currentCharDef?.id !== charDef.id) return;

      const model = gltf.scene;
      model.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
      });

      // Use the explicit per-character scale from characters.js (auto-scale
      // via Box3 turned out to be unreliable on Mixamo-derived rigs where
      // internal node scales aren't reflected in the bounding box).
      const scale = charDef.scale ?? 1;
      model.scale.setScalar(scale);
      model.position.y = charDef.yOffset ?? 0;

      this.playerMesh.add(model);
      this._loadedModel = model;
      this._placeholder.visible = false;

      // Animation mixer + canonical clip mapping.
      this._mixer = new THREE.AnimationMixer(model);
      const clipMap = charDef.clips || {};
      const clipsByName = {};
      for (const clip of gltf.animations) clipsByName[clip.name] = clip;
      // Per-character clip speed multiplier - useful for small characters
      // whose walk cycle takes a small stride but needs to cover the same
      // ground as the heroes. Defaults to 1 (clip plays at authored speed).
      const animSpeed = charDef.animSpeed ?? 1;
      for (const canonical of ["idle", "walk", "run", "death"]) {
        const targetName = clipMap[canonical];
        if (!targetName) continue;
        const clip = clipsByName[targetName];
        if (!clip) continue;
        const action = this._mixer.clipAction(clip);
        action.enabled = true;
        action.setEffectiveWeight(0);
        action.timeScale = animSpeed;
        action.play();
        this._anims[canonical] = action;
      }
      this._setAnim("idle", 0);
      this._modelReady = true;
    }, undefined, (err) => {
      console.error(`character ${charDef.id} failed to load:`, err);
    });
  }

  // Crossfade to a canonical animation name ("idle"/"walk"/"run"/"death").
  // Falls back gracefully if a clip is missing.
  _setAnim(name, fade = 0.25) {
    let action = this._anims[name];
    if (!action) action = this._anims["idle"]; // graceful fallback
    if (!action) return;
    const resolved = this._anims[name] ? name : "idle";
    if (this._currentAnim === resolved) return;
    const prev = this._currentAnim ? this._anims[this._currentAnim] : null;
    action.reset();
    action.setEffectiveWeight(1);
    action.fadeIn(fade);
    if (prev) prev.fadeOut(fade);
    this._currentAnim = resolved;
  }

  // Preload character GLBs used as mobs. Loads a POOL of independent gltf
  // instances by calling loader.load() N times - the same proven path
  // the player uses. Browser HTTP cache makes this 1 network fetch + N
  // parses. Each mob pops a fresh gltf from the queue (its own scene,
  // skeleton, and animation clips), so animations bind cleanly.
  _preloadMobs(ids) {
    this._mobPool = this._mobPool ?? {};    // id -> { charDef, queue: [gltf, ...] }
    for (const id of ids) {
      if (this._mobPool[id]) continue;
      const def = characterById(id);
      if (!def) continue;
      this._mobPool[id] = { charDef: def, queue: [] };
      // Generous pool size; typical waves use <8 mobs.
      const POOL_SIZE = 24;
      for (let i = 0; i < POOL_SIZE; i++) {
        new GLTFLoader().load(def.file, (gltf) => {
          gltf.scene.traverse((o) => {
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
          });
          this._mobPool[id].queue.push(gltf);
        }, undefined, (err) => console.error("mob preload load error", err));
      }
    }
  }

  // Build a renderer entry for a mob cube: pop a fresh gltf instance from
  // the pool, hook up the mixer + walk/idle/death actions. Returns null
  // until at least one instance has finished parsing.
  _buildMobEntry(modelId) {
    const cached = this._mobPool?.[modelId];
    if (!cached || cached.queue.length === 0) return null;
    const gltf = cached.queue.shift();
    const charDef = cached.charDef;
    const model = gltf.scene;
    model.scale.setScalar(charDef.scale ?? 1);
    model.position.y = charDef.yOffset ?? 0;
    const mixer = new THREE.AnimationMixer(model);
    const clipMap = charDef.clips || {};
    const animSpeed = charDef.animSpeed ?? 1;
    const clipsByName = {};
    for (const clip of gltf.animations) clipsByName[clip.name] = clip;
    const actions = {};
    for (const canonical of ["idle", "walk", "death"]) {
      const target = clipMap[canonical];
      if (!target) continue;
      const clip = clipsByName[target];
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.timeScale = animSpeed;
      // Every action needs play() so the mixer ticks it; weights are
      // what actually toggles visibility. Same pattern as the player.
      action.play();
      actions[canonical] = action;
    }
    // Default state: full-weight idle
    if (actions.idle) actions.idle.setEffectiveWeight(1);
    return { model, mixer, actions, current: "idle" };
  }

  _setMobAction(mobData, name) {
    if (!mobData || mobData.current === name) return;
    const prev = mobData.actions[mobData.current];
    const next = mobData.actions[name];
    if (!next) return;
    next.setEffectiveTimeScale(next.timeScale);
    next.fadeIn(0.12);
    if (prev) prev.fadeOut(0.12);
    mobData.current = name;
  }

  _buildMark() {
    // Square gradient shaft + rising particles. The shaft has the cube's
    // footprint and fades to transparent at the top via a fragment-shader
    // gradient; the particles rise through it for a "lit dust" feel.
    // Depth test off + additive blending = always visible through cubes.
    const w = TILE * 0.98;            // match floor tile footprint
    const h = 4;
    this._markHeight = h;
    this._markWidth = w;

    const geo = new THREE.BoxGeometry(w, h, w);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor:    { value: new THREE.Color(COLORS.mark) },
        uColorTop: { value: new THREE.Color(COLORS.markTop) },
        uOpacity:  { value: 0.55 },
        uHeight:   { value: h },
      },
      vertexShader: `
        varying float vYrel;
        uniform float uHeight;
        void main() {
          vYrel = (position.y + uHeight * 0.5) / uHeight;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vYrel;
        uniform vec3 uColor;
        uniform vec3 uColorTop;
        uniform float uOpacity;
        void main() {
          float y = clamp(vYrel, 0.0, 1.0);
          float a = pow(1.0 - y, 1.7) * uOpacity;
          // Ease toward the top color faster than linear so the upper
          // half is clearly yellow, not just a hint.
          vec3 col = mix(uColor, uColorTop, smoothstep(0.0, 1.0, y));
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.markMesh = new THREE.Mesh(geo, mat);
    this.markMesh.visible = false;
    this.scene.add(this.markMesh);

    // Rising-dust particles. Positions live in a typed array, advanced
    // each frame in syncMarks; the shader does the per-vertex fade so
    // particles bloom in at the bottom and dissolve as they near the top.
    const COUNT = 36;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * w * 0.9;
      positions[i * 3 + 1] = Math.random() * h;
      positions[i * 3 + 2] = (Math.random() - 0.5) * w * 0.9;
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pmat = new THREE.ShaderMaterial({
      uniforms: {
        uColor:    { value: new THREE.Color(COLORS.mark) },
        uColorTop: { value: new THREE.Color(COLORS.markTop) },
        uHeight:   { value: h },
        uSize:     { value: 70.0 },
      },
      vertexShader: `
        varying float vYrel;
        uniform float uHeight;
        uniform float uSize;
        void main() {
          vYrel = clamp(position.y / uHeight, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vYrel;
        uniform vec3 uColor;
        uniform vec3 uColorTop;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float soft   = 1.0 - smoothstep(0.15, 0.5, d);
          float bornIn = smoothstep(0.0, 0.10, vYrel);
          float fade   = 1.0 - smoothstep(0.0, 0.95, vYrel);
          vec3 col = mix(uColor, uColorTop, smoothstep(0.0, 1.0, vYrel));
          gl_FragColor = vec4(col + vec3(0.20) * fade, soft * bornIn * fade);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.markParticles = new THREE.Points(pgeo, pmat);
    this.markParticles.visible = false;
    this.scene.add(this.markParticles);

    this._markParticleData = {
      positions,
      vel: new Float32Array(COUNT * 3),
      count: COUNT,
      w,
      h,
    };
    this._markLastTime = performance.now();

    // Fire-blast state. While active, syncMarks renders the shaft and
    // particles in red at (x, z) for `dur` ms, then deactivates.
    this._markBlast = { active: false, t0: 0, x: 0, z: 0, dur: 520 };
    this._markBaseColor = new THREE.Color(COLORS.mark);
    this._markBaseColorTop = new THREE.Color(COLORS.markTop);
    this._markBlastColor = new THREE.Color(0xff2818);
  }

  // Fire blast = the existing mark shaft + particles, briefly recolored red
  // with the particles bursting outward, then fading. State is consumed by
  // syncMarks so the visual keeps rendering after grid.mark has been cleared.
  fireBlast(x, z) {
    this._markBlast.active = true;
    this._markBlast.t0 = performance.now();
    this._markBlast.x = x;
    this._markBlast.z = z;
    // Give every particle an outward radial kick + upward burst.
    const data = this._markParticleData;
    const vel = data.vel;
    for (let i = 0; i < data.count; i++) {
      const px = data.positions[i * 3];
      const pz = data.positions[i * 3 + 2];
      const d = Math.hypot(px, pz) || 0.0001;
      const speed = 4.5 + Math.random() * 2.5;
      vel[i * 3]     = (px / d) * speed;
      vel[i * 3 + 1] = 3.0 + Math.random() * 2.0;
      vel[i * 3 + 2] = (pz / d) * speed;
    }
  }

  // Ghost-bomb hint: a fading cartoony bomb that pops onto a tile the
  // moment the player marks it, then fades out within a tick. The
  // mark's blue gradient stays put; this is just a one-shot teaching
  // overlay that says "marking a tile is what eventually plants /
  // detonates something here". Single instance - one mark at a time.
  _buildMarkGhost() {
    this._markGhostBase = null;   // template loaded from GLB
    this._markGhost = null;       // { mesh, t0, duration } when active

    new GLTFLoader().load("assets/effects/bomb.glb?v=146", (gltf) => {
      this._markGhostBase = gltf.scene;
      this._markGhostBase.traverse((o) => {
        if (o.isMesh) o.castShadow = false;
      });
    }, undefined, (err) => {
      console.warn("mark ghost bomb failed to load:", err);
    });
  }

  // Called whenever a fresh mark is placed. Clones the template into
  // the scene, fades it in/out across ~1.2s while bobbing + rotating,
  // then removes itself. Replacing a live ghost cancels the old one.
  spawnMarkGhost(gx, gz) {
    if (!this._markGhostBase) return;
    if (this._markGhost) {
      this.scene.remove(this._markGhost.mesh);
      this._markGhost = null;
    }
    const mesh = this._markGhostBase.clone(true);
    mesh.traverse((o) => {
      if (o.isMesh) {
        // Clone material so opacity/color edits don't leak to the template.
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.depthWrite = false;
        o.material.opacity = 0;
        o.castShadow = false;
        // Recolor the bomb body (was 'Black') to match the mark gradient
        // so the ghost reads as a soft hint rather than a black object.
        if (o.material.name === "Black" && o.material.color) {
          o.material.color = new THREE.Color(0xe8eef8);
          if (o.material.emissive) o.material.emissive = new THREE.Color(0xa8c0e0);
          o.material.emissiveIntensity = 0.25;
        }
      }
    });
    const p = this._toWorld(gx, gz);
    mesh.position.set(p.x, 0.45, p.z);
    mesh.scale.setScalar(0.45);
    this.scene.add(mesh);
    this._markGhost = { mesh, t0: performance.now(), duration: 1200 };
  }

  _animateMarkGhost() {
    if (!this._markGhost) return;
    const { mesh, t0, duration } = this._markGhost;
    const t = (performance.now() - t0) / duration;
    if (t >= 1) {
      this.scene.remove(mesh);
      this._markGhost = null;
      return;
    }
    // Pop in fast, hold briefly, fade out. Peak alpha modest so it
    // reads as a hint rather than a solid object.
    const PEAK = 0.55;
    let alpha;
    if (t < 0.12)      alpha = (t / 0.12) * PEAK;
    else if (t < 0.32) alpha = PEAK;
    else               alpha = PEAK * (1 - (t - 0.32) / 0.68);
    mesh.traverse((o) => {
      if (o.isMesh) o.material.opacity = alpha;
    });
    // Bob + spin slowly for some life.
    mesh.position.y = 0.45 + Math.sin(t * Math.PI * 2) * 0.06;
    mesh.rotation.y = t * Math.PI * 0.8;
  }

  // Bomb-placement hint: directly tint the cubes inside the new bomb's
  // 3x3 zone red for ~800ms so the player can see who's caught in the
  // blast. We clone each cube's shared material, swap in the clone, lerp
  // its color toward red, then restore the original. No overlay meshes,
  // no overlap artifacts.
  spawnBombAuraOnCubes(cubeIds) {
    if (!cubeIds || cubeIds.length === 0) return;
    this._bombAuras ??= [];
    for (const id of cubeIds) {
      const entry = this.cubeMeshes.get(id);
      if (!entry) continue;
      // Skip mobs - their mesh is a Group of skinned children, not a
      // single Mesh, so the "clone material + tint red" trick doesn't
      // apply. They still dissolve normally on capture.
      if (entry.mob) continue;
      // Don't double-clone if this cube is already being flashed; reset
      // the timer instead.
      const existing = this._bombAuras.find(a => a.mesh === entry.mesh);
      if (existing) { existing.t0 = performance.now(); continue; }
      const originalMat = entry.mesh.material;
      const clonedMat = originalMat.clone();
      entry.mesh.material = clonedMat;
      this._bombAuras.push({
        mesh: entry.mesh,
        originalMat,
        clonedMat,
        originalColor: clonedMat.color.clone(),
        t0: performance.now(),
        duration: 800,
      });
    }
  }

  _animateBombAuras() {
    if (!this._bombAuras || this._bombAuras.length === 0) return;
    const RED = new THREE.Color(0xff2818);
    const now = performance.now();
    for (let i = this._bombAuras.length - 1; i >= 0; i--) {
      const a = this._bombAuras[i];
      const t = (now - a.t0) / a.duration;
      if (t >= 1) {
        a.mesh.material = a.originalMat;
        a.clonedMat.dispose();
        this._bombAuras.splice(i, 1);
        continue;
      }
      // Quick rise to full red, hold, fade back to original.
      const PEAK = 1.0;
      let mix;
      if (t < 0.15)      mix = (t / 0.15) * PEAK;
      else if (t < 0.55) mix = PEAK;
      else               mix = PEAK * (1 - (t - 0.55) / 0.45);
      a.clonedMat.color.copy(a.originalColor).lerp(RED, mix);
    }
  }

  _buildBombs() {
    // Pool of up to N bomb visuals — each is a floating tetrahedron above its
    // tile plus a 3x3 ring of subtle red tile overlays showing the blast area.
    this._bombPool = [];
    // Upside-down square pyramid: 4-segment cone flipped 180 so the tip
    // points down at the bomb's tile.
    this._bombGeom = new THREE.ConeGeometry(0.34, 0.62, 4);
    this._bombGeom.rotateX(Math.PI);
    this._bombMat = new THREE.MeshLambertMaterial({
      color: COLORS.bomb,
      emissive: COLORS.bombAccent,
      emissiveIntensity: 0.75,
    });
    this._bombTileGeom = new THREE.PlaneGeometry(TILE * 0.9, TILE * 0.9);
    this._bombTileMat = new THREE.MeshBasicMaterial({
      color: COLORS.bomb,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    });
    this._bombGroup = new THREE.Group();
    this.scene.add(this._bombGroup);
  }

  _ensureBombVisuals(count) {
    while (this._bombPool.length < count) {
      const group = new THREE.Group();
      const tri = new THREE.Mesh(this._bombGeom, this._bombMat);
      tri.castShadow = true;
      group.add(tri);
      const tiles = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const t = new THREE.Mesh(this._bombTileGeom, this._bombTileMat);
          t.rotation.x = -Math.PI / 2;
          t.position.set(dx * TILE, 0.013, -dz * TILE);
          tiles.push(t);
          group.add(t);
        }
      }
      this._bombGroup.add(group);
      this._bombPool.push({ group, tri, tiles });
    }
  }

  syncBombs(bombs, now) {
    this._ensureBombVisuals(bombs.length);
    for (let i = 0; i < this._bombPool.length; i++) {
      const slot = this._bombPool[i];
      if (i < bombs.length) {
        const b = bombs[i];
        const p = this._toWorld(b.cx, b.cz);
        slot.group.position.set(p.x, 0, p.z);
        // Floating bob + rotation. Centerline well above the cube tops
        // (cubes peak at y=1.0) so the triangle never visually clips
        // into a rolling block sharing the tile.
        const t = now / 1000;
        slot.tri.position.y = 1.7 + Math.sin(t * 2.2 + i) * 0.12;
        slot.tri.rotation.y = t * 1.4 + i;
        slot.tri.rotation.x = Math.sin(t * 1.1 + i) * 0.2;
        slot.group.visible = true;
      } else {
        slot.group.visible = false;
      }
    }
  }

  _ensureCubeMesh(cube) {
    let entry = this.cubeMeshes.get(cube.id);
    if (entry) return entry;

    // Mob cube: walking character mesh in place of the box. Wait until
    // the model has finished loading - the cube simply isn't drawn until
    // then (preload happens at boot, well before gameplay starts).
    let mob = null;
    if (cube.mobModel) {
      mob = this._buildMobEntry(cube.mobModel);
      if (!mob) return null;
    }

    const pivot = new THREE.Group();
    if (mob) {
      pivot.add(mob.model);
      this.scene.add(pivot);
      entry = { pivot, mesh: mob.model, mob };
    } else {
      let mat = this._normalMat;
      if (cube.type === CUBE_TYPE.FORBIDDEN) mat = this._forbiddenMat;
      else if (cube.type === CUBE_TYPE.ADVANTAGE) mat = this._advantageMat;
      const mesh = new THREE.Mesh(this._cubeGeom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      // pivot at the bottom-front edge of the cube (in local coords)
      mesh.position.set(0, 0.5, -0.5);
      pivot.add(mesh);
      // White outline along the 12 cube edges - comic-book look on top
      // of the black body.
      const edges = new THREE.LineSegments(this._cubeEdgesGeom, this._cubeEdgesMat);
      mesh.add(edges);
      this.scene.add(pivot);
      entry = { pivot, mesh };
    }
    this.cubeMeshes.set(cube.id, entry);
    return entry;
  }

  removeCubeMesh(cubeId) {
    const entry = this.cubeMeshes.get(cubeId);
    if (!entry) return;
    // Cancel any in-flight bomb aura tied to this cube so it doesn't
    // try to restore a now-detached material later.
    if (this._bombAuras && this._bombAuras.length > 0) {
      for (let i = this._bombAuras.length - 1; i >= 0; i--) {
        if (this._bombAuras[i].mesh === entry.mesh) {
          this._bombAuras[i].clonedMat.dispose();
          this._bombAuras.splice(i, 1);
        }
      }
    }
    // Dispose the per-cube material clone we minted for the dissolve
    // animation, if any. Skip for mobs (no shared cube material involved).
    if (!entry.mob && entry.mesh.userData.dissolving) {
      entry.mesh.material.dispose();
    }
    // Free the per-mob mixer + clip actions so they don't keep ticking.
    if (entry.mob) {
      entry.mob.mixer.stopAllAction();
      entry.mob.mixer.uncacheRoot(entry.mob.model);
    }
    this.scene.remove(entry.pivot);
    this.cubeMeshes.delete(cubeId);
  }

  syncFloor(grid) {
    for (let x = 0; x < this._stageW; x++) {
      for (let z = 0; z < this._stageD; z++) {
        const mesh = this.floorMeshes[x][z];
        const exists = grid.tiles[x][z];
        const ud = mesh.userData;
        const col = this._underbodyDrop[x][z];
        if (exists) {
          // Coming back: clear drop state and aim back at rest. Surface
          // tile and the column of underbody both spring/snap to rest.
          if (ud.targetY < ud.restY) {
            ud.vy = 0;
            ud.dropping = false;
          }
          mesh.visible = true;
          ud.targetY = ud.restY;
          if (col.hidden || col.dropping || col.y !== 0) {
            col.y = 0; col.vy = 0; col.dropping = false; col.dropDelay = 0; col.hidden = false;
            for (let layer = 0; layer < this._underbodyLayers; layer++) {
              this._setUnderbodyInstance(x, z, layer, 0);
              this._underbodyMeshes[layer].instanceMatrix.needsUpdate = true;
            }
          }
        } else if (!ud.dropping) {
          // First frame this tile is removed - queue a staggered fall so
          // the row topples one cube at a time L->R, building suspense.
          // ~0.4s per column means a 4-wide row takes ~1.2s to commit.
          const delay = 0.40 * x;
          ud.targetY = ud.restY - 22;
          ud.vy = 0;
          ud.dropping = true;
          ud.dropDelay = delay;
          ud.fallNotified = false;
          // Mirror onto the underbody column at this (x, z).
          col.dropping = true;
          col.vy = 0;
          col.y = 0;
          col.dropDelay = delay;
          col.hidden = false;
        }
      }
    }
  }

  _animateFloorDrops(dt) {
    const G = 28;            // gravity for dropping tiles
    const TILT_RATE = 4.0;   // radians/sec forward tilt
    const MAX_TILT = Math.PI * 0.55;
    for (let x = 0; x < this._stageW; x++) {
      for (let z = 0; z < this._stageD; z++) {
        const m = this.floorMeshes[x][z];
        const ud = m.userData;
        if (ud.dropping) {
          // Stagger: each block in the row waits its turn before falling.
          if (ud.dropDelay > 0) {
            const prev = ud.dropDelay;
            ud.dropDelay -= dt;
            if (prev > 0 && ud.dropDelay <= 0) {
              // Just transitioned from waiting -> falling: fire feedback.
              this.onTileDrop?.(x, z);
            }
            continue;
          } else if (!ud.fallNotified) {
            // Tile was queued with 0 delay (rare); still notify on first frame.
            this.onTileDrop?.(x, z);
            ud.fallNotified = true;
          }
          // Gravity-based fall plus a forward tilt so the block visibly
          // tumbles off the edge rather than sliding straight down.
          ud.vy -= G * dt;
          m.position.y += ud.vy * dt;
          if (m.rotation.x < MAX_TILT) {
            m.rotation.x = Math.min(MAX_TILT, m.rotation.x + dt * TILT_RATE);
          }
          // Hide only after the block has fallen clear of the underbody
          // (~18 units below rest). Anything earlier looks like it pops out.
          if (m.position.y < ud.restY - 14) {
            m.visible = false;
          }
        } else {
          // Resting or springing back: smooth lerp toward targetY and ease
          // any leftover tilt back to flat.
          const dy = ud.targetY - m.position.y;
          if (Math.abs(dy) > 0.001) {
            m.position.y += dy * Math.min(1, dt * 8);
          }
          if (m.rotation.x > 0.001) {
            m.rotation.x *= Math.max(0, 1 - dt * 8);
            if (m.rotation.x < 0.005) m.rotation.x = 0;
          }
        }
      }
    }

    // Underbody columns: each follows the same gravity/stagger as its
    // surface tile, but moves all 18 instances of its (x,z) column as
    // a single rigid block so the platform reads as one chunk shearing off.
    let underbodyDirty = false;
    for (let x = 0; x < this._stageW; x++) {
      for (let z = 0; z < this._stageD; z++) {
        const col = this._underbodyDrop[x][z];
        if (!col.dropping) continue;
        if (col.hidden) continue;
        if (col.dropDelay > 0) {
          col.dropDelay -= dt;
          continue;
        }
        col.vy -= G * dt;
        col.y += col.vy * dt;
        if (col.y < -16) {
          // Past the bottom of the visible underbody - collapse to scale 0.
          this._hideUnderbodyColumn(x, z);
          col.hidden = true;
        } else {
          for (let layer = 0; layer < this._underbodyLayers; layer++) {
            this._setUnderbodyInstance(x, z, layer, col.y);
          }
        }
        underbodyDirty = true;
      }
    }
    if (underbodyDirty) {
      for (let layer = 0; layer < this._underbodyLayers; layer++) {
        this._underbodyMeshes[layer].instanceMatrix.needsUpdate = true;
      }
    }
  }

  syncCubes(cubes, now) {
    const seen = new Set();
    for (const cube of cubes) {
      seen.add(cube.id);
      const entry = this._ensureCubeMesh(cube);
      if (!entry) continue; // mob model still loading
      const { pivot, mesh, mob } = entry;

      // Mobs use a different visual path: position lerp + walk cycle, no
      // roll math. Death path: idle/walk fade to invisibility while game
      // dissolve timer runs.
      if (mob) {
        // Mobs are centered in their tile (the +TILE/2 offset on cubes
        // is for the rolling pivot at the leading edge; mobs don't roll).
        if (cube.dissolving) {
          const u = cube.dissolveProgress(now);
          const p = this._toWorld(cube.gx, cube.gz);
          pivot.position.set(p.x, -u * 0.6, p.z);
          pivot.rotation.x = 0;
          pivot.rotation.y = Math.PI;
          pivot.scale.setScalar(1 - u * 0.4);
        } else if (cube.fallingOff) {
          const u = cube.fallOffProgress(now);
          const fromP = this._toWorld(cube.gx, cube.gz);
          pivot.position.set(fromP.x, -u * u * 7, fromP.z + u * 2);
          pivot.rotation.x = u * Math.PI;
          pivot.rotation.y = Math.PI;
        } else if (cube.roll) {
          const u = cube.rollProgress(now);
          const fromP = this._toWorld(cube.gx, cube.roll.fromZ);
          const toP   = this._toWorld(cube.gx, cube.roll.toZ);
          pivot.position.set(
            fromP.x + (toP.x - fromP.x) * u,
            0,
            fromP.z + (toP.z - fromP.z) * u,
          );
          pivot.rotation.y = Math.PI;
          // Walking while the step is in flight; idle through the post-step
          // pause before the next tick fires.
          this._setMobAction(mob, u < 1 ? "walk" : "idle");
        } else {
          const p = this._toWorld(cube.gx, cube.gz);
          pivot.position.set(p.x, 0, p.z);
          pivot.rotation.y = Math.PI;
          this._setMobAction(mob, "idle");
        }
        continue;
      }

      if (cube.dissolving) {
        // Captured: sinks into the floor, scales down, tints red, fades.
        // First frame: clone the material so color/opacity changes don't
        // bleed onto live siblings. Also cancel any in-flight bomb aura
        // on this cube so it doesn't try to restore a stale ref.
        if (!mesh.userData.dissolving) {
          mesh.userData.dissolving = true;
          if (this._bombAuras && this._bombAuras.length > 0) {
            for (let i = this._bombAuras.length - 1; i >= 0; i--) {
              if (this._bombAuras[i].mesh === mesh) {
                mesh.material = this._bombAuras[i].originalMat;
                this._bombAuras[i].clonedMat.dispose();
                this._bombAuras.splice(i, 1);
              }
            }
          }
          mesh.userData.dissolveOrigMat = mesh.material;
          mesh.material = mesh.material.clone();
          mesh.material.transparent = true;
          mesh.userData.dissolveOrigColor = mesh.material.color.clone();
        }
        const u = cube.dissolveProgress(now);
        const p = this._toWorld(cube.gx, cube.gz);
        // Sink into the floor + slight tilt for "absorption" feel.
        pivot.position.set(p.x, -u * 1.2, p.z + TILE / 2);
        pivot.rotation.x = u * 0.35;
        pivot.scale.setScalar(1);
        mesh.position.set(0, 0.5, -0.5);
        // Tint to red and fade.
        if (!Renderer._DISSOLVE_RED) Renderer._DISSOLVE_RED = new THREE.Color(0xff2818);
        mesh.material.color.copy(mesh.userData.dissolveOrigColor).lerp(Renderer._DISSOLVE_RED, u);
      } else if (cube.fallingOff) {
        // Tumbling off the edge: continues forward in +Z while accelerating
        // downward in Y, rolling well past the 90 degree tip so it looks
        // like it's plummeting.
        const u = cube.fallOffProgress(now);
        const fromP = this._toWorld(cube.gx, cube.gz);
        pivot.position.set(
          fromP.x,
          -u * u * 7,                  // quadratic (gravity-ish) drop
          fromP.z + TILE / 2 + u * 2,  // continue rolling forward ~2 tiles
        );
        pivot.rotation.x = u * Math.PI * 1.4; // tumble past vertical
        pivot.scale.setScalar(1);
        mesh.position.set(0, 0.5, -0.5);
      } else if (cube.roll) {
        const u = cube.rollProgress(now);
        // Cubes roll toward the player (+Z in world). Pivot sits at the leading
        // (+Z) edge of the source tile so the cube tips forward.
        const sourceP = this._toWorld(cube.gx, cube.roll.fromZ);
        pivot.position.set(sourceP.x, 0, sourceP.z + TILE / 2);
        pivot.rotation.x = u * Math.PI / 2;
      } else {
        const p = this._toWorld(cube.gx, cube.gz);
        pivot.position.set(p.x, 0, p.z + TILE / 2);
        pivot.rotation.x = 0;
        pivot.scale.setScalar(1);
        mesh.position.set(0, 0.5, -0.5);
      }
    }
    // Remove meshes for cubes no longer present
    for (const id of [...this.cubeMeshes.keys()]) {
      if (!seen.has(id)) this.removeCubeMesh(id);
    }
  }

  syncPlayer(player, now) {
    // Continuous-position: render directly from the player's float coords.
    const p = this._toWorld(player.gx, player.gz);
    let y = 0;
    if (player.falling) {
      const fu = Math.min(1, (now - player.fallT0) / 800);
      y = -fu * 4.5;
      this.playerMesh.rotation.z = fu * Math.PI * 0.8;
    } else {
      this.playerMesh.rotation.z = 0;
    }
    this.playerMesh.position.set(p.x, y, p.z);

    // Heading: face direction of movement. player.vx maps to world +X;
    // player.vz (grid) is inverted in world. Smooth toward target so the
    // model doesn't snap on direction changes.
    const speed = Math.hypot(player.vx, player.vz);
    if (speed > 0.05) {
      const targetAngle = Math.atan2(player.vx, -player.vz);
      let delta = targetAngle - this.playerHeading;
      // Take the short way around the circle.
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.playerHeading += delta * 0.25;
    }
    this.playerMesh.rotation.y = this.playerHeading;

    // Animation selection (canonical names; missing clips fall back to idle).
    if (this._modelReady) {
      if (player.falling) {
        this._setAnim("death");
      } else if (speed < 0.1) {
        this._setAnim("idle");
      } else if (speed < player.speed * 0.7) {
        this._setAnim("walk");
      } else {
        this._setAnim("run");
      }
    }
  }

  syncMarks(grid) {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this._markLastTime) / 1000));
    this._markLastTime = now;

    const blast = this._markBlast;
    if (blast.active) {
      const u = (now - blast.t0) / blast.dur;
      if (u >= 1) {
        blast.active = false;
        // Reset particles for the next mark so they restart with fresh rest pos.
        const data = this._markParticleData;
        for (let i = 0; i < data.count; i++) {
          data.positions[i * 3]     = (Math.random() - 0.5) * data.w * 0.9;
          data.positions[i * 3 + 1] = Math.random() * data.h;
          data.positions[i * 3 + 2] = (Math.random() - 0.5) * data.w * 0.9;
          data.vel[i * 3] = data.vel[i * 3 + 1] = data.vel[i * 3 + 2] = 0;
        }
      }
    }

    let mode;
    let mx, mz;
    if (grid.mark) {
      mode = "idle";
      mx = grid.mark.x; mz = grid.mark.z;
    } else if (blast.active) {
      mode = "blast";
      mx = blast.x; mz = blast.z;
    } else {
      this.markMesh.visible = false;
      this.markParticles.visible = false;
      return;
    }

    const p = this._toWorld(mx, mz);
    const h = this._markHeight;
    const data = this._markParticleData;
    const pos = data.positions;
    const vel = data.vel;

    if (mode === "idle") {
      // Green-to-yellow gradient column with a gentle breathing pulse.
      this.markMesh.material.uniforms.uColor.value.copy(this._markBaseColor);
      this.markMesh.material.uniforms.uColorTop.value.copy(this._markBaseColorTop);
      this.markMesh.material.uniforms.uOpacity.value =
        0.45 + 0.20 * (0.5 + 0.5 * Math.sin((now / 1000) * 3));
      this.markParticles.material.uniforms.uColor.value.copy(this._markBaseColor);
      this.markParticles.material.uniforms.uColorTop.value.copy(this._markBaseColorTop);
      // Particles drift upward, wrap to the floor when they cap out.
      const speed = 0.7;
      for (let i = 0; i < data.count; i++) {
        const yi = i * 3 + 1;
        pos[yi] += speed * dt;
        if (pos[yi] > h) {
          pos[yi] = 0;
          pos[i * 3]     = (Math.random() - 0.5) * data.w * 0.9;
          pos[i * 3 + 2] = (Math.random() - 0.5) * data.w * 0.9;
        }
      }
    } else {
      // Blast: red shaft fading out + particles flying outward. Flatten
      // the gradient to a single hot color so the burst doesn't read as
      // half-yellow.
      const u = Math.min(1, (now - blast.t0) / blast.dur);
      this.markMesh.material.uniforms.uColor.value.copy(this._markBlastColor);
      this.markMesh.material.uniforms.uColorTop.value.copy(this._markBlastColor);
      // Quick "pop" — bright early, fade by end.
      this.markMesh.material.uniforms.uOpacity.value = (1.0 - u) * 1.1;
      this.markParticles.material.uniforms.uColor.value.copy(this._markBlastColor);
      this.markParticles.material.uniforms.uColorTop.value.copy(this._markBlastColor);
      // Integrate velocity, apply a touch of gravity so the burst arcs.
      const g = 6.0;
      for (let i = 0; i < data.count; i++) {
        pos[i * 3]     += vel[i * 3]     * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        vel[i * 3 + 1] -= g * dt;
      }
    }

    this.markMesh.position.set(p.x, h / 2, p.z);
    this.markMesh.visible = true;
    this.markParticles.geometry.attributes.position.needsUpdate = true;
    this.markParticles.position.set(p.x, 0, p.z);
    this.markParticles.visible = true;
  }

  updateCamera(player, dt) {
    const target = this._toWorld(player.gx, player.gz);
    const halflife = this.followHalflife;

    // Ease the framing-preset blend toward its target. Game already
    // smoothsteps the input over distance, so this is just light
    // damping for the per-tile jumps in the player's gz.
    const k = 1 - Math.pow(0.5, (dt * 1000) / 450);
    this._tightBlend += (this._tightBlendTarget - this._tightBlend) * k;
    const b = this._tightBlend;
    const mix = (a, c) => a + (c - a) * b;
    const fov = mix(this._defaultFov, this._tightFov);
    this._baseCamY = mix(this._defaultCamY, this._tightCamY);
    this._followDZ = mix(this._defaultFollowDZ, this._tightFollowDZ);
    this._lookY = mix(this._defaultLookY, this._tightLookY);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Critically-damped spring on follow position (x, z) and the lookAt mix.
    [this._camPosX,  this._camVelX]  = Renderer._springStep(this._camPosX,  this._camVelX,  target.x, dt, halflife);
    [this._camPosZ,  this._camVelZ]  = Renderer._springStep(this._camPosZ,  this._camVelZ,  target.z, dt, halflife);
    [this._lookPosX, this._lookVelX] = Renderer._springStep(this._lookPosX, this._lookVelX, target.x, dt, halflife);
    // LookAt z trails 1.5 units ahead of (deeper than) the player so the
    // upcoming cubes stay framed above them on screen.
    const lookZTarget = target.z - 1.5;
    [this._lookPosZ, this._lookVelZ] = Renderer._springStep(this._lookPosZ, this._lookVelZ, lookZTarget, dt, halflife);

    // Chase cam: the camera Z follows the player Z directly with a fixed
    // offset behind them, so the player stays at a consistent screen size
    // no matter how deep into the runway they are.
    const camX = this._camPosX * 0.55;
    this.camera.position.x = camX;
    this.camera.position.y = this._baseCamY;
    this.camera.position.z = this._camPosZ + this._followDZ;

    // Damped impact shake. Random sample per frame for chaotic feel; amplitude
    // ramps linearly to zero over the shake duration.
    const now = performance.now();
    if (now < this._shakeEnd) {
      const u = (now - this._shakeT0) / (this._shakeEnd - this._shakeT0);
      const a = this._shakeAmp * (1 - u);
      this.camera.position.x += (Math.random() * 2 - 1) * a;
      this.camera.position.y += (Math.random() * 2 - 1) * a * 0.5;
      this.camera.position.z += (Math.random() * 2 - 1) * a;
    }

    const lookX = this._lookPosX * 0.65;
    this.camera.lookAt(lookX, this._lookY, this._lookPosZ);
  }

  pulseMark(strength) {
    if (!this.markMesh.visible) return;
    this.markMesh.material.opacity = 0.4 + strength * 0.5;
  }

  step(dt) {
    this._animateFloorDrops(dt);
    this._animateMarkGhost();
    this._animateBombAuras();
    if (this._mixer) this._mixer.update(dt);
    // Advance every live mob's animation mixer (walk / idle blends).
    for (const entry of this.cubeMeshes.values()) {
      if (entry.mob) entry.mob.mixer.update(dt);
    }
    this._animateAbyssParticles(dt);
    this._animateGoo(dt);
    this._animateGhosts(dt);
    this._animateFireballs(dt);
    this._animatePlayerTrail(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;

    // Default-preset framing per aspect; updateCamera reads the lerped
    // values from _defaultX <-> _tightX based on _tightBlend.
    let camY, followDZ, fov;
    if (aspect < 0.9) {
      fov = 62; camY = 6.4; followDZ = 7.0;
    } else if (aspect < 1.4) {
      fov = 56; camY = 5.4; followDZ = 6.0;
    } else {
      fov = 52; camY = 4.6; followDZ = 5.4;
    }
    this._defaultFov = fov;
    this._defaultCamY = camY;
    this._defaultFollowDZ = followDZ;
    this.camera.fov = fov;
    this._baseCamY = camY;
    this._followDZ = followDZ;
    this.camera.position.set(0, camY, this._lookZ + followDZ);
    this.camera.lookAt(0, this._lookY, this._lookZ);
    this.camera.updateProjectionMatrix();
  }

  // Engage / disengage the tight framing preset. Game calls with 1 when
  // the player is right up against the active wave, 0 otherwise. Renderer
  // eases the actual camera params toward the chosen target each frame.
  setTightBlend(target) {
    this._tightBlendTarget = Math.max(0, Math.min(1, target));
  }

  clearAllCubes() {
    for (const id of [...this.cubeMeshes.keys()]) this.removeCubeMesh(id);
  }
}
