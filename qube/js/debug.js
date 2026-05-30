// Live debug panel. Toggle with the DBG button or backtick.
// Organized into collapsible sections; only Status is expanded by default.
// The panel is also scrollable, so even a fully-expanded panel fits on
// short screens.

import { STAGES } from "./stages.js?v=154";
import { getMobModel, setMobModel } from "./stage.js?v=154";
import { CHARACTERS } from "./characters.js?v=154";

export class Debugger {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this._build();
    this._buildJumpGrid();
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
      <div id="dbg-scroll">

        <div class="dbg-section dbg-expanded" data-sec="status">
          <button class="dbg-section-head">Status</button>
          <div class="dbg-section-body">
            <div class="dbg-stat"><span>state</span><b id="dbg-state">—</b></div>
            <div class="dbg-stat"><span>stage / wave</span><b id="dbg-sw">—</b></div>
            <div class="dbg-stat"><span>cubes left</span><b id="dbg-cubes">—</b></div>
            <div class="dbg-stat"><span>bombs</span><b id="dbg-bombs">—</b></div>
            <div class="dbg-stat"><span>drop queue</span><b id="dbg-drop">—</b></div>
            <div class="dbg-stat"><span>player</span><b id="dbg-player">—</b></div>
            <div class="dbg-stat"><span>mark</span><b id="dbg-mark">—</b></div>
            <div class="dbg-stat"><span>next tick</span><b id="dbg-next">—</b></div>
          </div>
        </div>

        <div class="dbg-section" data-sec="pacing">
          <button class="dbg-section-head">Pacing</button>
          <div class="dbg-section-body">
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
            <div class="dbg-stat"><span>pause / roll</span><b id="dbg-ratio">—</b></div>
          </div>
        </div>

        <div class="dbg-section" data-sec="player">
          <button class="dbg-section-head">Player</button>
          <div class="dbg-section-body">
            <div class="dbg-stat">
              <span>speed (ms/tile)</span>
              <span class="dbg-tune">
                <button data-act="spd--">−20</button>
                <b id="dbg-spd">—</b>
                <button data-act="spd++">+20</button>
              </span>
            </div>
          </div>
        </div>

        <div class="dbg-section" data-sec="camera">
          <button class="dbg-section-head">Camera</button>
          <div class="dbg-section-body">
            <div class="dbg-stat">
              <span>halflife (ms)</span>
              <span class="dbg-tune">
                <button data-act="cam--">−50</button>
                <b id="dbg-cam">—</b>
                <button data-act="cam++">+50</button>
              </span>
            </div>
            <div class="dbg-stat"><span>last shake</span><b id="dbg-shake">—</b></div>
            <div class="dbg-row">
              <button data-act="shaketest">shake test</button>
            </div>
          </div>
        </div>

        <div class="dbg-section" data-sec="framing">
          <button class="dbg-section-head">Framing</button>
          <div class="dbg-section-body">
            <div class="dbg-stat">
              <span>fov</span>
              <span class="dbg-tune">
                <button data-act="fov--">−1</button>
                <b id="dbg-fov">—</b>
                <button data-act="fov++">+1</button>
              </span>
            </div>
            <div class="dbg-stat">
              <span>camY</span>
              <span class="dbg-tune">
                <button data-act="camy--">−0.2</button>
                <b id="dbg-camy">—</b>
                <button data-act="camy++">+0.2</button>
              </span>
            </div>
            <div class="dbg-stat">
              <span>followDZ</span>
              <span class="dbg-tune">
                <button data-act="dz--">−0.2</button>
                <b id="dbg-dz">—</b>
                <button data-act="dz++">+0.2</button>
              </span>
            </div>
            <div class="dbg-stat">
              <span>lookY</span>
              <span class="dbg-tune">
                <button data-act="looky--">−0.2</button>
                <b id="dbg-looky">—</b>
                <button data-act="looky++">+0.2</button>
              </span>
            </div>
            <div class="dbg-row">
              <button data-act="copyframing" id="dbg-copyframing">copy framing</button>
            </div>
          </div>
        </div>

        <div class="dbg-section" data-sec="haptics">
          <button class="dbg-section-head">Haptics</button>
          <div class="dbg-section-body">
            <div class="dbg-row">
              <button data-act="hap" id="dbg-hap">haptics: —</button>
              <button data-act="haptest">test</button>
            </div>
            <div class="dbg-stat"><span>vibrate API</span><b id="dbg-hap-api">—</b></div>
            <div class="dbg-stat"><span>last call</span><b id="dbg-hap-last">—</b></div>
          </div>
        </div>

