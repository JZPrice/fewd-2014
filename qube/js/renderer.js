import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GRID_W, GRID_D, MAX_GRID_W, MAX_GRID_D, TILE, COLORS, CUBE_TYPE, PLAYER_SLIDE_MS, CAM_HALFLIFE_MS } from "./config.js?v=95";

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
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    this.camera.position.set(0, this._baseCamY, this._baseCamZ);
    this.camera.lookAt(0, -3.5, this._lookZ);

    this._buildLights();
    this._buildPlatformBody();
    this._buildFloor();
    this._buildPlayer();
    this._buildMark();
    this._buildBombs();
    this._buildMarkGhost();

    this.cubeMeshes = new Map();
    this._cubeGeom = new THREE.BoxGeometry(TILE, TILE, TILE);

    this._normalMat = new THREE.MeshLambertMaterial({ color: COLORS.normal });
    patchLambertNoise(this._normalMat, { scale: 2.6, strength: 0.28, space: "local" });

    this._advantageMat = new THREE.MeshLambertMaterial({
      color: COLORS.advantage,
      emissive: COLORS.advantageAccent,
      emissiveIntensity: 0.5,
    });
    patchLambertNoise(this._advantageMat, { scale: 2.6, strength: 0.22, space: "local" });

    // Forbidden = polished black onyx. PBR-clearcoat gives the wet shine
    // (specular pop from the dirLight, blurred reflections via the procedural
    // env map built in _installEnvironment), and the noise patch breaks up
    // the flat color with subtle marbled veining locked to each cube.
    this._forbiddenMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a0d,
      roughness: 0.20,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    });
    patchLambertNoise(this._forbiddenMat, { scale: 3.0, strength: 0.45, space: "local" });
    this._installEnvironment();
    this._buildAbyssBackground();

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
    const geom = new THREE.BoxGeometry(TILE * 0.98, TILE * 0.98, TILE * 0.98);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.floor });
    patchLambertNoise(mat, { scale: 1.8, strength: 0.30, space: "world" });

    this._underbodyMeshes = [];
    this._underbodyLayers = LAYERS;
    const dummy = new THREE.Object3D();
    for (let layer = 0; layer < LAYERS; layer++) {
      const y = -TILE / 2 - (layer + 1) * TILE;
      const inst = new THREE.InstancedMesh(geom, mat, PER_LAYER);
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
  // Bottomless abyss + rising motes. Replaces the old lava plane: a deep
  // dark floor far below and a swarm of pale particles drifting upward
  // through the void, peaking in brightness around mid-height and fading
  // off as they near the platform's level.
  _buildAbyssBackground() {
    // Deep floor — flat dark fill, far enough below that it never edges
    // the camera. Keeps the silhouette clean.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x04050b }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -14;
    this.scene.add(floor);

    // Rising motes.
    const COUNT = 220;
    const positions = new Float32Array(COUNT * 3);
    const speeds = new Float32Array(COUNT);
    const seeds = new Float32Array(COUNT);
    const Y_BOTTOM = -10;
    const Y_TOP = 4;
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Y_BOTTOM + Math.random() * (Y_TOP - Y_BOTTOM);
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      speeds[i] = 0.25 + Math.random() * 0.6;
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
          float h = (vY + 10.0) / 14.0;
          float curve = smoothstep(0.0, 0.25, h) * (1.0 - smoothstep(0.7, 1.0, h));
          // Cool blue-white tint with a touch of warm variance per mote.
          vec3 col = mix(vec3(0.55, 0.72, 0.95), vec3(0.85, 0.90, 1.0), vSeed);
          gl_FragColor = vec4(col, soft * curve * 0.75);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._abyssParticles = new THREE.Points(geo, mat);
    this.scene.add(this._abyssParticles);
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
    const geo = new THREE.BoxGeometry(TILE * 0.98, TILE * 0.98, TILE * 0.98);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.floor });
    patchLambertNoise(mat, { scale: 1.8, strength: 0.30, space: "world" });
    const REST_Y = -TILE / 2;
    for (let x = 0; x < MAX_GRID_W; x++) {
      this.floorMeshes[x] = [];
      for (let z = 0; z < MAX_GRID_D; z++) {
        const m = new THREE.Mesh(geo, mat);
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

    new GLTFLoader().load("assets/effects/bomb.glb?v=95", (gltf) => {
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

  // Bomb-placement hint: pulse a transparent red aura around the cubes
  // sitting inside the new bomb's 3x3 zone so the player sees what's
  // queued for the blast. Each aura is parented to the target cube's
  // pivot so it tracks the cube's roll. Auto-removed when the pulse
  // ends. Pass an array of cube IDs that were inside the zone at the
  // moment of placement.
  spawnBombAuraOnCubes(cubeIds) {
    if (!cubeIds || cubeIds.length === 0) return;
    if (!this._bombAuraGeom) {
      // Slightly larger box per cube; we render only its back-faces so
      // the cube body occludes everything except the thin rim that pokes
      // past the cube's silhouette - reads as a halo, not a flat overlay.
      this._bombAuraGeom = new THREE.BoxGeometry(TILE * 1.22, TILE * 1.22, TILE * 1.22);
    }
    this._bombAuras ??= [];
    for (const id of cubeIds) {
      const entry = this.cubeMeshes.get(id);
      if (!entry) continue;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff3030,
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
        depthWrite: false,
      });
      const aura = new THREE.Mesh(this._bombAuraGeom, mat);
      // Match the cube mesh's offset within the pivot so the halo wraps
      // the cube body, not the pivot edge.
      aura.position.set(0, 0.5, -0.5);
      entry.pivot.add(aura);
      this._bombAuras.push({
        aura, pivot: entry.pivot,
        t0: performance.now(), duration: 800,
      });
    }
  }

  _animateBombAuras() {
    if (!this._bombAuras || this._bombAuras.length === 0) return;
    const now = performance.now();
    for (let i = this._bombAuras.length - 1; i >= 0; i--) {
      const a = this._bombAuras[i];
      const t = (now - a.t0) / a.duration;
      if (t >= 1) {
        a.pivot.remove(a.aura);
        a.aura.material.dispose();
        this._bombAuras.splice(i, 1);
        continue;
      }
      // Quick rise, hold at peak, fade out. Higher peak than the mark
      // ghost because we're only seeing the silhouette rim, not the
      // whole object.
      const PEAK = 0.85;
      let alpha;
      if (t < 0.15)      alpha = (t / 0.15) * PEAK;
      else if (t < 0.50) alpha = PEAK;
      else               alpha = PEAK * (1 - (t - 0.50) / 0.50);
      a.aura.material.opacity = alpha;
    }
  }

  _buildBombs() {
    // Pool of up to N bomb visuals — each is a floating tetrahedron above its
    // tile plus a 3x3 ring of subtle red tile overlays showing the blast area.
    this._bombPool = [];
    this._bombGeom = new THREE.TetrahedronGeometry(0.32);
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
    const pivot = new THREE.Group();
    let mat = this._normalMat;
    if (cube.type === CUBE_TYPE.FORBIDDEN) mat = this._forbiddenMat;
    else if (cube.type === CUBE_TYPE.ADVANTAGE) mat = this._advantageMat;
    const mesh = new THREE.Mesh(this._cubeGeom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    // pivot at the bottom-front edge of the cube (in local coords)
    mesh.position.set(0, 0.5, -0.5);
    pivot.add(mesh);
    this.scene.add(pivot);
    entry = { pivot, mesh };
    this.cubeMeshes.set(cube.id, entry);
    return entry;
  }

  removeCubeMesh(cubeId) {
    const entry = this.cubeMeshes.get(cubeId);
    if (!entry) return;
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
      const { pivot, mesh } = this._ensureCubeMesh(cube);
      if (cube.fallingOff) {
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
    this.camera.lookAt(lookX, -3.5, this._lookPosZ);
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
    this._animateAbyssParticles(dt);
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

    // _baseCamY = height above floor; _followDZ = how far behind the player
    // the camera sits. Smaller = tighter framing. Closer for narrower screens.
    let camY, followDZ, fov;
    if (aspect < 0.9) {
      fov = 68; camY = 7.2; followDZ = 8.0;
    } else if (aspect < 1.4) {
      fov = 62; camY = 6.0; followDZ = 6.8;
    } else {
      fov = 58; camY = 5.2; followDZ = 6.0;
    }
    this.camera.fov = fov;
    this._baseCamY = camY;
    this._followDZ = followDZ;
    this.camera.position.set(0, camY, this._lookZ + followDZ);
    this.camera.lookAt(0, -3.5, this._lookZ);
    this.camera.updateProjectionMatrix();
  }

  clearAllCubes() {
    for (const id of [...this.cubeMeshes.keys()]) this.removeCubeMesh(id);
  }
}
