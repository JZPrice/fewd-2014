// Web Vibration API wrapper. No-ops where unsupported (iOS Safari) or when
// the user has prefers-reduced-motion set, or when explicitly disabled.

export class Haptics {
  constructor() {
    this.supported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    this.enabled = this.supported && !reduced;
  }

  setEnabled(v) {
    this.enabled = !!v && this.supported;
  }

  _vibe(pattern) {
    if (!this.enabled) return;
    try { navigator.vibrate(pattern); } catch (_) {}
  }

  // Discrete cues. Patterns are arrays [on, off, on, ...] in milliseconds.
  mark()       { this._vibe(10); }
  capture()    { this._vibe(22); }
  bombPlace()  { this._vibe([14, 24, 18]); }
  detonate()   { this._vibe([40, 30, 60, 30, 90]); }
  forbidden()  { this._vibe([60, 50, 90]); }
  death()      { this._vibe([180, 60, 120]); }
  perfect()    { this._vibe([15, 50, 15, 50, 15, 50, 30]); }
  danger()     { this._vibe(6); }
  rowDrop()    { this._vibe([30, 40, 50]); }
  step()       { this._vibe(4); }
}
