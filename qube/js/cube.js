import { CUBE_TYPE } from "./config.js?v=20";

let nextId = 1;

export class Cube {
  constructor(type, gx, gz) {
    this.id = nextId++;
    this.type = type;
    this.gx = gx;
    this.gz = gz;
    this.roll = null;
    this.dead = false;
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
}
