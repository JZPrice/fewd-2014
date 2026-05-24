import { Grid } from "./grid.js?v=106";
import { Player } from "./player.js?v=106";
import { Stage } from "./stage.js?v=106";
import { STAGES } from "./stages.js?v=106";
import { GRID_W, GRID_D } from "./config.js?v=106";

const STATE = {
  TITLE: "title",
  PLAYING: "playing",
  WAVE_INTERMISSION: "wave_intermission",
  STAGE_INTERMISSION: "stage_intermission",
  DEAD: "dead",
  WIN: "win",
};

// Hard cap on how many rows the platform can lose in a single stage.
// Every call to _dropFrontRow increments the counter (resets per stage);
// once it crosses this threshold the run ends. Without it, the player can
// indefinitely retreat as cubes fall off the long preloaded platform.
const MAX_ROWS_LOST = 5;

export class Game {
  constructor({ renderer, input, audio, hud, haptics }) {
    this.renderer = renderer;
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    this.haptics = haptics ?? { mark(){}, capture(){}, bombPlace(){}, detonate(){}, forbidden(){}, death(){}, perfect(){}, danger(){}, rowDrop(){}, step(){} };

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

    // Front-row drop sequencer. Forbidden hits and normal-cube fall-offs
    // enqueue here; the queue fires one drop per `dropPauseMs`, suspending
    // the tick clock AND freezing rolling cubes so the platform crumbles
    // visibly before anything else moves.
    this._dropQueue = 0;
    this._dropNextAt = 0;
    // Long enough to cover the full crumble of a 6-wide row (~3s): 2s of
    // L->R column stagger + ~1s of gravity-fall before the tiles reap.
    this.dropPauseMs = 2200;

    // Timestamp the FAST button / shift was first pressed for the current
    // hold. 0 = not held. Used by _updatePlaying to ramp speedMultiplier.
    this._fastHeldT0 = 0;

    // Per-stage row-loss tally; see MAX_ROWS_LOST.
    this._stageRowsLost = 0;

    // The renderer staggers the row-drop animation cube-by-cube. Each time
    // a single cube transitions from waiting to falling, we want a thunk +
    // small camera shake + haptic tick so the sequence builds dread.
    this.renderer.onTileDrop = () => {
      this.audio.tileDrop?.();
      this.renderer.shake?.(0.08, 110);
      this.haptics.rowDrop?.();
    };
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
    const gw = this.stage.gridW;
    const gd = this.stage.gridD;
    // Reconfigure renderer floor/underbody for this stage's dims BEFORE the
    // grid/player reset so any helpers that read from the renderer pick up
    // the new centering.
    this.renderer.setStageDimensions?.(gw, gd);
    this.grid.resize(gw, gd);
    this.player.reset(gw);
    this.renderer.clearAllCubes();
    this.renderer.resetFollow?.(this.player);
    this._dropQueue = 0;
    this._dropNextAt = 0;
    this._stageRowsLost = 0;
    this.stage.spawnAllWaves();
    this.stage.startWave(now);
    this.state = STATE.PLAYING;
    this.hud.setStage(def.id);
    this.hud.setWave(this.stage.waveIndex + 1);
    this.hud.setCubes(this.stage.remainingCubes());
    this.hud.setBombs(0);
    this.hud.flash(`STAGE ${def.id}`, 1000);
  }

  // Debug-only: jump straight to a (stageIndex, waveIndex). Resets the
  // grid/player and clears any in-flight cubes/bombs/marks before starting
  // the requested wave fresh.
  jumpTo(stageIndex, waveIndex) {
    if (stageIndex < 0 || stageIndex >= STAGES.length) return;
    const def = STAGES[stageIndex];
    if (waveIndex < 0 || waveIndex >= def.waves.length) return;
    this.stageIndex = stageIndex;
    const now = performance.now();
    this.stage = new Stage(def);
    this.stage.waveIndex = waveIndex;
    const gw = this.stage.gridW;
    const gd = this.stage.gridD;
    this.renderer.setStageDimensions?.(gw, gd);
    this.grid.resize(gw, gd);
    this.player.reset(gw);
    this.renderer.clearAllCubes();
    this.renderer.resetFollow?.(this.player);
    this._dropQueue = 0;
    this._dropNextAt = 0;
    this._stageRowsLost = 0;
    this.stage.spawnAllWaves();
    // Kill cubes from any wave we skipped over so they don't sit as
    // walls in front of the jumped-to wave.
    for (const c of this.stage.cubes) {
      if (c.waveIndex < waveIndex) c.dead = true;
    }
    this.stage.startWave(now);
    this.state = STATE.PLAYING;
    this.hud.hideGameOver();
    this.hud.setStage(def.id);
    this.hud.setWave(this.stage.waveIndex + 1);
    this.hud.setCubes(this.stage.remainingCubes());
    this.hud.setBombs(0);
    this.hud.flash(`STAGE ${def.id} - WAVE ${waveIndex + 1}`, 900);
  }

