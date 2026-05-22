// Web Vibration API wrapper. Tracks the last call so the debug panel can
// show whether navigator.vibrate is actually firing.
//
// Known no-op environments:
//   - iOS Safari (Apple blocks the API)
//   - Chrome on iOS (uses Safari renderer underneath)
//   - Any desktop browser without a vibration motor (Chrome / Firefox / etc.)
//   - Android battery saver / system "vibration off"
//   - prefers-reduced-motion: reduce
//
// Patterns are intentionally >=30ms because Android motors often ignore
// anything shorter than the time it takes them to spin up.

export class Haptics {
  constructor() {
    this.supported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    this.enabled = this.supported && !reduced;

    this.lastPattern = null;
    this.lastResult = null;
    this.lastTime = 0;
    this.lastError = null;
  }

  setEnabled(v) { this.enabled = !!v && this.supported; }

  _vibe(pattern) {
    if (!this.enabled) {
      this.lastPattern = pattern;
      this.lastResult = "disabled";
      this.lastTime = Date.now();
      return;
    }
    this.lastPattern = pattern;
    this.lastTime = Date.now();
    this.lastError = null;
    try {
      const result = navigator.vibrate(pattern);
      this.lastResult = result === true ? "accepted" : result === false ? "rejected" : String(result);
    } catch (e) {
      this.lastResult = "threw";
      this.lastError = e?.message ?? String(e);
    }
  }

  test()       { this._vibe([60, 60, 120, 60, 220]); }
  mark()       { this._vibe(35); }
  capture()    { this._vibe(55); }
  bombPlace()  { this._vibe([40, 50, 60]); }
  detonate()   { this._vibe([80, 60, 120, 60, 220]); }
  forbidden()  { this._vibe([120, 80, 180]); }
  death()      { this._vibe([260, 80, 200]); }
  perfect()    { this._vibe([40, 80, 40, 80, 40, 80, 80]); }
  danger()     { this._vibe(30); }
  rowDrop()    { this._vibe([50, 70, 80]); }
}
