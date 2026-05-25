export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.fxGain = null;
    this.enabled = true;
    this._music = null;
    this._musicSched = null;
    this._silentAudio = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // Split into buses so we can duck music independently of FX, and so
    // future debug controls can solo/mute either layer.
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.55;
    this.musicGain.connect(this.master);

    this.fxGain = this.ctx.createGain();
    this.fxGain.gain.value = 1.0;
    this.fxGain.connect(this.master);

    this._kickSilentLoop();
  }

  // iOS Safari routes Web Audio through the ringer channel by default, so
  // the hardware mute switch silences everything. Looping a tiny silent
  // <audio> element forces the audio session into the "media" category,
  // which respects volume but ignores the mute switch. Must be triggered
  // from a user gesture, which init() already is via main.js.
  _kickSilentLoop() {
    if (this._silentAudio) return;
    try {
      const a = new Audio("assets/audio/silence.wav?v=131");
      a.loop = true;
      a.volume = 0.01;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      this._silentAudio = a;
    } catch (_) {}
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  _envTone({ freq, type = "sine", attack = 0.005, decay = 0.18, gain = 0.4, freq2 = null, pan = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freq2 !== null) osc.frequency.exponentialRampToValueAtTime(freq2, t + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g).connect(this.fxGain || this.master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  _noise({ duration = 0.2, gain = 0.3, filterFreq = 1200, filterQ = 1 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const bufSize = Math.floor(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = filterFreq;
    filt.Q.value = filterQ;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(this.fxGain || this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  beat() {
    this._envTone({ freq: 110, type: "triangle", attack: 0.002, decay: 0.09, gain: 0.22, freq2: 60 });
    this._noise({ duration: 0.05, gain: 0.08, filterFreq: 3000 });
  }

  capture() {
    this._envTone({ freq: 880, type: "sine", attack: 0.002, decay: 0.12, gain: 0.3, freq2: 1760 });
    this._envTone({ freq: 1320, type: "sine", attack: 0.01, decay: 0.16, gain: 0.18, freq2: 2640 });
  }

  boom() {
    this._noise({ duration: 0.45, gain: 0.5, filterFreq: 600, filterQ: 2 });
    this._envTone({ freq: 80, type: "sawtooth", attack: 0.005, decay: 0.35, gain: 0.3, freq2: 35 });
  }

  // Single cube falling off the front edge - tight low thunk, used per
  // cube during the staggered row-drop sequence to build dread.
  tileDrop() {
    this._envTone({ freq: 90, type: "sawtooth", attack: 0.002, decay: 0.18, gain: 0.28, freq2: 50 });
    this._noise({ duration: 0.10, gain: 0.18, filterFreq: 1200, filterQ: 1 });
  }

  perfect() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => setTimeout(() => {
      this._envTone({ freq: f, type: "triangle", attack: 0.01, decay: 0.4, gain: 0.22 });
    }, i * 90));
  }

  danger() {
    this._envTone({ freq: 420, type: "square", attack: 0.005, decay: 0.12, gain: 0.14 });
  }

  advCharge() {
    this._envTone({ freq: 660, type: "triangle", attack: 0.005, decay: 0.18, gain: 0.22, freq2: 990 });
  }

  mark() {
    this._envTone({ freq: 1200, type: "sine", attack: 0.002, decay: 0.05, gain: 0.12 });
  }

  death() {
    this._envTone({ freq: 200, type: "sawtooth", attack: 0.005, decay: 0.6, gain: 0.3, freq2: 50 });
    this._noise({ duration: 0.5, gain: 0.2, filterFreq: 400 });
  }

  // ----- Music -------------------------------------------------------------
  //
  // Toccata-and-Fugue D-minor REMIX with chord punctuation throughout.
  // Each bar is a custom event list so we can interleave melodic flourishes
  // (descending Bach-style runs AND spiny ascending sweeps) with chord
  // stabs that hit on the beats between phrases.
  //
  // 8-bar loop in D minor at 72 BPM:
  //   Bar 1: Toccata opening - A5 mordent + descent, ends on C#°7 dim crash
  //   Bar 2: Spiny ASCENDING run G4->G5 with Gm chord stabs
  //   Bar 3: Toccata call in F - F5 mordent + descent, lands on Bb chord
  //   Bar 4: Mid-climax - A7 + ascending arp + descending finale + Dm stab
  //   Bar 5: QUICK CHORD CLIMB Dm Em F Gm (one chord per beat, ascending),
  //          walking bass D-E-F-G, melody D5 E5 F5 G5 on top
  //   Bar 6: Climb continues Am Bb C Dm, walking bass A-Bb-C-D, melody
  //          A5 Bb5 C6 D6 - peak of the arch
  //   Bar 7: TENSION sustained C#°7 + high D6/C#6 trill + chromatic
  //          descent down to A5
  //   Bar 8: FULL RESOLUTION - massive multi-octave Dm crash + dramatic
  //          descending sweep + final low Dm rumble, rings into next loop
  //
  // Notes are scheduled bar-by-bar via a 100ms look-ahead; oscillators
  // self-stop on their scheduled end time, so stopMusic() only needs to
  // cancel the scheduler and fade the submaster.
  startMusic() {
    if (!this.ctx || this._music) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.15;

    // Drier room than the previous cathedral wash - Moog wants to be
    // up-front and squelchy, not echoing through a chapel. Short IR
    // (~1.2s) with a fast falloff plus a small wet send keeps a hint
    // of space without smearing the filter character.
    const conv = ctx.createConvolver();
    conv.buffer = this._makeCathedralIR(1.2, 3.5);

    const wet = ctx.createGain(); wet.gain.value = 0.22;
    const dry = ctx.createGain(); dry.gain.value = 1.0;
    conv.connect(wet);

    const sub = ctx.createGain();
    sub.gain.setValueAtTime(0, t0);
    sub.gain.linearRampToValueAtTime(1.0, t0 + 2.5);
    dry.connect(sub);
    wet.connect(sub);
    sub.connect(this.musicGain);

    const organIn = ctx.createGain(); organIn.gain.value = 0.55;
    organIn.connect(dry);
    organIn.connect(conv);

    const moogIn = ctx.createGain(); moogIn.gain.value = 0.55;
    moogIn.connect(dry);
    moogIn.connect(conv);

    const beat = 60 / 72;
    const bar  = beat * 4;

    // Sub-bass + bass.
    const D1 = 36.71, G1 = 49.00, Bb1 = 58.27, A1 = 55.00;
    // Mid + low chord pitches.
    const D2 = 73.42, F2 = 87.31, A2 = 110.00;
    const G2 = 98.00, Bb2 = 116.54;
    const D3 = 146.83, F3 = 174.61, A3 = 220.00;
    const G3 = 196.00, Bb3 = 233.08, Csh3 = 138.59, E3 = 164.81;
    // High-register chord + melody pitches.
    const B3 = 246.94, C4 = 261.63;
    const D4 = 293.66, F4 = 349.23, A4 = 440.00;
    const Csh4 = 277.18, E4 = 329.63, G4 = 392.00, Bb4 = 466.16;
    const Eb4 = 311.13;
    const C5 = 523.25, Csh5 = 554.37, D5 = 587.33, Eb5 = 622.25;
    const E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.00;
    const Fsh5 = 739.99;
    // Top octave for the climax climb.
    const Bb5 = 932.33, B5 = 987.77, C6 = 1046.50, Csh6 = 1108.73;
    const D6 = 1174.66, E6 = 1318.51;
    // Sub-bass walking notes.
    const E1 = 41.20, F1 = 43.65, Cs1 = 34.65;

    // Helpers to build melody segments.
    const note = (when, f, dur) => ({ type: "note", when, f, dur });
    const chord = (when, freqs, dur, kind = "stab") => ({ type: "chord", when, freqs, dur, kind });
    const mord = (when, top, neighbor) => [
      note(when + 0.00, top, 0.06),
      note(when + 0.06, neighbor, 0.06),
      note(when + 0.12, top, beat * 0.50),
    ];
    const run = (when, freqs, noteDur) => freqs.map((f, i) => note(when + i * noteDur, f, noteDur * 0.92));

    // Bar 1 - Toccata opening (D minor), ends on C#°7 diminished crash.
    const BAR_TOC_DM = [
      ...mord(0, A5, G5),
      ...run(beat * 0.85, [G5, F5, E5, D5, Csh5], beat * 0.22),
      note(beat * 1.95, D5, beat * 0.40),
      // Bach's signature diminished 7 chord (C# E G Bb) - the tension
      chord(beat * 2.50, [Csh4, E4, G4, Bb4], beat * 1.40, "dim"),
      // Punctuating mid-chord stab
      chord(beat * 3.20, [Csh3, E3, G3, Bb3], beat * 0.70, "stab"),
    ];

    // Bar 2 - Spiny ASCENDING run with chord punctuation.
    const BAR_UP_GM = [
      chord(0,            [G3, Bb3, D4], beat * 0.40, "stab"),
      ...run(beat * 0.40, [G4, A4, Bb4, C5, D5, Eb5], beat * 0.20),
      chord(beat * 1.60, [G3, Bb3, D4], beat * 0.40, "stab"),
      ...run(beat * 2.00, [E5, F5, G5, A5], beat * 0.20),
      chord(beat * 2.80, [D3, G3, Bb3, D4, G4], beat * 1.20, "stab"),
    ];

    // Bar 3 - Toccata-style call in F (descending), lands on Bb.
    const BAR_TOC_BB = [
      ...mord(0, F5, E5),
      ...run(beat * 0.85, [Eb5, D5, C5, Bb4, A4], beat * 0.22),
      note(beat * 1.95, Bb4, beat * 0.40),
      chord(beat * 2.50, [Bb3, D4, F4], beat * 1.40, "stab"),
      chord(beat * 3.20, [Bb2, D3, F3], beat * 0.70, "stab"),
    ];

    // Bar 4 - Mid-climax: A7 stab + ascending arpeggio + descending
    // finale. Ends on a Dm stab (smaller than the full crash) so the
    // climbing chord progression in bar 5 picks up the energy without
    // a hard reset.
    const BAR_CLIMAX = [
      chord(0, [A3, Csh4, E4, G4], beat * 0.30, "stab"),
      ...run(beat * 0.30, [A4, Csh5, E5, A5], beat * 0.30),
      note(beat * 1.50, A5, beat * 0.40),
      ...run(beat * 1.90, [A5, G5, Fsh5, F5, E5, D5], beat * 0.15),
      chord(beat * 2.95, [D3, F3, A3, D4, F4, A4], beat * 1.05, "stab"),
    ];

    // Bar 5 - QUICK CHORD CLIMB (chord per beat ascending: Dm Em F Gm)
    // with spiny melody walking up the root notes one octave above.
    const BAR_CLIMB1 = [
      chord(beat * 0.00, [D3, F3, A3],  beat * 0.85, "stab"),
      note (beat * 0.00,  D5,           beat * 0.85),
      chord(beat * 1.00, [E3, G3, B3],  beat * 0.85, "stab"),
      note (beat * 1.00,  E5,           beat * 0.85),
      chord(beat * 2.00, [F3, A3, C4],  beat * 0.85, "stab"),
      note (beat * 2.00,  F5,           beat * 0.85),
      chord(beat * 3.00, [G3, Bb3, D4], beat * 0.85, "stab"),
      note (beat * 3.00,  G5,           beat * 0.85),
    ];

    // Bar 6 - Climb continues HIGHER (Am Bb C Dm), melody pushes from
    // A5 up to high D6 - the top of the arch.
    const BAR_CLIMB2 = [
      chord(beat * 0.00, [A3, C4, E4],  beat * 0.85, "stab"),
      note (beat * 0.00,  A5,           beat * 0.85),
      chord(beat * 1.00, [Bb3, D4, F4], beat * 0.85, "stab"),
      note (beat * 1.00,  Bb5,          beat * 0.85),
      chord(beat * 2.00, [C4, E4, G4],  beat * 0.85, "stab"),
      note (beat * 2.00,  C6,           beat * 0.85),
      chord(beat * 3.00, [D4, F4, A4],  beat * 0.85, "stab"),
      note (beat * 3.00,  D6,           beat * 0.85),
    ];

    // Bar 7 - TENSION: sustained C#°7 diminished pad with a high trill
    // (D6-C#6) that descends chromatically into the resolution bar.
    const BAR_TENSION = [
      chord(0, [Csh4, E4, G4, Bb4], bar * 0.95, "dim"),
      // High trill - the Phantom organist on the edge
      note(beat * 0.05, D6,   0.10),
      note(beat * 0.15, Csh6, 0.10),
      note(beat * 0.25, D6,   0.10),
      note(beat * 0.35, Csh6, 0.10),
      note(beat * 0.50, D6,   beat * 0.80),
      // Chromatic descent through the tension
      note(beat * 1.40, D6,   beat * 0.35),
      note(beat * 1.75, Csh6, beat * 0.35),
      note(beat * 2.10, C6,   beat * 0.35),
      note(beat * 2.45, B5,   beat * 0.35),
      note(beat * 2.80, Bb5,  beat * 0.35),
      note(beat * 3.15, A5,   beat * 0.85),
    ];

    // Bar 8 - FULL RESOLUTION: massive multi-octave Dm crash + dramatic
    // descending sweep + final low Dm rumble. Rings into the loop restart.
    const BAR_RESOLVE = [
      chord(0, [D2, F2, A2, D3, F3, A3, D4, F4, A4, D5], beat * 1.55, "big"),
      // Descending sweep over the crash
      ...run(beat * 0.50, [D5, C5, Bb4, A4, G4, F4, E4, D4], beat * 0.18),
      chord(beat * 2.10, [D3, F3, A3, D4, F4, A4], beat * 0.85, "stab"),
      chord(beat * 3.05, [D1, D2, F2, A2], beat * 1.20, "big"),
    ];

    const bars = [
      BAR_TOC_DM, BAR_UP_GM, BAR_TOC_BB, BAR_CLIMAX,
      BAR_CLIMB1, BAR_CLIMB2, BAR_TENSION, BAR_RESOLVE,
    ];
    const basses = [D1, G1, Bb1, A1, D1, A1, A1, D1];

    this._music = {
      sub, dry, wet, conv, organIn, moogIn,
      bar, beat, bars, basses,
      barIndex: 0,
      nextBarAt: t0,
    };

    const tick = () => {
      if (!this._music) return;
      const m = this._music;
      const now = this.ctx.currentTime;
      if (m.nextBarAt < now - 1) m.nextBarAt = now + 0.1;
      while (m.nextBarAt < now + 0.25) {
        this._schedBar(m.barIndex % m.bars.length, m.nextBarAt);
        m.nextBarAt += m.bar;
        m.barIndex++;
      }
    };
    tick();
    this._musicSched = setInterval(tick, 100);
  }

  _makeCathedralIR(durSec, decay) {
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * durSec));
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _schedBar(idx, t) {
    if (!this._music) return;
    const m = this._music;
    const events = m.bars[idx];

    // Bass pattern per bar. Most bars get a single moog thump on b1;
    // the two climb bars walk the bass underfoot beat-by-beat (quieter
    // so it doesn't drown the chord stabs); the resolve bar gets a
    // second whack on b3 for a full cadence.
    if (idx === 4) {
      // BAR_CLIMB1: D E F G walking
      this._moogBass(t + m.beat * 0, 36.71, 0.55);
      this._moogBass(t + m.beat * 1, 41.20, 0.55);
      this._moogBass(t + m.beat * 2, 43.65, 0.55);
      this._moogBass(t + m.beat * 3, 49.00, 0.55);
    } else if (idx === 5) {
      // BAR_CLIMB2: A Bb C D walking
      this._moogBass(t + m.beat * 0, 55.00, 0.55);
      this._moogBass(t + m.beat * 1, 58.27, 0.55);
      this._moogBass(t + m.beat * 2, 65.41, 0.55);
      this._moogBass(t + m.beat * 3, 73.42, 0.55);
    } else {
      this._moogBass(t, m.basses[idx]);
      if (idx === 7) this._moogBass(t + m.beat * 2, m.basses[idx]);
    }

    // Moog patches per role. Each starts with a detuned saw pair, runs
    // it through a resonant lowpass, and sweeps the filter cutoff with
    // an envelope - the per-note "wow" is THE Moog signature.
    //
    // Spiny lead: snappy attack, fast filter sweep + high Q for that
    // squelchy lead character, plus light pitch vibrato.
    const meloOpts = {
      attack: 0.010, peak: 0.32, release: 0.06,
      fStart: 4200, fEnd: 1100, fSweep: 0.08, fQ: 9,
      detune: 7, voices: 2,
      vibrato: true,
    };
    // Chord stab: medium sweep, moderate Q. Each stab has the "wah"
    // attack but still leaves enough body for the chord to read.
    const stabOpts = {
      attack: 0.018, peak: 0.22, release: 0.30,
      fStart: 2000, fEnd: 480, fSweep: 0.20, fQ: 5,
      detune: 9, voices: 2,
    };
    // Sustained diminished pad: slow filter movement keeps the chord
    // breathing/swelling across the bar.
    const dimOpts = {
      attack: 0.030, peak: 0.25, release: 0.45,
      fStart: 1500, fEnd: 700, fSweep: 0.45, fQ: 6,
      detune: 11, voices: 3,
    };
    // Big crash: wide detuned stack with the filter cracked all the
    // way open, long release for a fat analog ring-out.
    const bigOpts = {
      attack: 0.015, peak: 0.30, release: 0.60,
      fStart: 2800, fEnd: 350, fSweep: 0.50, fQ: 5,
      detune: 12, voices: 3,
    };

    for (const e of events) {
      if (e.type === "note") {
        this._organVoice(t + e.when, e.dur, e.f, meloOpts);
      } else if (e.type === "chord") {
        const opts = e.kind === "dim" ? dimOpts : e.kind === "big" ? bigOpts : stabOpts;
        for (const f of e.freqs) {
          this._organVoice(t + e.when, e.dur, f, opts);
        }
      }
    }
  }

  // Moog-style subtractive voice. Detuned saw stack feeds a resonant
  // lowpass filter that's swept by an envelope on each trigger - that
  // per-note "wow" is the classic Moog signature. Used for every
  // musical element (lead, chord stab, sustained pad, climax) by
  // varying envelope, filter sweep, and resonance.
  _organVoice(t, dur, freq, opts = {}) {
    if (!this._music) return;
    const ctx = this.ctx;
    const attack  = opts.attack  ?? 0.015;
    const peak    = opts.peak    ?? 0.30;
    const release = opts.release ?? 0.08;
    const fStart  = opts.fStart  ?? 2500;
    const fEnd    = opts.fEnd    ?? 700;
    const fSweep  = opts.fSweep  ?? 0.12;
    const fQ      = opts.fQ      ?? 7;
    const detune  = opts.detune  ?? 8;
    const voices  = opts.voices  ?? 2;
    const type    = opts.type    ?? "sawtooth";

    // Amplitude envelope: attack -> hold @ peak -> release
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.setValueAtTime(peak, t + Math.max(attack + 0.02, dur - release));
    env.gain.linearRampToValueAtTime(0, t + dur);
    env.connect(this._music.organIn);

    // Resonant lowpass with sweep envelope - THE Moog sound
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = fQ;
    filt.frequency.setValueAtTime(fStart, t);
    const sweepEnd = t + Math.min(fSweep, Math.max(0.02, dur * 0.9));
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), sweepEnd);
    filt.connect(env);

    // Optional pitch vibrato (mod-wheel style) for lead notes
    let vibG = null;
    if (opts.vibrato) {
      const vibLfo = ctx.createOscillator();
      vibLfo.frequency.value = 5;
      vibG = ctx.createGain();
      vibG.gain.value = 6;
      vibLfo.connect(vibG);
      vibLfo.start(t);
      vibLfo.stop(t + dur + 0.1);
    }

    // Detuned oscillator stack - thicker = wider detune + more voices
    for (let i = 0; i < voices; i++) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = (i - (voices - 1) / 2) * detune * 2;
      if (vibG) vibG.connect(o.detune);
      o.connect(filt);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  _moogBass(t, freq, gainMult = 1.0) {
    if (!this._music) return;
    const ctx = this.ctx;
    const dur = 0.85;
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = "sawtooth";
    o2.frequency.value = freq;
    o2.detune.value = 9;
    // Signature Moog: resonant lowpass swept by a fast decay envelope.
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 12;
    filt.frequency.setValueAtTime(2200, t);
    filt.frequency.exponentialRampToValueAtTime(85, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45 * gainMult, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o1.connect(filt);
    o2.connect(filt);
    filt.connect(g).connect(this._music.moogIn);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  stopMusic() {
    if (!this.ctx || !this._music) return;
    const t = this.ctx.currentTime;
    const m = this._music;
    // Halt scheduling first so the fade only covers what's already queued.
    clearInterval(this._musicSched);
    this._musicSched = null;
    m.sub.gain.cancelScheduledValues(t);
    m.sub.gain.setValueAtTime(m.sub.gain.value, t);
    m.sub.gain.linearRampToValueAtTime(0, t + 0.8);
    this._music = null;
  }

  setMusicVolume(v) {
    if (this.musicGain) this.musicGain.gain.value = Math.max(0, Math.min(1, v));
  }
}
