import { Cube } from "./cube.js?v=13";
import { CUBE_TYPE, GRID_W, GRID_D, FORBIDDEN_HOLE_DEPTH } from "./config.js?v=13";

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
    this.nextTickAt = 0;
    this.pendingRowDrop = 0;
  }

  startWave(now) {
    const wave = this.def.waves[this.waveIndex];
    const layout = wave.layout;
    this.cubes = [];
    this.forbiddenDestroyed = false;
    this.floorLost = false;
    this.pendingRowDrop = 0;
    const rows = layout.length;
    // First entry of layout = furthest back (last to arrive).
    // Last entry of layout = closest to player (first to arrive).
    // Layout row (rows - 1 - i) sits at gz = GRID_D - 1 + i.
    for (let i = 0; i < rows; i++) {
      const rowStr = layout[rows - 1 - i];
      for (let x = 0; x < GRID_W && x < rowStr.length; x++) {
        const ch = rowStr[x];
        if (ch === "." || ch === " ") continue;
        if (ch !== CUBE_TYPE.NORMAL && ch !== CUBE_TYPE.FORBIDDEN && ch !== CUBE_TYPE.ADVANTAGE) continue;
        this.cubes.push(new Cube(ch, x, GRID_D - 1 + i));
      }
    }
    this.totalCubes = this.cubes.length;
    this.nextTickAt = now + this.tickMs;
  }

  hasMoreWaves() { return this.waveIndex < this.def.waves.length - 1; }
  advanceWave() { this.waveIndex++; }

  remainingCubes() {
    let n = 0;
    for (const c of this.cubes) if (!c.dead) n++;
    return n;
  }

  visibleCubes() {
    return this.cubes.filter(c => !c.dead);
  }

  cubeAt(x, z) {
    for (const c of this.cubes) {
      if (!c.dead && c.gx === x && c.gz === z) return c;
    }
    return null;
  }

  // Resolve a tick: advance every cube one row toward the player.
  // Triggers (K) are handled in Game._triggerMark in real time.
  tick(now, player, grid) {
    const events = {
      crushed: false,
      fellOff: false,
      cubesFellInHole: 0,
      dangerNear: false,
    };

    for (const cube of this.cubes) {
      if (cube.dead) continue;
      const fromZ = cube.gz;
      const toZ = cube.gz - 1;

      // Still off-screen behind the back row: just slide forward, no checks.
      if (fromZ >= GRID_D) {
        cube.gz = toZ;
        if (toZ < GRID_D) cube.startRoll(fromZ, toZ, now, this.rollMs);
        continue;
      }

      // Target tile is a hole: cube falls in harmlessly.
      if (toZ >= 0 && !grid.hasTile(cube.gx, toZ)) {
        cube.dead = true;
        events.cubesFellInHole++;
        continue;
      }

      // Past front row.
      if (toZ < 0) {
        if (cube.isForbidden()) {
          // Forbidden cubes are meant to be ignored - they roll off the
          // front harmlessly, no death, just gone.
          cube.dead = true;
        } else {
          // Normal / advantage cubes falling off past the player = death.
          events.fellOff = true;
        }
        continue;
      }

      // Crush check has moved to Game's per-frame check at the roll's
      // halfway point - this gives the player half the roll to dodge.
      cube.gz = toZ;
      cube.startRoll(fromZ, toZ, now, this.rollMs);

      if (toZ <= 1) events.dangerNear = true;
    }

    return events;
  }

  isCleared() {
    for (const c of this.cubes) if (!c.dead) return false;
    return true;
  }

  perfect() {
    return !this.forbiddenDestroyed && !this.floorLost;
  }
}