        <div class="dbg-section" data-sec="mobs">
          <button class="dbg-section-head">Mobs</button>
          <div class="dbg-section-body">
            <div class="dbg-stat">
              <span>S spawns</span>
              <span class="dbg-tune">
                <button data-act="mob--">◀</button>
                <b id="dbg-mob">—</b>
                <button data-act="mob++">▶</button>
              </span>
            </div>
            <div class="dbg-stat dbg-hint">
              restart the wave for the change to take effect
            </div>
          </div>
        </div>

        <div class="dbg-section" data-sec="actions">
          <button class="dbg-section-head">Actions</button>
          <div class="dbg-section-body">
            <div class="dbg-row">
              <button data-act="pause" id="dbg-pause">pause</button>
              <button data-act="step">step</button>
            </div>
            <div class="dbg-row">
              <button data-act="restart">restart</button>
              <button data-act="skipwave">skip wave</button>
            </div>
            <div class="dbg-row">
              <button data-act="copy" id="dbg-copy">copy state</button>
            </div>
          </div>
        </div>

        <div class="dbg-section" data-sec="jump">
          <button class="dbg-section-head">Jump to stage / wave</button>
          <div class="dbg-section-body" id="dbg-jump-grid"></div>
        </div>

      </div>
    `;
    panel.style.display = "none";
    document.body.appendChild(panel);
    this.panel = panel;
  }

  _wire() {
    this.toggle.addEventListener("click", () => this.setVisible(!this.visible));
    this.panel.addEventListener("click", (e) => {
      // Section headers toggle expansion.
      const head = e.target.closest(".dbg-section-head");
      if (head) {
        head.parentElement.classList.toggle("dbg-expanded");
        return;
      }
      const act = e.target?.dataset?.act;
      if (act) this._do(act, e.target);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "`" || e.key === "~") this.setVisible(!this.visible);
    });
  }

  // One row per stage, one button per wave. Labels show "S{n} W{m}" so the
  // mapping is obvious even when stage IDs and indexes don't line up.
  _buildJumpGrid() {
    const host = document.getElementById("dbg-jump-grid");
    if (!host) return;
    for (let si = 0; si < STAGES.length; si++) {
      const stage = STAGES[si];
      const row = document.createElement("div");
      row.className = "dbg-row";
      for (let wi = 0; wi < stage.waves.length; wi++) {
        const b = document.createElement("button");
        b.dataset.act = "jump";
        b.dataset.stage = String(si);
        b.dataset.wave = String(wi);
        b.textContent = `S${stage.id} W${wi + 1}`;
        row.appendChild(b);
      }
      host.appendChild(row);
    }
  }

  setVisible(v) {
    this.visible = v;
    this.panel.style.display = v ? "block" : "none";
    this.toggle.classList.toggle("on", v);
  }

  _do(act, target) {
    const g = this.game;
    const s = g.stage;
    if (act === "close") { this.setVisible(false); return; }
    if (act === "jump") {
      const si = parseInt(target?.dataset?.stage ?? "", 10);
      const wi = parseInt(target?.dataset?.wave ?? "", 10);
      if (!Number.isNaN(si) && !Number.isNaN(wi)) g.jumpTo(si, wi);
      return;
    }
    if (!s && act !== "restart") return;
    switch (act) {
      case "tick++": s.tickMs += 100; break;
      case "tick--": s.tickMs = Math.max(200, s.tickMs - 100); break;
      case "roll++": s.rollMs = Math.min(s.tickMs, s.rollMs + 100); break;
      case "roll--": s.rollMs = Math.max(100, s.rollMs - 100); break;
      case "ep++": s.extraPauseMs = (s.extraPauseMs ?? (s.tickMs - s.rollMs)) + 100; break;
      case "ep--": s.extraPauseMs = Math.max(0, (s.extraPauseMs ?? (s.tickMs - s.rollMs)) - 100); break;
      case "spd--": g.player.speed = Math.max(0.5, g.player.speed - 0.5); break;
      case "spd++": g.player.speed = Math.min(20,  g.player.speed + 0.5); break;
      case "cam--": g.renderer.followHalflife = Math.max(50,   (g.renderer.followHalflife ?? 300) - 50); break;
      case "cam++": g.renderer.followHalflife = Math.min(1500, (g.renderer.followHalflife ?? 300) + 50); break;
      // Tune the DEFAULT preset; the renderer lerps from _default* to
      // _tight* each frame so writing to the live _baseCamY etc gets
      // immediately clobbered.
      case "fov--": g.renderer._defaultFov = Math.max(20,  (g.renderer._defaultFov ?? 50) - 1); break;
      case "fov++": g.renderer._defaultFov = Math.min(120, (g.renderer._defaultFov ?? 50) + 1); break;
      case "camy--": g.renderer._defaultCamY = Math.max(0.5, (g.renderer._defaultCamY ?? 5) - 0.2); break;
      case "camy++": g.renderer._defaultCamY = Math.min(20,  (g.renderer._defaultCamY ?? 5) + 0.2); break;
      case "dz--": g.renderer._defaultFollowDZ = Math.max(0.5, (g.renderer._defaultFollowDZ ?? 6) - 0.2); break;
      case "dz++": g.renderer._defaultFollowDZ = Math.min(20,  (g.renderer._defaultFollowDZ ?? 6) + 0.2); break;
      case "looky--": g.renderer._defaultLookY = (g.renderer._defaultLookY ?? -3.5) - 0.2; break;
      case "looky++": g.renderer._defaultLookY = (g.renderer._defaultLookY ?? -3.5) + 0.2; break;
      case "copyframing": this._copyFraming(); break;
      case "shaketest": g.renderer.shake?.(0.20, 280); break;
      case "mob--": this._cycleMob(-1); break;
      case "mob++": this._cycleMob(+1); break;
      case "copy":  this._copyState(); break;
      case "hap":
        if (g.haptics) {
          g.haptics.setEnabled(!g.haptics.enabled);
          if (g.haptics.enabled) g.haptics.test();
        }
        break;
      case "haptest":
        if (g.haptics) {
          const wasEnabled = g.haptics.enabled;
          if (g.haptics.supported) g.haptics.setEnabled(true);
          g.haptics.test();
          if (!wasEnabled) g.haptics.setEnabled(false);
        }
        break;
      case "pause":  g.togglePaused(); break;
      case "step":   g.stepRequested = true; break;
      case "restart": g.start(); break;
      case "skipwave":
        if (s) for (const c of s.cubes) c.dead = true;
        break;
    }
  }

  _cycleMob(dir) {
    const ids = CHARACTERS.map(c => c.id);
    const cur = getMobModel();
    const i = ids.indexOf(cur);
    const next = ids[((i < 0 ? 0 : i) + dir + ids.length) % ids.length];
    setMobModel(next);
  }

  _copyFraming() {
    const r = this.game.renderer;
    if (!r) return;
    const text = `fov: ${(r._defaultFov ?? 0).toFixed(0)}, camY: ${(r._defaultCamY ?? 0).toFixed(2)}, followDZ: ${(r._defaultFollowDZ ?? 0).toFixed(2)}, lookY: ${(r._defaultLookY ?? 0).toFixed(2)}`;
    const btn = document.getElementById("dbg-copyframing");
    const flash = (msg) => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = orig; }, 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => flash("copied!"))
        .catch(() => flash("copy failed - see console"));
    } else {
      flash("clipboard n/a");
    }
    console.log(text);
  }

  _copyState() {
    const g = this.game;
    const s = g.stage;
    const hap = g.haptics;
    const now = performance.now();
    const next = s ? Math.max(0, (s.nextTickAt - now) / 1000) : null;
    const lines = [
      `qube state @ ${new Date().toISOString()}`,
      `  url:    ${location.href}`,
      `  ua:     ${navigator.userAgent}`,
      `  vw:     ${window.innerWidth}x${window.innerHeight}`,
      `  state:  ${g.paused ? g.state + " (PAUSED)" : g.state}`,
      `  stage:  ${s?.def?.id ?? "—"}  wave: ${s ? s.waveIndex + 1 : "—"}`,
      `  cubes:  ${s?.remainingCubes?.() ?? "—"}  bombs: ${g.grid.bombs.length}`,
      `  next:   ${next?.toFixed?.(2) ?? "—"}s`,
      `  tickMs: ${s?.tickMs ?? "—"}  rollMs: ${s?.rollMs ?? "—"}  extraPauseMs: ${s?.extraPauseMs ?? (s ? s.tickMs - s.rollMs : "—")}`,
      `  speed:  ${(1000 / g.player.speed).toFixed(0)}ms/tile  (${g.player.speed.toFixed(1)} t/s)`,
      `  cam:    halflife=${g.renderer.followHalflife ?? 300}ms  lastShake=${g.renderer._lastShake ? `amp ${g.renderer._lastShake.amp.toFixed(2)} dur ${g.renderer._lastShake.durMs}ms` : "—"}`,
      `  pos:    (${g.player.gx.toFixed(2)}, ${g.player.gz.toFixed(2)})  tile: (${g.player.tx}, ${g.player.tz})  mark: ${g.grid.mark ? `(${g.grid.mark.x}, ${g.grid.mark.z})` : "—"}`,
      `  drop:   queue=${g._dropQueue ?? 0}  dropPauseMs=${g.dropPauseMs}  forbiddenDestroyed=${s?.forbiddenDestroyed ?? false}  floorLost=${s?.floorLost ?? false}`,
      `  haptics: ${!hap ? "no engine" : !hap.supported ? "n/a" : hap.enabled ? "ON" : "off"}`,
      `  last vibe: ${hap?.lastPattern ? (Array.isArray(hap.lastPattern) ? "["+hap.lastPattern.join(",")+"]" : hap.lastPattern+"ms") + " -> " + hap.lastResult : "—"}`,
    ];
    const text = lines.join("\n");
    const flash = (msg) => {
      const btn = document.getElementById("dbg-copy");
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = orig; }, 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => flash("copied!"))
        .catch(() => flash("copy failed - see console"));
    } else {
      flash("clipboard n/a");
    }
    console.log(text);
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
      $("dbg-drop").textContent = g._dropQueue ?? 0;
      $("dbg-tickms").textContent = `${s.tickMs}ms`;
      $("dbg-rollms").textContent = `${s.rollMs}ms`;
      const ep = s.extraPauseMs ?? (s.tickMs - s.rollMs);
      $("dbg-epms").textContent = `${ep}ms`;
      $("dbg-spd").textContent = `${(1000 / g.player.speed).toFixed(0)}ms/tile`;
      $("dbg-cam").textContent = `${g.renderer.followHalflife ?? 300}ms`;
      $("dbg-fov").textContent = (g.renderer._defaultFov ?? 0).toFixed(0);
      $("dbg-camy").textContent = (g.renderer._defaultCamY ?? 0).toFixed(2);
      $("dbg-dz").textContent = (g.renderer._defaultFollowDZ ?? 0).toFixed(2);
      $("dbg-looky").textContent = (g.renderer._defaultLookY ?? 0).toFixed(2);
      $("dbg-mob").textContent = getMobModel();
      const ls = g.renderer._lastShake;
      $("dbg-shake").textContent = ls
        ? `amp ${ls.amp.toFixed(2)} / ${ls.durMs}ms (${((Date.now() - ls.at) / 1000).toFixed(1)}s ago)`
        : "—";
      const pause = Math.max(0, s.tickMs - s.rollMs);
      $("dbg-ratio").textContent = `${(s.rollMs/1000).toFixed(2)}s + ${(pause/1000).toFixed(2)}s`;
      const next = Math.max(0, (s.nextTickAt - performance.now()) / 1000);
      $("dbg-next").textContent = `${next.toFixed(2)}s`;
    }
    const p = g.player;
    $("dbg-player").textContent = `(${p.gx.toFixed(2)}, ${p.gz.toFixed(2)})  tile (${p.tx},${p.tz})`;
    const m = g.grid.mark;
    $("dbg-mark").textContent = m ? `(${m.x}, ${m.z})` : "—";

    $("dbg-pause").textContent = g.paused ? "resume" : "pause";
    const hap = g.haptics;
    if (hap) {
      const label = !hap.supported ? "haptics: n/a"
                  : hap.enabled    ? "haptics: ON"
                                   : "haptics: off";
      $("dbg-hap").textContent = label;
      $("dbg-hap-api").textContent = hap.supported
        ? `present (${typeof navigator.vibrate})`
        : "absent on this browser";
      if (hap.lastTime) {
        const age = ((Date.now() - hap.lastTime) / 1000).toFixed(1);
        const pat = Array.isArray(hap.lastPattern)
          ? `[${hap.lastPattern.join(",")}]`
          : `${hap.lastPattern}ms`;
        const err = hap.lastError ? ` (${hap.lastError})` : "";
        $("dbg-hap-last").textContent = `${pat} -> ${hap.lastResult} ${age}s ago${err}`;
      } else {
        $("dbg-hap-last").textContent = "—";
      }
    }
  }
}
