import { Grid } from "./grid.js";
import { Player } from "./player.js";
import { Stage } from "./stage.js";
import { STAGES } from "./stages.js";
import { CUBE_TYPE } from "./config.js";

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
    this.hud.setAdv(this.player.advantage);
    this.hud.flash(`STAGE ${def.id}`, 1000);
  }

  _beginNextWave(now) {
    this.stage.advanceWave();
    this.grid.clearMark();
    this.grid.clearAdvMark();
    this.renderer.clearAllCubes();
    this.stage.startWave(now);
    this.state = STATE.PLAYING;
    this.hud.setWave(this.stage.waveIndex + 1);
    this.hud.setCubes(this.stage.remainingCubes());
  }

  _onWaveCleared(now) {
    if (this.stage.perfect()) {
      const restored = this.grid.restoreBackRow();
      this.hud.flash(restored ? "PERFECT  +ROW" : "PERFECT", 1200);
      this.audio.perfect();
    } else {
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

  _triggerMark() {
    if (this.state !== STATE.PLAYING) return;
    const m = this.grid.mark;
    if (!m) return;
    const cube = this.stage.cubes.find(c => !c.dead && c.gx === m.x && c.gz === m.z);
    if (cube) {
      cube.dead = true;
      if (cube.isForbidden()) {
        this.stage.forbiddenDestroyed = true;
        this._applyForbiddenBlast(m.x, m.z);
        this.audio.boom();
      } else {
        this.audio.capture();
      }
      if (cube.isAdvantage()) {
        this.player.advantage++;
        this.audio.advCharge();
      }
    }
    this.grid.clearMark();
  }

  _placeAdvMark() {
    if (this.state !== STATE.PLAYING) return;
    if (this.player.advantage <= 0) return;
    this.player.advantage--;
    this.grid.setAdvMark(this.player.gx, this.player.gz);
    this.audio.mark();
  }

  _triggerAdvMark() {
    if (this.state !== STATE.PLAYING) return;
    const am = this.grid.advMark;
    if (!am) return;
    let anyCapture = false;
    let anyForbidden = false;
    let advBoost = 0;
    for (const cube of this.stage.cubes) {
      if (cube.dead) continue;
      if (Math.abs(cube.gx - am.cx) <= 1 && Math.abs(cube.gz - am.cz) <= 1) {
        cube.dead = true;
        anyCapture = true;
        if (cube.isForbidden()) {
          anyForbidden = true;
          this.stage.forbiddenDestroyed = true;
          this._applyForbiddenBlast(cube.gx, cube.gz);
        }
        if (cube.isAdvantage()) advBoost++;
      }
    }
    if (anyForbidden) this.audio.boom();
    else if (anyCapture) this.audio.capture();
    if (advBoost > 0) {
      this.player.advantage += advBoost;
      this.audio.advCharge();
    }
    this.grid.clearAdvMark();
  }

  _applyForbiddenBlast(x, z) {
    const FORBIDDEN_HOLE_DEPTH = 3;
    for (let dz = 0; dz < FORBIDDEN_HOLE_DEPTH; dz++) {
      const hz = z - dz;
      if (hz < 0) break;
      if (this.grid.hasTile(x, hz)) {
        this.grid.removeTile(x, hz);
        this.stage.floorLost = true;
      }
    }
  }

  // --- main loop ---
  update(now) {
    const dt = Math.min(0.1, (now - this._lastFrame) / 1000);
    this._lastFrame = now;

    // Handle queued discrete actions and the Enter key.
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
      else if (action === "advmark") this._placeAdvMark();
      else if (action === "advtrigger") this._triggerAdvMark();
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

    // Visuals always update (so dying/falling animation runs).
    this.renderer.syncFloor(this.grid);
    this.renderer.syncCubes(this.stage ? this.stage.cubes.filter(c => !c.dead) : [], now);
    this.renderer.syncPlayer(this.player, now);
    this.renderer.syncMarks(this.grid);
    this.renderer.updateCamera(this.player, dt);
    this.renderer.step(dt);
    this.renderer.render();
  }

  _updatePlaying(now, dt) {
    // Movement
    const { dx, dz } = this.input.axis();
    if (dx !== 0 || dz !== 0) {
      // Only walk onto a tile that exists.
      const nx = this.player.gx + dx;
      const nz = this.player.gz + dz;
      if (this.grid.inBounds(nx, nz) && this.grid.hasTile(nx, nz)) {
        this.player.tryMove(dx, dz, now, this.grid);
      }
    }

    // Tick
    if (now >= this.stage.nextTickAt) {
      const events = this.stage.tick(now, this.player, this.grid);
      this.stage.nextTickAt += this.stage.tickMs;
      this.audio.beat();

      // Award advantage charges from auto-trap captures.
      for (const cap of events.captured) {
        if (cap.cube.isAdvantage()) {
          this.player.advantage++;
          this.audio.advCharge();
        } else if (cap.cube.isForbidden()) {
          this.audio.boom();
        } else {
          this.audio.capture();
        }
      }

      if (events.dangerNear && events.captured.length === 0) this.audio.danger();

      this.hud.setCubes(this.stage.remainingCubes());
      this.hud.setAdv(this.player.advantage);

      if (events.crushed) { this._die("crushed by a cube"); return; }
      if (events.fellOff) { this._die("a cube reached the edge"); return; }
      // Player standing on a now-vanished tile? Falls in.
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
