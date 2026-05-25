import { GRID_W } from "./config.js?v=136";

// Continuous-position player. Position is stored as float grid coords
// (gx, gz) and advanced each frame by a real velocity. tx / tz are the
// discrete tile the player's center is in, used for game logic (mark
// placement, crush checks, fall-through detection, etc.).
export class Player {
  constructor() {
    this.gx = Math.floor(GRID_W / 2);
    this.gz = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 4.5;        // tiles per second (default ~222ms per tile)
    this.lastMoveAt = 0;     // used by the renderer for leg animation
    this.falling = false;
    this.fallT0 = 0;
  }

  // gridW lets the player spawn centered on the stage's actual width
  // (4-wide / 5-wide / 6-wide stages all spawn the player middle).
  reset(gridW = GRID_W) {
    this.gx = Math.floor(gridW / 2);
    this.gz = 0;
    this.vx = 0;
    this.vz = 0;
    this.lastMoveAt = 0;
    this.falling = false;
    // speed is intentionally preserved across restarts so debug tuning sticks
  }

  get tx() { return Math.round(this.gx); }
  get tz() { return Math.round(this.gz); }

  // Intent components are in [-1, 1]. Magnitude scales speed (so a half-push
  // on the joystick moves the player at half speed); direction is normalized
  // so diagonals aren't faster than cardinals.
  setIntent(dx, dz) {
    const mag = Math.hypot(dx, dz);
    if (mag === 0) {
      this.vx = 0;
      this.vz = 0;
    } else {
      const m = Math.min(1, mag);
      const dirX = dx / mag, dirZ = dz / mag;
      this.vx = dirX * this.speed * m;
      this.vz = dirZ * this.speed * m;
    }
  }

  update(dtSec, now, grid, stage) {
    if (this.falling) return;
    if (this.vx === 0 && this.vz === 0) return;
    let moved = false;
    if (this._stepAxis("gx", "gz", this.vx * dtSec, grid, stage)) moved = true;
    if (this._stepAxis("gz", "gx", this.vz * dtSec, grid, stage)) moved = true;
    if (moved) this.lastMoveAt = now;
  }

  // Move along one axis, clamping at the boundary of the current tile if
  // the target tile is blocked. This is what produces the slide-along-wall
  // feel - each axis resolves independently.
  _stepAxis(moveAxis, fixedAxis, delta, grid, stage) {
    if (delta === 0) return false;
    const newPos = this[moveAxis] + delta;
    const newTile = Math.round(newPos);
    const fixedTile = Math.round(this[fixedAxis]);
    const tx = moveAxis === "gx" ? newTile : fixedTile;
    const tz = moveAxis === "gz" ? newTile : fixedTile;
    if (this._canStandAt(tx, tz, grid, stage)) {
      this[moveAxis] = newPos;
      return true;
    }
    // Blocked. Clamp to just inside the current tile so the player butts
    // up against the obstacle but never crosses the half-tile boundary.
    const curTile = Math.round(this[moveAxis]);
    const limit = delta > 0 ? curTile + 0.499 : curTile - 0.499;
    const before = this[moveAxis];
    this[moveAxis] = delta > 0 ? Math.min(newPos, limit) : Math.max(newPos, limit);
    return this[moveAxis] !== before;
  }

  _canStandAt(tx, tz, grid, stage) {
    if (!grid.inBounds(tx, tz)) return false;
    if (!grid.hasTile(tx, tz)) return false;
    if (stage && stage.cubeAt(tx, tz)) return false;
    return true;
  }

  startFall(now) {
    this.falling = true;
    this.fallT0 = now;
  }
}
