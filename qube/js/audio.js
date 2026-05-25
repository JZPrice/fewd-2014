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
      const a = new Audio("assets/audio/silence.wav?v=136");
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
  // Mario Ghost Castle pipe organ. D minor at 80 BPM, 20-bar loop = 60s.
  // Each bar: chord stabs on beats 1+3, a low organ pedal on beat 1, a
  // chromatic walking bass underneath, and a sparse boo-laugh / chromatic
  // descent melody on selected bars (lots of rests to leave space for
  // the ghost). Pure additive-drawbar pipe organ tone through a big
  // cathedral reverb - no Moog, no kick, no constant arpeggio.
  //
  // Notes are scheduled bar-by-bar via a 100ms look-ahead; oscillators
  // self-stop on their scheduled end time, so stopMusic() only needs to
  // cancel the scheduler and fade the submaster.
  startMusic() {
    if (!this.ctx || this._music) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.15;

    // Big cathedral - ghost-chapel pipe organ wants the long ringing tail.
    const conv = ctx.createConvolver();
    conv.buffer = this._makeCathedralIR(3.6, 2.4);

    const wet = ctx.createGain(); wet.gain.value = 0.55;
    const dry = ctx.createGain(); dry.gain.value = 1.0;
    conv.connect(wet);

    const sub = ctx.createGain();
    sub.gain.setValueAtTime(0, t0);
    sub.gain.linearRampToValueAtTime(1.0, t0 + 2.0);
    dry.connect(sub);
    wet.connect(sub);
    sub.connect(this.musicGain);

    const organIn = ctx.createGain(); organIn.gain.value = 0.55;
    organIn.connect(dry);
    organIn.connect(conv);

    // 80 BPM, 20 bars = exactly 60 seconds.
    const beat = 60 / 80;
    const bar  = beat * 4;

    const SEMI = { C: 0, Cs: 1, D: 2, Eb: 3, E: 4, F: 5, Fs: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
    const p = (name, oct) => 440 * Math.pow(2, ((oct + 1) * 12 + SEMI[name] - 69) / 12);

    // Chord library (close-position mid-register voicings).
    const CHORDS = {
      Dm: [p("D", 3), p("F", 3), p("A", 3)],
      Bb: [p("Bb", 3), p("D", 4), p("F", 4)],
      A:  [p("A", 3), p("Cs", 4), p("E", 4)],
      A7: [p("A", 3), p("Cs", 4), p("E", 4), p("G", 4)],
      Gm: [p("G", 3), p("Bb", 3), p("D", 4)],
      F:  [p("F", 3), p("A", 3), p("C", 4)],
    };

    // 20-bar chord progression. Bars 1-4 hold Dm while the bass walks
    // down chromatically (D-Cs-C-B) - the signature Ghost House move.
    const PROG = [
      "Dm", "Dm", "Dm", "Dm",     // bars  1- 4: Dm w/ chromatic descending bass
      "Bb", "A",  "Dm", "A7",     // bars  5- 8: cadence
      "Dm", "F",  "Bb", "A7",     // bars  9-12: turnaround
      "Gm", "A7", "Dm", "A7",     // bars 13-16: minor-cadence
      "Dm", "Dm", "Bb", "A7",     // bars 17-20: return + V leading back to Dm
    ];

    // Chromatic walking pedal bass per bar.
    const BASS = [
      p("D", 2),  p("Cs", 2), p("C", 2),  p("B", 1),
      p("Bb", 1), p("A", 1),  p("D", 2),  p("A", 1),
      p("D", 2),  p("F", 2),  p("Bb", 1), p("A", 1),
      p("G", 1),  p("A", 1),  p("D", 2),  p("A", 1),
      p("D", 2),  p("Cs", 2), p("Bb", 1), p("A", 1),
    ];

    // Melody helpers.
    const boo = (top, neighbor) => [
      { when: 0.000, f: top,      dur: 0.06 },
      { when: 0.060, f: neighbor, dur: 0.06 },
      { when: 0.120, f: top,      dur: beat * 0.70 },
    ];
    const descent = (notes, noteDur) =>
      notes.map((f, i) => ({ when: i * noteDur, f, dur: noteDur * 0.85 }));
    const hold = (f, dur) => [{ when: 0, f, dur }];

    // Sparse Boo-laugh + chromatic-descent melodies, with rests on
    // selected bars so the ghost has room to breathe.
    const MELODY = [
      boo(p("A", 5), p("Ab", 5)),                                                   // 1
      descent([p("G", 5), p("Fs", 5), p("F", 5), p("E", 5)], beat * 0.95),          // 2
      null,                                                                          // 3 (rest)
      descent([p("Eb", 5), p("D", 5), p("C", 5), p("Bb", 4)], beat * 0.95),         // 4
      null,                                                                          // 5 (rest)
      boo(p("D", 5), p("Cs", 5)),                                                   // 6
      null,                                                                          // 7 (rest)
      hold(p("D", 5), beat * 3.4),                                                  // 8
      boo(p("A", 5), p("Ab", 5)),                                                   // 9
      descent([p("F", 5), p("E", 5), p("D", 5), p("C", 5)], beat * 0.95),           // 10
      hold(p("F", 5), beat * 3.4),                                                  // 11
      descent([p("Fs", 5), p("F", 5), p("E", 5), p("D", 5)], beat * 0.95),          // 12
      boo(p("D", 5), p("Cs", 5)),                                                   // 13
      descent([p("Cs", 5), p("C", 5), p("B", 4), p("Bb", 4)], beat * 0.95),         // 14
      hold(p("D", 5), beat * 3.4),                                                  // 15
      descent([p("C", 5), p("B", 4), p("A", 4), p("G", 4)], beat * 0.95),           // 16
      boo(p("A", 5), p("Ab", 5)),                                                   // 17
      descent([p("G", 5), p("Fs", 5), p("F", 5), p("E", 5)], beat * 0.95),          // 18
      null,                                                                          // 19
      descent([p("E", 5), p("D", 5), p("Cs", 5), p("D", 5)], beat * 0.95),          // 20
    ];

    this._music = {
      sub, dry, wet, conv, organIn,
      bar, beat, p, CHORDS, PROG, BASS, MELODY,
      barIndex: 0,
      nextBarAt: t0,
    };

    const tick = () => {
      if (!this._music) return;
      const m = this._music;
      const now = this.ctx.currentTime;
      if (m.nextBarAt < now - 1) m.nextBarAt = now + 0.1;
      while (m.nextBarAt < now + 0.25) {
        this._schedBar(m.barIndex % m.PROG.length, m.nextBarAt);
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
    const chord = m.CHORDS[m.PROG[idx]];
    const bassFreq = m.BASS[idx];
    const melody = m.MELODY[idx];

    // Pipe organ chord stab on beats 1 and 3 (Mario Ghost oompah feel).
    const chordOpts = {
      attack: 0.04, peak: 0.22, release: 0.30,
      harms: [[1, 0.32], [2, 0.20], [3, 0.10], [4, 0.05]],
    };
    for (const f of chord) {
      this._organVoice(t,                m.beat * 1.7, f, chordOpts);
      this._organVoice(t + m.beat * 2.0, m.beat * 1.7, f, chordOpts);
    }

    // Low organ pedal (chromatic walking bass) - holds across the bar.
    const bassOpts = {
      attack: 0.06, peak: 0.40, release: 0.25,
      harms: [[1, 0.55], [2, 0.30], [3, 0.10]],
    };
    this._organVoice(t, m.bar * 0.96, bassFreq, bassOpts);

    // Sparse boo-laugh / chromatic melody on selected bars only.
    if (melody) {
      const meloOpts = {
        attack: 0.012, peak: 0.30, release: 0.08,
        harms: [[1, 0.30], [2, 0.20], [3, 0.14], [4, 0.10], [6, 0.05]],
        vibrato: true,
      };
      for (const n of melody) {
        this._organVoice(t + n.when, n.dur, n.f, meloOpts);
      }
    }
  }

  // Additive pipe-organ voice. Detuned drawbar stack (1f, 2f, 3f, 4f at
  // decreasing amplitudes) with soft chiff attack and slow release.
  // Used for chord stabs, bass pedal, and melody - the harmonic mix
  // and envelope differ per role.
  _organVoice(t, dur, freq, opts = {}) {
    if (!this._music) return;
    const ctx = this.ctx;
    const attack  = opts.attack  ?? 0.05;
    const peak    = opts.peak    ?? 0.30;
    const release = opts.release ?? 0.20;
    const harms   = opts.harms   ?? [[1, 0.30], [2, 0.18], [3, 0.10], [4, 0.06]];

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.setValueAtTime(peak, t + Math.max(attack + 0.02, dur - release));
    env.gain.linearRampToValueAtTime(0, t + dur);
    env.connect(this._music.organIn);

    let vibG = null;
    if (opts.vibrato) {
      const vibLfo = ctx.createOscillator();
      vibLfo.frequency.value = 4.5;
      vibG = ctx.createGain();
      vibG.gain.value = 6;
      vibLfo.connect(vibG);
      vibLfo.start(t);
      vibLfo.stop(t + dur + 0.1);
    }

    for (const [mult, amp] of harms) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq * mult;
      o.detune.value = (Math.random() - 0.5) * 6;
      if (vibG) vibG.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g).connect(env);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
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
