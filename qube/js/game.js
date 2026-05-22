import { Grid } from "./grid.js?v=6";
import { Player } from "./player.js?v=6";
import { Stage } from "./stage.js?v=6";
import { STAGES } from "./stages.js?v=6";
import { FORBIDDEN_HOLE_DEPTH } from "./config.js?v=6";

const STATE = {
  TITLE: "title",
  PLAYING: "playing",
  WAVE_INTERMISSION: "wave_intermission",
  STAGE_INTERMISSION: "stage_intermission",
  DEAD: "dead",
  WIN: "win",
};

export class Game {
  constructor({ renderer, input, audio, hud }) {
    this.renderer = renderer;
    this.input = input;
    this.audio = audio;
    this.hud = hud;

    this.grid = new Grid();
    this.player = new Player();
    this.stageIndex = 0;
    this.stage = null;
    this.state = STATE.TITLE;
    this._intermissionUntil = 0;
    this._lastFrame = performance.now();
    this.paused = false;
    this.stepRequested = false;
    this._pausedAt = 0;
  }

  togglePaused() {
    if (this.paused) {
      if (this.stage) {
        this.stage.nextTickAt += performance.now() - this._pausedAt;
      }
      this.paused = false;
    } else {
      this._pausedAt = performance.now();
      this.paused = true;
    }
  }

  start() {
    this.hud.hideTitle();
    this.hud.hideGameOver();
    this.audio.init();
    this.audio.resume();
    this.stageIndex = 0;
    this._beginStage(performance.now());
  }

  _beginStage(now) {
    const def = STAGES[this.stageIndex];
    this.stage = new Stage(def);
    this.stage.waveIndex = 0;
    this.grid.reset();
    this.player.reset();
    this.renderer.clearAllCubes();
    this.stage.startWave(now);
    this.state = STATE.PLAYING;
    this.hud.setStage(def.id);
    this.hud.setWave(this.stage.waveIndex + 1);
    this.hud.setCubes(this.stage.remainingCubes());
    this.hud.setBombs(0);
    this.hud.flash(`STAGE ${def.id}`, 1000);
  }

  _beginNextWave(now) {
    this.stage.advanceWave();
    this.grid.clearMark();
    this.grid.clearBombs();
    this.renderer.clearAllCubes();
    this.stage.startWave(now);
    this.state = STATE.PLAYING;
    this.hud.setWave(this.stage.waveIndex + 1);
    this.hud.setCubes(this.stage.remainingCubes());
    this.hud.setBombs(0);
  }

  _onWaveCleared(now) {
    // Resolve any deferred row drops from bomb-killed forbidden cubes.
    const drops = this.stage.pendingRowDrop;
    if (drops > 0) {
      for (let i = 0; i < drops; i++) {
        if (this.grid.removeBackRow()) this.stage.floorLost = true;
      }
      this.audio.boom();
      this.hud.flash(`-${drops} ROW${drops > 1 ? "S" : ""}`, 1100);
      this.stage.pendingRowDrop = 0;
    }
    this.grid.clearBombs();
    this.hud.setBombs(0);

    if (this.stage.perfect()) {
      const restored = this.grid.restoreBackRow();
      this.hud.flash(restored ? "PERFECT  +ROW" : "PERFECT", 1200);
      this.audio.perfect();
    } else if (drops === 0) {
      this.hud.flash("CLEAR", 900);
    }
    if (this.stage.hasMoreWaves()) {
      this.state = STATE.WAVE_INTERMISSION;
      this._intermissionUntil = now + 1300;
    } else if (this.stageIndex < STAGES.length - 1) {
      this.state = STATE.STAGE_INTERMISSION;
      this._intermissionUntil = now + 1500;
    } else {
      this.state = STATE.WIN;
      this._intermissionUntil = now + 2500;
      this.hud.flash("YOU WIN", 2500);
    }
  }

  _die(reason) {
    if (this.state === STATE.DEAD) return;
    this.state = STATE.DEAD;
    this.audio.death();
    this.player.startFall(performance.now());
    setTimeout(() => this.hud.showGameOver(reason), 700);
  }

  // --- real-time actions ---

  _placeMark() {
    if (this.state !== STATE.PLAYING) return;
    if (!this.grid.hasTile(this.player.gx, this.player.gz)) return;
    if (this.grid.setMark(this.player.gx, this.player.gz)) {
      this.audio.mark();
    }
  }

  // FIRE: if a normal cube sits on the mark, capture it; if it's a green
  // cube, drop a bomb (3x3 deferred capture) in its place; if it's forbidden,
  // immediate 3-tile hole forward (the dangerous direct hit).
  _triggerMark() {
    if (this.state !== STATE.PLAYING) return;
    const m = this.grid.mark;
    if (!m) return;
    const hit = this.stage.cubes.find(c => !c.dead && c.gx === m.x && c.gz === m.z);
    if (!hit) {
      this.grid.clearMark();
      return;
    }

    hit.dead = true;
    if (hit.isAdvantage()) {
      this.grid.addBomb(m.x, m.z);
      this.audio.advCharge();
      this.hud.setBombs(this.grid.bombs.length);
    } else if (hit.isForbidden()) {
      this.stage.forbiddenDestroyed = true;
      this._applyForbiddenBlast(m.x, m.z);
      this.audio.boom();
    } else {
      this.audio.capture();
    }

    this._extraPause();
    this.grid.clearMark();
    this.hud.setCubes(this.stage.remainingCubes());

    if (this.stage.isCleared()) this._onWaveCleared(performance.now());
  }

