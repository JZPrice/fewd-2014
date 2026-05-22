export class HUD {
  constructor() {
    this.stageEl = document.getElementById("hud-stage");
    this.waveEl = document.getElementById("hud-wave");
    this.cubesEl = document.getElementById("hud-cubes");
    this.bombsEl = document.getElementById("hud-bombs");
    this.titleEl = document.getElementById("title");
    this.gameoverEl = document.getElementById("gameover");
    this.gameoverReason = document.getElementById("gameover-reason");
    this.messageEl = document.getElementById("message");
    this._msgTimeout = 0;
  }

  setStage(n) { this.stageEl.textContent = String(n); }
  setWave(n) { this.waveEl.textContent = String(n); }
  setCubes(n) { this.cubesEl.textContent = String(n); }
  setBombs(n) { if (this.bombsEl) this.bombsEl.textContent = String(n); }

  showTitle()    { this.titleEl.classList.remove("hidden"); }
  hideTitle()    { this.titleEl.classList.add("hidden"); }
  showGameOver(reason) {
    this.gameoverReason.textContent = reason ?? "";
    this.gameoverEl.classList.remove("hidden");
  }
  hideGameOver() { this.gameoverEl.classList.add("hidden"); }

  flash(text, ms = 1200) {
    this.messageEl.textContent = text;
    this.messageEl.classList.remove("hidden");
    this.messageEl.style.animation = "none";
    void this.messageEl.offsetWidth;
    this.messageEl.style.animation = "";
    clearTimeout(this._msgTimeout);
    this._msgTimeout = setTimeout(() => {
      this.messageEl.classList.add("hidden");
    }, ms);
  }
}
