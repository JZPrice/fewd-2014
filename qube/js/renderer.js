import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GRID_W, GRID_D, TILE, COLORS, CUBE_TYPE, PLAYER_SLIDE_MS, CAM_HALFLIFE_MS } from "./config.js?v=29";

export function gridToWorld(gx, gz) {
  return {
    x: (gx - (GRID_W - 1) / 2) * TILE,
    z: -gz * TILE,
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.ground);
    this.scene.fog = new THREE.Fog(COLORS.ground, 14, 38);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this._lookZ = -(GRID_D - 1) / 2;
    this._baseCamY = 5.8;
    this._baseCamZ = 5.8;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    this.camera.position.set(0, this._baseCamY, this._baseCamZ);
    this.camera.lookAt(0, 0.4, this._lookZ);

    this._buildLights();
    this._buildPlatformBody();
    this._buildFloor();
    this._buildPlayer();
    this._buildMark();
    this._buildBombs();

    this.cubeMeshes = new Map();
    this._cubeGeom = new THREE.BoxGeometry(TILE, TILE, TILE);
    this._normalMat = new THREE.MeshLambertMaterial({ color: COLORS.normal });
    this._forbiddenMat = new THREE.MeshLambertMaterial({
      color: COLORS.forbidden,
      emissive: COLORS.forbiddenAccent,
      emissiveIntensity: 0.35,
    });
    this._advantageMat = new THREE.MeshLambertMaterial({
      color: COLORS.advantage,
      emissive: COLORS.advantageAccent,
      emissiveIntensity: 0.5,
    });

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
    const target = gridToWorld(player.gx, player.gz);
    this._camPosX = target.x;  this._camVelX = 0;
    this._camPosZ = target.z;  this._camVelZ = 0;
    this._lookPosX = target.x; this._lookVelX = 0;
    this._lookPosZ = target.z - 1.5; this._lookVelZ = 0;
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
    // The underbody is a stack of progressively darker slabs with thin gaps.
    // The visible seams between slabs read as depth markers, and the lower
    // slabs fade into fog so the column reads as bottomless. Each slab is
    // slightly inset from the one above so the silhouette tapers very
    // gently inward as it descends.
    this.platformBody = new THREE.Group();
    const baseW = GRID_W * TILE * 1.04;
    const baseD = GRID_D * TILE * 1.04;
    const slabs = 24;
    const slabH = 2.4;
    const gap = 0.10;
    for (let i = 0; i < slabs; i++) {
      const yTop = -0.25 - i * (slabH + gap);
      const yMid = yTop - slabH / 2;
      const t = i / (slabs - 1);
      // Lightness ramps from a visible ~22% near the top down to ~4% deep
      // below, so each subsequent slab is darker than the last.
      const light = Math.max(3, Math.round(22 - t * 19));
      const color = new THREE.Color(`hsl(228, 18%, ${light}%)`);
      // Gentle inward taper - barely perceptible but adds depth cue.
      const inset = i * 0.02;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(baseW - inset, slabH, baseD - inset),
        new THREE.MeshLambertMaterial({ color })
      );
      mesh.position.set(0, yMid, this._lookZ);
      mesh.receiveShadow = true;
      this.platformBody.add(mesh);
    }
    this.scene.add(this.platformBody);
  }

  _buildFloor() {
    this.floorGroup = new THREE.Group();
    this.scene.add(this.floorGroup);
    this.floorMeshes = [];
    const geo = new THREE.BoxGeometry(TILE * 0.98, 0.2, TILE * 0.98);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.floor });
    for (let x = 0; x < GRID_W; x++) {
      this.floorMeshes[x] = [];
      for (let z = 0; z < GRID_D; z++) {
        const m = new THREE.Mesh(geo, mat);
        const p = gridToWorld(x, z);
        m.position.set(p.x, -0.1, p.z);
        m.receiveShadow = true;
        m.userData.targetY = -0.1;
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
      for (const canonical of ["idle", "walk", "run", "death"]) {
        const targetName = clipMap[canonical];
        if (!targetName) continue;
        const clip = clipsByName[targetName];
        if (!clip) continue;
        const action = this._mixer.clipAction(clip);
        action.enabled = true;
        action.setEffectiveWeight(0);
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
    const g = new THREE.PlaneGeometry(TILE * 0.85, TILE * 0.85);
    const m = new THREE.MeshBasicMaterial({
      color: COLORS.mark,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    this.markMesh = new THREE.Mesh(g, m);
    this.markMesh.rotation.x = -Math.PI / 2;
    this.markMesh.position.y = 0.012;
    this.markMesh.visible = false;
    this.scene.add(this.markMesh);
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
        const p = gridToWorld(b.cx, b.cz);
        slot.group.position.set(p.x, 0, p.z);
        // Floating bob + rotation
        const t = now / 1000;
        slot.tri.position.y = 1.0 + Math.sin(t * 2.2 + i) * 0.12;
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
    for (let x = 0; x < GRID_W; x++) {
      for (let z = 0; z < GRID_D; z++) {
        const mesh = this.floorMeshes[x][z];
        const exists = grid.tiles[x][z];
        if (exists) {
          mesh.visible = true;
          mesh.userData.targetY = -0.1;
        } else {
          mesh.userData.targetY = -2.5;
          if (mesh.position.y < -2.4) mesh.visible = false;
        }
      }
    }
  }

  _animateFloorDrops(dt) {
    for (let x = 0; x < GRID_W; x++) {
      for (let z = 0; z < GRID_D; z++) {
        const m = this.floorMeshes[x][z];
        const dy = m.userData.targetY - m.position.y;
        if (Math.abs(dy) > 0.001) {
          m.position.y += dy * Math.min(1, dt * 6);
          if (m.userData.targetY < -2 && m.position.y < -2.4) m.visible = false;
        }
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
        const fromP = gridToWorld(cube.gx, cube.gz);
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
        const sourceP = gridToWorld(cube.gx, cube.roll.fromZ);
        pivot.position.set(sourceP.x, 0, sourceP.z + TILE / 2);
        pivot.rotation.x = u * Math.PI / 2;
      } else {
        const p = gridToWorld(cube.gx, cube.gz);
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
    const p = gridToWorld(player.gx, player.gz);
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
    if (grid.mark) {
      const p = gridToWorld(grid.mark.x, grid.mark.z);
      this.markMesh.position.set(p.x, 0.012, p.z);
      this.markMesh.visible = true;
    } else {
      this.markMesh.visible = false;
    }
  }

  updateCamera(player, dt) {
    const target = gridToWorld(player.gx, player.gz);
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
    this.camera.lookAt(lookX, 0.4, this._lookPosZ);
  }

  pulseMark(strength) {
    if (!this.markMesh.visible) return;
    this.markMesh.material.opacity = 0.4 + strength * 0.5;
  }

  step(dt) {
    this._animateFloorDrops(dt);
    if (this._mixer) this._mixer.update(dt);
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
      fov = 68; camY = 6.8; followDZ = 5.5;
    } else if (aspect < 1.4) {
      fov = 62; camY = 5.6; followDZ = 4.6;
    } else {
      fov = 58; camY = 4.8; followDZ = 4.0;
    }
    this.camera.fov = fov;
    this._baseCamY = camY;
    this._followDZ = followDZ;
    this.camera.position.set(0, camY, this._lookZ + followDZ);
    this.camera.lookAt(0, 0.4, this._lookZ);
    this.camera.updateProjectionMatrix();
  }

  clearAllCubes() {
    for (const id of [...this.cubeMeshes.keys()]) this.removeCubeMesh(id);
  }
}
