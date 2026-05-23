import { GRID_W, MOVE_COOLDOWN_MS, PLAYER_SLIDE_MS } from "./config.js?v=19";

export class Player {
  constructor() {
    this.gx = Math.floor(GRID_W / 2);
    this.gz = 0;
    this.prevGx = this.gx;
    this.prevGz = this.gz;
    this.slideT0 = 0;
    this.advantage = 0;
    this.lastMoveAt = 0;
    this.falling = false;
    this.fallT0 = 0;
    this.moveCooldownMs = MOVE_COOLDOWN_MS;
  }

  reset() {
    this.gx = Math.floor(GRID_W / 2);
    this.gz = 0;
    this.prevGx = this.gx;
    this.prevGz = this.gz;
    this.slideT0 = 0;
    this.advantage = 0;
    this.lastMoveAt = 0;
    this.falling = false;
    // moveCooldownMs is intentionally kept so debug-tuned speed survives restarts
  }

  tryMove(dx, dz, now, grid) {
    if (this.falling) return false;
    if (now - this.lastMoveAt < this.moveCooldownMs) return false;
    const nx = this.gx + dx;
    const nz = this.gz + dz;
    if (!grid.inBounds(nx, nz)) return false;

    // Slide source is the player's CURRENT visual position (which may be
    // mid-step if the previous slide hasn't finished). Storing it as a
    // float means the next slide starts exactly where the eye left off,
    // not from the snapped target tile.
    const u = this.slideProgress(now);
    this.prevGx = this.prevGx + (this.gx - this.prevGx) * u;
    this.prevGz = this.prevGz + (this.gz - this.prevGz) * u;
    this.gx = nx;
    this.gz = nz;
    this.slideT0 = now;
    this.lastMoveAt = now;
    return true;
  }

  slideProgress(now) {
    const u = (now - this.slideT0) / PLAYER_SLIDE_MS;
    return Math.max(0, Math.min(1, u));
  }

  startFall(now) {
    this.falling = true;
    this.fallT0 = now;
  }
}