  // DETONATE: blow up every active bomb at once. Forbidden cubes caught in
  // the blast don't punch holes; instead they queue a back-row drop that
  // resolves when the wave clears.
  _detonateBombs() {
    if (this.state !== STATE.PLAYING) return;
    const bombs = this.grid.bombs;
    if (bombs.length === 0) return;

    const killedSet = new Set();
    for (const bomb of bombs) {
      for (const cube of this.stage.cubes) {
        if (cube.dead || killedSet.has(cube.id)) continue;
        if (Math.abs(cube.gx - bomb.cx) <= 1 && Math.abs(cube.gz - bomb.cz) <= 1) {
          killedSet.add(cube.id);
          cube.dead = true;
          if (cube.isForbidden()) {
            this.stage.pendingRowDrop++;
            this.stage.forbiddenDestroyed = true;
          }
        }
      }
    }

    this.grid.clearBombs();
    this.hud.setBombs(0);

    if (killedSet.size > 0) {
      this.audio.boom();
      this._extraPause();
    }
    this.hud.setCubes(this.stage.remainingCubes());

    if (this.stage.isCleared()) this._onWaveCleared(performance.now());
  }

  _extraPause() {
    if (!this.stage) return;
    const ms = Math.max(0, (this.stage.extraPauseMs ?? (this.stage.tickMs - this.stage.rollMs)));
    this.stage.nextTickAt += ms;
  }

  _applyForbiddenBlast(x, z) {
    for (let dz = 0; dz < FORBIDDEN_HOLE_DEPTH; dz++) {
      const hz = z - dz;
      if (hz < 0) break;
      if (this.grid.hasTile(x, hz)) {
        this.grid.removeTile(x, hz);
        this.stage.floorLost = true;
      }
    }
    // Any bomb whose center tile just vanished should go with it.
    this.grid.removeBombsWhere(b => !this.grid.hasTile(b.cx, b.cz));
    this.hud.setBombs(this.grid.bombs.length);
  }

  // --- main loop ---
  update(now) {
    const dt = Math.min(0.1, (now - this._lastFrame) / 1000);
    this._lastFrame = now;

    let action;
    while ((action = this.input.consumeAction()) !== null) {
      if (action === "start") {
        if (this.state === STATE.TITLE) { this.start(); }
        else if (this.state === STATE.DEAD) {
          this.hud.hideGameOver();
          this.start();
        }
        continue;
      }
      if (this.state !== STATE.PLAYING) continue;
      if (action === "mark") this._placeMark();
      else if (action === "trigger") this._triggerMark();
      else if (action === "detonate") this._detonateBombs();
    }

    if (this.state === STATE.PLAYING) {
      this._updatePlaying(now, dt);
    } else if (this.state === STATE.WAVE_INTERMISSION) {
      if (now >= this._intermissionUntil) this._beginNextWave(now);
    } else if (this.state === STATE.STAGE_INTERMISSION) {
      if (now >= this._intermissionUntil) {
        this.stageIndex++;
        this._beginStage(now);
      }
    }

    this.renderer.syncFloor(this.grid);
    this.renderer.syncCubes(this.stage ? this.stage.cubes.filter(c => !c.dead) : [], now);
    this.renderer.syncPlayer(this.player, now);
    this.renderer.syncMarks(this.grid);
    this.renderer.syncBombs(this.grid.bombs, now);
    this.renderer.updateCamera(this.player, dt);
    this.renderer.step(dt);
    this.renderer.render();
  }

  _updatePlaying(now, dt) {
    // Movement stays enabled while paused so the debugger user can reposition.
    const { dx, dz } = this.input.axis();
    if (dx !== 0 || dz !== 0) {
      const nx = this.player.gx + dx;
      const nz = this.player.gz + dz;
      if (this.grid.inBounds(nx, nz) && this.grid.hasTile(nx, nz)) {
        this.player.tryMove(dx, dz, now, this.grid);
      }
    }

    if (this.paused && !this.stepRequested) return;

    if (this.stepRequested) {
      this.stepRequested = false;
      this.stage.nextTickAt = now; // force immediate tick this frame
    }

    if (now >= this.stage.nextTickAt) {
      const events = this.stage.tick(now, this.player, this.grid);
      this.stage.nextTickAt += this.stage.tickMs;
      this.audio.beat();

      if (events.dangerNear) this.audio.danger();

      this.hud.setCubes(this.stage.remainingCubes());

      if (events.crushed) { this._die("crushed by a cube"); return; }
      if (events.fellOff) { this._die("a cube reached the edge"); return; }
      if (!this.grid.hasTile(this.player.gx, this.player.gz)) {
        this._die("fell through the floor"); return;
      }

      if (this.stage.isCleared()) {
        this._onWaveCleared(now);
        return;
      }
    }
  }
}

export { STATE };
