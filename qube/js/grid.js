import { GRID_W, GRID_D } from "./config.js";

export class Grid {
  constructor() {
    this.w = GRID_W;
    this.d = GRID_D;
    this.tiles = [];
    this.mark = null;
    this.advMark = null;
    this.reset();
  }

  reset() {
    this.tiles = Array.from({ length: this.w }, () => new Array(this.d).fill(true));
    this.mark = null;
    this.advMark = null;
  }

  inBounds(x, z) {
    return x >= 0 && x < this.w && z >= 0 && z < this.d;
  }

  hasTile(x, z) {
    return this.inBounds(x, z) && this.tiles[x][z];
  }

  removeTile(x, z) {
    if (this.inBounds(x, z)) this.tiles[x][z] = false;
  }

  restoreBackRow() {
    const z = this.d - 1;
    let restored = false;
    for (let x = 0; x < this.w; x++) {
      if (!this.tiles[x][z]) { this.tiles[x][z] = true; restored = true; }
    }
    return restored;
  }

  setMark(x, z) {
    if (!this.hasTile(x, z)) return false;
    this.mark = { x, z };
    return true;
  }

  clearMark() {
    this.mark = null;
  }

  setAdvMark(cx, cz) {
    this.advMark = { cx, cz };
  }

  clearAdvMark() {
    this.advMark = null;
  }

  inAdvMark(x, z) {
    if (!this.advMark) return false;
    return Math.abs(x - this.advMark.cx) <= 1 && Math.abs(z - this.advMark.cz) <= 1;
  }
}
