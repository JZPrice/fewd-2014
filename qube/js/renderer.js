import * as THREE from "three";
import { GRID_W, GRID_D, TILE, COLORS, CUBE_TYPE, PLAYER_SLIDE_MS } from "./config.js?v=5";

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
    this.scene.fog = new THREE.Fog(COLORS.ground, 8, 22);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this._lookZ = -(GRID_D - 1) / 2;
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.1, 100);
    this.camera.position.set(0, 4.4, 4.6);
    this.camera.lookAt(0, 0.4, this._lookZ);

    this._buildLights();
    this._buildFloor();
    this._buildPlayer();
    this._buildMark();
    this._buildAdvMark();

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

    this._camTargetX = 0;
    this.onResize();
    window.addEventListener("resize", () => this.onResize());
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(COLORS.sky, COLORS.ground, 0.55);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 8, 4);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -6;
    dir.shadow.camera.right = 6;
    dir.shadow.camera.top = 4;
    dir.shadow.camera.bottom = -10;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 20;
    this.scene.add(dir);
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
    const g = new THREE.ConeGeometry(0.28, 0.6, 6);
    const m = new THREE.MeshLambertMaterial({
      color: COLORS.player,
      emissive: COLORS.player,
      emissiveIntensity: 0.25,
    });
    this.playerMesh = new THREE.Mesh(g, m);
    this.playerMesh.castShadow = true;
    this.playerMesh.position.y = 0.3;
    this.scene.add(this.playerMesh);
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

  _buildAdvMark() {
    this.advMarkMesh = new THREE.Group();
    const g = new THREE.PlaneGeometry(TILE * 0.85, TILE * 0.85);
    const m = new THREE.MeshBasicMaterial({
      color: COLORS.advMark,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const tile = new THREE.Mesh(g, m);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(dx * TILE, 0.014, -dz * TILE);
        this.advMarkMesh.add(tile);
      }
    }
    this.advMarkMesh.visible = false;
    this.scene.add(this.advMarkMesh);
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
      if (cube.roll) {
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
    const target = gridToWorld(player.gx, player.gz);
    const prev = gridToWorld(player.prevGx, player.prevGz);
    const u = player.slideProgress(now);
    const x = prev.x + (target.x - prev.x) * u;
    const z = prev.z + (target.z - prev.z) * u;
    let y = 0.3;
    if (player.falling) {
      const fu = Math.min(1, (now - player.fallT0) / 800);
      y = 0.3 - fu * 4.5;
      this.playerMesh.rotation.z = fu * Math.PI * 0.8;
    } else {
      this.playerMesh.rotation.z = 0;
    }
    this.playerMesh.position.set(x, y, z);
  }

  syncMarks(grid) {
    if (grid.mark) {
      const p = gridToWorld(grid.mark.x, grid.mark.z);
      this.markMesh.position.set(p.x, 0.012, p.z);
      this.markMesh.visible = true;
    } else {
      this.markMesh.visible = false;
    }
    if (grid.advMark) {
      const p = gridToWorld(grid.advMark.cx, grid.advMark.cz);
      this.advMarkMesh.position.set(p.x, 0, p.z);
      this.advMarkMesh.visible = true;
    } else {
      this.advMarkMesh.visible = false;
    }
  }

  updateCamera(player, dt) {
    const target = gridToWorld(player.gx, player.gz);
    this._camTargetX += (target.x - this._camTargetX) * Math.min(1, dt * 3.5);
    const baseX = this._camTargetX * 0.4;
    this.camera.position.x = baseX;
    this.camera.lookAt(baseX, 0.4, this._lookZ);
  }

  pulseMark(strength) {
    if (!this.markMesh.visible) return;
    this.markMesh.material.opacity = 0.4 + strength * 0.5;
  }

  step(dt) {
    this._animateFloorDrops(dt);
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

    if (aspect < 0.9) {
      this.camera.fov = 64;
      this.camera.position.set(0, 6.4, 6.8);
    } else if (aspect < 1.4) {
      this.camera.fov = 58;
      this.camera.position.set(0, 5.2, 5.6);
    } else {
      this.camera.fov = 54;
      this.camera.position.set(0, 4.4, 4.6);
    }
    this.camera.lookAt(0, 0.4, this._lookZ);
    this.camera.updateProjectionMatrix();
  }

  clearAllCubes() {
    for (const id of [...this.cubeMeshes.keys()]) this.removeCubeMesh(id);
  }
}
