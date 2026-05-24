import { CUBE_TYPE } from "./config.js?v=42";

let nextId = 1;

export class Cube {
  constructor(type, gx, gz) {
    this.id = nextId++;
    this.type = type;
    this.gx = gx;
    this.gz = gz;
    this.roll = null;
    this.dead = false;
    // When a cube rolls past the front edge it enters a "falling off"
    // animation state instead of vanishing instantly: it tumbles forward
    // and drops out of view, then is reaped.
    this.fallingOff = false;
    this.fallOffT0 = 0;
    this.fallOffDuration = 0;
  }

  isForbidden() { return this.type === CUBE_TYPE.FORBIDDEN; }
  isAdvantage() { return this.type === CUBE_TYPE.ADVANTAGE; }

  startRoll(fromZ, toZ, t0, duration) {
    this.roll = { fromZ, toZ, t0, duration };
  }

  rollProgress(now) {
    if (!this.roll) return null;
    const u = (now - this.roll.t0) / this.roll.duration;
    return Math.max(0, Math.min(1, u));
  }

  finishRoll() {
    this.roll = null;
  }

  startFalling(now, durationMs) {
    this.fallingOff = true;
    this.fallOffT0 = now;
    this.fallOffDuration = durationMs;
  }

  fallOffProgress(now) {
    if (!this.fallingOff) return null;
    const u = (now - this.fallOffT0) / this.fallOffDuration;
    return Math.max(0, Math.min(1, u));
  }
}
