// Live debug panel: toggle with the DBG button or the backtick key.
// Lets you read game state and tune tickMs / rollMs without reloading.

export class Debugger {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this._build();
    this._wire();
  }

  _build() {
    const toggle = document.createElement("button");
    toggle.id = "dbg-toggle";
    toggle.textContent = "DBG";
    document.body.appendChild(toggle);
    this.toggle = toggle;

    const panel = document.createElement("div");
    panel.id = "dbg-panel";
    panel.innerHTML = `
      <div class="dbg-head">
        <span>DEBUG</span><button data-act="close" class="dbg-x">×</button>
      </div>
      <div class="dbg-stat"><span>state</span><b id="dbg-state">—</b></div>
      <div class="dbg-stat"><span>stage / wave</span><b id="dbg-sw">—</b></div>
      <div class="dbg-stat"><span>cubes left</span><b id="dbg-cubes">—</b></div>
      <div class="dbg-stat"><span>bombs</span><b id="dbg-bombs">—</b></div>
      <div class="dbg-stat"><span>row drop pending</span><b id="dbg-drop">—</b></div>
      <div class="dbg-stat"><span>player</span><b id="dbg-player">—</b></div>
      <div class="dbg-stat"><span>mark</span><b id="dbg-mark">—</b></div>
      <div class="dbg-stat"><span>next tick</span><b id="dbg-next">—</b></div>
      <div class="dbg-sep"></div>
      <div class="dbg-stat">
        <span>tickMs</span>
        <span class="dbg-tune">
          <button data-act="tick--">−100</button>
          <b id="dbg-tickms">—</b>
          <button data-act="tick++">+100</button>
        </span>
      </div>
      <div class="dbg-stat">
        <span>rollMs</span>
        <span class="dbg-tune">
          <button data-act="roll--">−100</button>
          <b id="dbg-rollms">—</b>
          <button data-act="roll++">+100</button>
        </span>
      </div>
      <div class="dbg-stat">
        <span>extraPauseMs</span>
        <span class="dbg-tune">
          <button data-act="ep--">−100</button>
          <b id="dbg-epms">—</b>
          <button data-act="ep++">+100</button>
        </span>
      </div>
      <div class="dbg-stat">
        <span>pause / roll ratio</span>
        <b id="dbg-ratio">—</b>
      </div>
      <div class="dbg-sep"></div>
      <div class="dbg-row">
        <button data-act="pause" id="dbg-pause">pause</button>
        <button data-act="step">step</button>
      </div>
      <div class="dbg-row">
        <button data-act="restart">restart</button>
        <button data-act="skipwave">skip wave</button>
      </div>
    `;
    panel.style.display = "none";
    document.body.appendChild(panel);
    this.panel = panel;
  }

  _wire() {
    this.toggle.addEventListener("click", () => this.setVisible(!this.visible));
    this.panel.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      if (act) this._do(act);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "`" || e.key === "~") this.setVisible(!this.visible);
    });
  }

  setVisible(v) {
    this.visible = v;
    this.panel.style.display = v ? "block" : "none";
    this.toggle.classList.toggle("on", v);
  }

  _do(act) {
    const g = this.game;
    const s = g.stage;
    if (act === "close") { this.setVisible(false); return; }
    if (!s && act !== "restart") return;
    switch (act) {
      case "tick++": s.tickMs += 100; break;
      case "tick--": s.tickMs = Math.max(200, s.tickMs - 100); break;
      case "roll++": s.rollMs = Math.min(s.tickMs, s.rollMs + 100); break;
      case "roll--": s.rollMs = Math.max(100, s.rollMs - 100); break;
      case "ep++": s.extraPauseMs = (s.extraPauseMs ?? (s.tickMs - s.rollMs)) + 100; break;
      case "ep--": s.extraPauseMs = Math.max(0, (s.extraPauseMs ?? (s.tickMs - s.rollMs)) - 100); break;
      case "pause":  g.togglePaused(); break;
      case "step":   g.stepRequested = true; break;
      case "restart": g.start(); break;
      case "skipwave":
        if (s) for (const c of s.cubes) c.dead = true;
        break;
    }
  }

  update() {
    if (!this.visible) return;
    const g = this.game;
    const s = g.stage;
    const $ = (id) => document.getElementById(id);

    $("dbg-state").textContent = g.paused ? `${g.state} (PAUSED)` : g.state;
    if (s) {
      $("dbg-sw").textContent = `${s.def.id} / ${s.waveIndex + 1}`;
      $("dbg-cubes").textContent = s.remainingCubes();
      $("dbg-bombs").textContent = g.grid.bombs.length;
      $("dbg-drop").textContent = s.pendingRowDrop ?? 0;
      $("dbg-tickms").textContent = `${s.tickMs}ms`;
      $("dbg-rollms").textContent = `${s.rollMs}ms`;
      const ep = s.extraPauseMs ?? (s.tickMs - s.rollMs);
      $("dbg-epms").textContent = `${ep}ms`;
      const pause = Math.max(0, s.tickMs - s.rollMs);
      $("dbg-ratio").textContent = `${(s.rollMs/1000).toFixed(2)}s roll + ${(pause/1000).toFixed(2)}s pause`;
      const next = Math.max(0, (s.nextTickAt - performance.now()) / 1000);
      $("dbg-next").textContent = `${next.toFixed(2)}s`;
    }
    const p = g.player;
    $("dbg-player").textContent = `(${p.gx}, ${p.gz})`;
    const m = g.grid.mark;
    $("dbg-mark").textContent = m ? `(${m.x}, ${m.z})` : "—";

    $("dbg-pause").textContent = g.paused ? "resume" : "pause";
  }
}
