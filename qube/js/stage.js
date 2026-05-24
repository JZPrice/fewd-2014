import { Cube } from "./cube.js?v=85";
import { CUBE_TYPE, GRID_W, GRID_D } from "./config.js?v=85";

export class Stage {
  constructor(stageDef) {
    this.def = stageDef;
    this.waveIndex = 0;
    this.cubes = [];
    this.totalCubes = 0;
    this.forbiddenDestroyed = false;
    this.floorLost = false;
    this.tickMs = stageDef.tickMs;
    this.rollMs = stageDef.rollMs ?? Math.min(stageDef.tickMs - 200, 1000);
    this.gridW = stageDef.gridW ?? GRID_W;
    // Platform depth includes every wave's footprint up front: the runway
    // behind the player is as long at stage start as it would be after
    // clearing every wave one-by-one. Cubes still spawn at the new back
    // edge, so later waves have a longer approach.
    const baseGridD = stageDef.gridD ?? GRID_D;
    const waveDepthSum = (stageDef.waves ?? []).reduce(
      (s, w) => s + (w.layout?.length ?? 0), 0,
    );
    this.gridD = baseGridD + waveDepthSum;
    this.nextTickAt = 0;
    this.pendingRowDrop = 0;
    this.forbiddenFellOff = 0;
    // Player-held fast-forward multiplier. >1 = ticks fire and cubes roll
    // proportionally faster. Game updates this each frame from input state.
    this.speedMultiplier = 1;
  }

  // Spawn edge for a given wave: the gz at which this wave's frontmost
  // (closest-to-player) cube row sits. Wave N sits one layout-depth further
  // back than wave N-1, so each successive wave gets a longer runway in
  // front of it while the platform itself stays the same total depth.
  _waveSpawnEdge(waveIndex) {
    let depth = this.def.gridD ?? GRID_D;
    for (let i = 0; i < waveIndex; i++) {
      depth += this.def.waves[i].layout?.length ?? 0;
    }
    return depth;
  }

  // Spawn every wave's cubes up front, each tagged with its waveIndex.
  // Only the cubes whose waveIndex matches stage.waveIndex tick / are
  // capturable; later waves stand still as a visible wall preview.
  spawnAllWaves() {
    this.cubes = [];
    for (let w = 0; w < this.def.waves.length; w++) {
      const layout = this.def.waves[w].layout;
      const rows = layout.length;
      const spawnD = this._waveSpawnEdge(w);
      // First entry of layout = furthest back (last to arrive).
      // Last entry of layout = closest to player (first to arrive).
      // Layout row (rows - 1 - i) sits at gz = spawnD - 1 + i.
      for (let i = 0; i < rows; i++) {
        const rowStr = layout[rows - 1 - i];
        for (let x = 0; x < this.gridW && x < rowStr.length; x++) {
          const ch = rowStr[x];
          if (ch === "." || ch === " ") continue;
          if (ch !== CUBE_TYPE.NORMAL && ch !== CUBE_TYPE.FORBIDDEN && ch !== CUBE_TYPE.ADVANTAGE) continue;
          const cube = new Cube(ch, x, spawnD - 1 + i);
          cube.waveIndex = w;
          this.cubes.push(cube);
        }
      }
    }
    this.totalCubes = this.cubes.filter(c => c.waveIndex === 0).length;
  }

  startWave(now) {
    this.forbiddenDestroyed = false;
    this.floorLost = false;
    this.pendingRowDrop = 0;
    this.forbiddenFellOff = 0;
    this.totalCubes = this.cubes.filter(c => c.waveIndex === this.waveIndex && !c.dead).length;
    this.nextTickAt = now + this.tickMs;
  }

  hasMoreWaves() { return this.waveIndex < this.def.waves.length - 1; }
  advanceWave() { this.waveIndex++; }

  remainingCubes() {
    let n = 0;
    for (const c of this.cubes) {
      if (c.waveIndex === this.waveIndex && !c.dead) n++;
    }
    return n;
  }

  visibleCubes() {
    return this.cubes.filter(c => !c.dead);
  }

  activeCubeAt(x, z) {
    for (const c of this.cubes) {
      if (c.dead || c.fallingOff) continue;
      if (c.waveIndex !== this.waveIndex) continue;
      if (c.gx === x && c.gz === z) return c;
    }
    return null;
  }

  cubeAt(x, z) {
    const now = performance.now();
    for (const c of this.cubes) {
      if (c.dead || c.fallingOff) continue;
      if (c.gx === x && c.gz === z) return c;
      // A rolling cube updates gz to the new tile the instant the tick
      // fires, but its mesh takes the full roll duration to actually
      // clear the old tile. Keep that old tile blocked so the player
      // can't slip into a cube it's still visually rolling out of.
      if (c.roll && c.gx === x && c.roll.fromZ === z) {
        const u = (now - c.roll.t0) / c.roll.duration;
        if (u < 1) return c;
      }
    }
    return null;
  }

  // Lowest gz with any remaining tile - the platform's current front edge.
  frontEdge(grid) {
    for (let z = 0; z < this.gridD; z++) {
      for (let x = 0; x < this.gridW; x++) {
        if (grid.tiles[x][z]) return z;
      }
    }
    return this.gridD;
  }

  // Resolve a tick: advance every cube one row toward the player.
  // Triggers (K) are handled in Game._triggerMark in real time.
  tick(now, player, grid) {
    const events = {
      crushed: false,
      rowsDropped: 0,
      cubesFellInHole: 0,
      dangerNear: false,
    };

    const front = this.frontEdge(grid);

    for (const cube of this.cubes) {
      if (cube.dead || cube.fallingOff) continue;
      // Dormant: this cube belongs to a future wave and stands still as a
      // wall preview until its turn arrives.
      if (cube.waveIndex !== this.waveIndex) continue;
      const fromZ = cube.gz;
      const toZ = cube.gz - 1;

      // Still off-screen behind the back row: just slide forward, no checks.
      if (fromZ >= this.gridD) {
        cube.gz = toZ;
        if (toZ < this.gridD) cube.startRoll(fromZ, toZ, now, this.rollMs / this.speedMultiplier);
        continue;
      }

      // Past the front edge of the platform - cube has fallen off.
      if (toZ < front) {
        if (cube.isForbidden()) {
          // Tallied; at wave end each falling forbidden restores one missing
          // front row.
          this.forbiddenFellOff++;
        } else if (cube.isAdvantage()) {
          // No special effect.
        } else {
          // Normal: front row will drop, but the actual tile removal is queued
          // by Game so the player has time to run back off it.
          if (front < this.gridD) events.rowsDropped++;
        }
        // Visual: cube tumbles forward off the edge for ~700ms, then is reaped.
        cube.startFalling(now, 700);
        continue;
      }

      // Target tile is a hole within the platform: cube falls in harmlessly.
      if (!grid.hasTile(cube.gx, toZ)) {
        cube.dead = true;
        events.cubesFellInHole++;
        continue;
      }

      // Crush check has moved to Game's per-frame check at the roll's
      // halfway point - this gives the player half the roll to dodge.
      cube.gz = toZ;
      cube.startRoll(fromZ, toZ, now, this.rollMs / this.speedMultiplier);

      if (toZ <= front + 1) events.dangerNear = true;
    }

    return events;
  }

  isCleared() {
    for (const c of this.cubes) {
      if (c.waveIndex !== this.waveIndex) continue;
      if (!c.dead) return false;
    }
    return true;
  }

  perfect() {
    return !this.forbiddenDestroyed && !this.floorLost;
  }
}
