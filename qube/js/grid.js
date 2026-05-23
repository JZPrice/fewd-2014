import { GRID_W, GRID_D } from "./config.js?v=22";

export class Grid {
  constructor() {
    this.w = GRID_W;
    this.d = GRID_D;
    this.tiles = [];
    this.mark = null;
    this.bombs = [];
    this.reset();
  }

  reset() {
    this.tiles = Array.from({ length: this.w }, () => new Array(this.d).fill(true));
    this.mark = null;
    this.bombs = [];
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

  removeBackRow() {
    const z = this.d - 1;
    let removed = false;
    for (let x = 0; x < this.w; x++) {
      if (this.tiles[x][z]) { this.tiles[x][z] = false; removed = true; }
    }
    return removed;
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

  addBomb(cx, cz) {
    this.bombs.push({ cx, cz, id: Math.random().toString(36).slice(2, 8) });
  }

  clearBombs() {
    this.bombs = [];
  }

  removeBombsWhere(pred) {
    this.bombs = this.bombs.filter(b => !pred(b));
  }

  inAnyBomb(x, z) {
    for (const b of this.bombs) {
      if (Math.abs(x - b.cx) <= 1 && Math.abs(z - b.cz) <= 1) return true;
    }
    return false;
  }
}
