export class Input {
  constructor() {
    this.held = new Set();
    this.queue = [];
    this.virtualAxis = { dx: 0, dz: 0 };
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
      "l": "detonate",
      "enter": "start",
    };
    if (actions[k]) this.queue.push(actions[k]);
  }

  _up(e) {
    this.held.delete(e.key.toLowerCase());
  }

  axis() {
    // Joystick (analog) wins when it's actively pushed. Returns float
    // components in [-1, 1] so the player class can scale velocity.
    const va = this.virtualAxis;
    if (va.dx !== 0 || va.dz !== 0) return { dx: va.dx, dz: va.dz };
    let dx = 0, dz = 0;
    if (this.held.has("a") || this.held.has("arrowleft"))  dx -= 1;
    if (this.held.has("d") || this.held.has("arrowright")) dx += 1;
    if (this.held.has("w") || this.held.has("arrowup"))    dz += 1;
    if (this.held.has("s") || this.held.has("arrowdown"))  dz -= 1;
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
  setVirtualAxis(dx, dz) { this.virtualAxis.dx = dx; this.virtualAxis.dz = dz; }
}
