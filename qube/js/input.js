export class Input {
  constructor() {
    this.held = new Set();
    this.queue = [];
    this._onDown = (e) => this._down(e);
    this._onUp = (e) => this._up(e);
  }

  attach() {
    window.addEventListener("keydown", this._onDown);
    window.addEventListener("keyup", this._onUp);
  }

  detach() {
    window.removeEventListener("keydown", this._onDown);
    window.removeEventListener("keyup", this._onUp);
  }

  _down(e) {
    const k = e.key.toLowerCase();
    this.held.add(k);
    const actions = {
      "j": "mark",
      "k": "trigger",
      "enter": "start",
    };
    if (actions[k]) this.queue.push(actions[k]);
  }

  _up(e) {
    this.held.delete(e.key.toLowerCase());
  }

  axis() {
    let dx = 0, dz = 0;
    if (this.held.has("a") || this.held.has("arrowleft"))  dx -= 1;
    if (this.held.has("d") || this.held.has("arrowright")) dx += 1;
    if (this.held.has("w") || this.held.has("arrowup"))    dz += 1;
    if (this.held.has("s") || this.held.has("arrowdown"))  dz -= 1;
    if (dx !== 0 && dz !== 0) dz = 0;
    return { dx, dz };
  }

  consumeAction() {
    return this.queue.shift() ?? null;
  }

  clear() {
    this.queue.length = 0;
  }

  // Virtual input from on-screen touch controls.
  holdVirtual(name) { this.held.add(name); }
  releaseVirtual(name) { this.held.delete(name); }
  pushAction(name) { this.queue.push(name); }
}