  _beginNextWave(now) {
    this.stage.advanceWave();
    this.grid.clearMark();
    this.grid.clearBombs();
    // Don't clearAllCubes here: dormant future-wave cubes are already in
    // the scene and need to persist so they can wake up in place.
    this._dropQueue = 0;
    this._dropNextAt = 0;
    this.stage.startWave(now);
    this.state = STATE.PLAYING;
    this.hud.setWave(this.stage.waveIndex + 1);
    this.hud.setCubes(this.stage.remainingCubes());
    this.hud.setBombs(0);
  }

  _onWaveCleared(now) {
    this.grid.clearBombs();
    this.hud.setBombs(0);

    // Bonus: each forbidden cube that rolled off harmlessly rebuilds one
    // missing front-edge row. Lets the player earn back ground that normal
    // cubes took, by playing safely around the forbidden ones.
    const fellOff = this.stage.forbiddenFellOff ?? 0;
    let restoredFromForbidden = 0;
    for (let i = 0; i < fellOff; i++) {
      if (this.grid.restoreFrontRow()) restoredFromForbidden++;
    }
    this.stage.forbiddenFellOff = 0;
    if (restoredFromForbidden > 0) {
      this.hud.flash(`+${restoredFromForbidden} ROW${restoredFromForbidden > 1 ? "S" : ""}`, 1100);
      this.audio.perfect();
      this.haptics.rowDrop();
    }

    if (this.stage.perfect()) {
      const restored = this.grid.restoreBackRow();
      this.hud.flash(restored ? "PERFECT  +ROW" : "PERFECT", 1200);
      this.audio.perfect();
      this.haptics.perfect();
    } else if (restoredFromForbidden === 0) {
      this.hud.flash("CLEAR", 900);
    }

    if (this.stage.hasMoreWaves()) {
      this.state = STATE.WAVE_INTERMISSION;
      this._intermissionUntil = now + 600;
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
    this.haptics.death();
    this.renderer.shake?.(0.30, 400);
    this.player.startFall(performance.now());
    setTimeout(() => this.hud.showGameOver(reason), 700);
  }

  // --- real-time actions ---

  _placeMark() {
    if (this.state !== STATE.PLAYING) return;
    const tx = this.player.tx, tz = this.player.tz;
    if (!this.grid.hasTile(tx, tz)) return;
    if (this.grid.setMark(tx, tz)) {
      this.audio.mark();
      this.haptics.mark();
      this.renderer.spawnMarkGhost?.(tx, tz);
    }
  }

  // FIRE: if a normal cube sits on the mark, capture it; if it's a green
  // cube, drop a bomb (3x3 deferred capture) in its place; if it's forbidden,
  // immediate 3-tile hole forward (the dangerous direct hit).
  _triggerMark() {
    if (this.state !== STATE.PLAYING) return;
    const m = this.grid.mark;
    if (!m) return;
    this.renderer.fireBlast?.(m.x, m.z);
    const hit = this.stage.activeCubeAt(m.x, m.z);
    if (!hit) {
      this.grid.clearMark();
      return;
    }

    hit.dead = true;
    hit.startDissolving(performance.now());
    if (hit.isAdvantage()) {
      this.grid.addBomb(m.x, m.z);
      this.audio.advCharge();
      this.haptics.bombPlace();
      this.renderer.shake?.(0.05, 120);
      // Flash a red aura on every cube already sitting inside the new
      // bomb's 3x3 so the player can see the blast zone at a glance.
      const auraIds = [];
      for (const cube of this.stage.cubes) {
        if (cube.dead || cube.fallingOff) continue;
        if (cube.waveIndex !== this.stage.waveIndex) continue;
        if (Math.abs(cube.gx - m.x) <= 1 && Math.abs(cube.gz - m.z) <= 1) {
          auraIds.push(cube.id);
        }
      }
      this.renderer.spawnBombAuraOnCubes?.(auraIds);
      this.hud.setBombs(this.grid.bombs.length);
    } else if (hit.isForbidden()) {
      this.stage.forbiddenDestroyed = true;
      this._requestFrontRowDrop(performance.now());
    } else {
      this.audio.capture();
      this.haptics.capture();
      this.renderer.shake?.(0.04, 90);
    }

    this._extraPause();
    this.grid.clearMark();
    this.hud.setCubes(this.stage.remainingCubes());

    if (this.stage.isCleared() && this._dropQueue === 0 && performance.now() >= this._dropNextAt) this._onWaveCleared(performance.now());
  }

  // DETONATE: blow up every active bomb at once. Forbidden cubes caught in
  // the blast don't punch holes; instead they queue a back-row drop that
  // resolves when the wave clears.
  _detonateBombs() {
    if (this.state !== STATE.PLAYING) return;
    const bombs = this.grid.bombs;
    if (bombs.length === 0) return;

    // Single-shot detonation: each green cube caught in the blast plants
    // a fresh bomb at its position. The player presses DETONATE again to
    // chain through them - no auto-cascade.
    const killedSet = new Set();
    const now = performance.now();
    const seededBombs = [];
    for (const bomb of bombs) {
      for (const cube of this.stage.cubes) {
        if (cube.dead || killedSet.has(cube.id)) continue;
        if (cube.waveIndex !== this.stage.waveIndex) continue;
        if (Math.abs(cube.gx - bomb.cx) <= 1 && Math.abs(cube.gz - bomb.cz) <= 1) {
          killedSet.add(cube.id);
          cube.dead = true;
          cube.startDissolving(now);
          if (cube.isForbidden()) {
            this.stage.forbiddenDestroyed = true;
            this._requestFrontRowDrop(now);
          } else if (cube.isAdvantage()) {
            seededBombs.push({ x: cube.gx, z: cube.gz });
          }
        }
      }
    }

    // Consume the bombs that just fired, then plant the seeded ones
    // (each from a green cube caught in the blast).
    this.grid.clearBombs();
    for (const p of seededBombs) this.grid.addBomb(p.x, p.z);
    this.hud.setBombs(this.grid.bombs.length);

    if (killedSet.size > 0) {
      this.audio.boom();
      this.haptics.detonate();
      this.renderer.shake?.(0.20, 280);
      this._extraPause();
    }
    this.hud.setCubes(this.stage.remainingCubes());

    if (this.stage.isCleared() && this._dropQueue === 0 && performance.now() >= this._dropNextAt) this._onWaveCleared(performance.now());
  }

  _extraPause() {
    if (!this.stage) return;
    const base = this.stage.extraPauseMs ?? (this.stage.tickMs - this.stage.rollMs);
    const ms = Math.max(0, base / this.stage.speedMultiplier);
    this.stage.nextTickAt += ms;
  }

  // Forbidden-destruction penalty (and visual echo of a normal cube
  // running off the front): rip out the entire front row of the platform
  // - surface tile + every underbody block in that column. Every call
  // counts toward the stage's row-loss budget regardless of whether tiles
  // were actually present; exceeding the budget ends the run.
  _dropFrontRow() {
    this._stageRowsLost++;
    const front = this.stage.frontEdge(this.grid);
    let removed = 0;
    if (front < this.grid.d) {
      for (let x = 0; x < this.grid.w; x++) {
        if (this.grid.hasTile(x, front)) {
          this.grid.removeTile(x, front);
          removed++;
        }
      }
    }
    if (removed > 0) {
      this.stage.floorLost = true;
      this.grid.removeBombsWhere(b => !this.grid.hasTile(b.cx, b.cz));
      this.hud.setBombs(this.grid.bombs.length);
      this.audio.boom();
      this.haptics.forbidden();
      this.renderer.shake?.(0.18, 240);
    }
    if (this._stageRowsLost >= MAX_ROWS_LOST) {
      this._die("the floor caved in");
      return;
    }
    // Player standing on the dropped row goes with it.
    if (removed > 0 && this.player.tz === front) this._die("the row dropped with you");
  }

  // Sequence forbidden row drops: first drop fires immediately, additional
  // drops queue up and fire one at a time with `dropPauseMs` between them.
  // While the queue is non-empty the tick clock is suspended so cubes hold
  // position between drops.
  _requestFrontRowDrop(now) {
    if (this._dropQueue === 0 && now >= this._dropNextAt) {
      this._dropFrontRow();
      this._dropNextAt = now + this.dropPauseMs;
    } else {
      this._dropQueue++;
    }
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
    // Dissolving cubes are gameplay-dead but still need to render until
    // their sink-into-the-floor animation completes.
    this.renderer.syncCubes(
      this.stage ? this.stage.cubes.filter(c => !c.dead || c.dissolving) : [],
      now,
    );
    this.renderer.syncPlayer(this.player, now);
    this.renderer.syncMarks(this.grid);
    this.renderer.syncBombs(this.grid.bombs, now);
    this.renderer.updateCamera(this.player, dt);
    this.renderer.step(dt);
    this.renderer.render();
  }

  _updatePlaying(now, dt) {
    // Continuous-position movement. The Player class normalizes diagonals,
    // splits the step per-axis for slide-along-wall behavior, and clamps to
    // the current tile when the next tile is blocked.
    const { dx, dz } = this.input.axis();
    this.player.setIntent(dx, dz);
    this.player.update(dt, now, this.grid, this.stage);

    // Fast-forward: hold SHIFT (kbd) or the on-screen FAST button to make
    // blocks tick + roll faster. Multiplier ramps from 1x at press to
    // FAST_MAX_MULT over FAST_RAMP_MS of held time; releasing snaps back
    // to 1x. Rescale the remaining wait whenever it changes so the speed
    // shift is felt immediately.
    const FAST_MAX_MULT = 6;
    const FAST_RAMP_MS = 4000;
    const wantFast = this.input.held.has("shift") || this.input.held.has("fast");
    let targetMult = 1;
    if (wantFast) {
      if (this._fastHeldT0 === 0) this._fastHeldT0 = now;
      const u = Math.min(1, (now - this._fastHeldT0) / FAST_RAMP_MS);
      targetMult = 1 + u * (FAST_MAX_MULT - 1);
    } else {
      this._fastHeldT0 = 0;
    }
    const oldMult = this.stage.speedMultiplier;
    if (Math.abs(oldMult - targetMult) > 0.001) {
      const remaining = Math.max(0, this.stage.nextTickAt - now);
      this.stage.nextTickAt = now + remaining * (oldMult / targetMult);
      this.stage.speedMultiplier = targetMult;
    }

    if (this.paused && !this.stepRequested) return;

    // Process the front-row drop queue: fire the next pending drop once the
    // pause window has elapsed. While the sequence is in flight (queue has
    // items, OR we're inside the cool-down after the last drop so the row
    // has time to fully crumble), suspend the tick clock AND freeze any
    // cubes mid-roll so the only thing that moves is the player.
    if (this._dropQueue > 0 && now >= this._dropNextAt) {
      this._dropFrontRow();
      this._dropQueue--;
      this._dropNextAt = now + this.dropPauseMs;
    }
    const dropsInFlight = this._dropQueue > 0 || now < this._dropNextAt;
    if (dropsInFlight) {
      this.stage.nextTickAt = Math.max(this.stage.nextTickAt, this._dropNextAt + 50);
      const dtMs = dt * 1000;
      for (const cube of this.stage.cubes) {
        if (cube.roll) cube.roll.t0 += dtMs;
      }
    }

    if (this.stepRequested) {
      this.stepRequested = false;
      this.stage.nextTickAt = now; // force immediate tick this frame
    }

    if (now >= this.stage.nextTickAt) {
      const events = this.stage.tick(now, this.player, this.grid);
      this.stage.nextTickAt += this.stage.tickMs / this.stage.speedMultiplier;
      this.audio.beat();

      if (events.dangerNear) { this.audio.danger(); this.haptics.danger(); }

      if (events.rowsDropped > 0) {
        this.haptics.rowDrop();
        this.hud.flash(`-${events.rowsDropped} ROW${events.rowsDropped > 1 ? "S" : ""}`, 900);
        for (let i = 0; i < events.rowsDropped; i++) this._requestFrontRowDrop(now);
      }

      this.hud.setCubes(this.stage.remainingCubes());

      if (!this.grid.hasTile(this.player.tx, this.player.tz)) {
        this._die("fell through the floor"); return;
      }

      if (this.stage.isCleared() && this._dropQueue === 0 && performance.now() >= this._dropNextAt) {
        this._onWaveCleared(now);
        return;
      }
    }

    // Reap cubes whose fall-off / dissolve animation has finished.
    for (const cube of this.stage.cubes) {
      if (cube.fallingOff && (now - cube.fallOffT0) >= cube.fallOffDuration) {
        cube.dead = true;
        cube.fallingOff = false;
      }
      if (cube.dissolving && (now - cube.dissolveT0) >= cube.dissolveDuration) {
        cube.dissolving = false;
      }
    }
    // Wave can clear once the last falling cube has finished its animation
    // AND the front-row drop queue has drained.
    if (this.stage.isCleared() && this._dropQueue === 0 && performance.now() >= this._dropNextAt) {
      this._onWaveCleared(now);
      return;
    }

    // Mid-roll crush: any cube past the 45-degree mark of its roll, with
    // the player still in the target tile, lands. First half of the roll
    // is the player's dodge window.
    for (const cube of this.stage.cubes) {
      if (cube.dead || cube.fallingOff || !cube.roll) continue;
      if (cube.gx === this.player.tx && cube.gz === this.player.tz) {
        if (cube.rollProgress(now) >= 0.5) {
          this._die("crushed by a cube");
          return;
        }
      }
    }
  }
}

export { STATE };
