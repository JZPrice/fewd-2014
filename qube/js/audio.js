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
      const a = new Audio("assets/audio/silence.wav?v=127");
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
  // Phantom / Toccata-and-Fugue D-minor pipe organ, alternating bar-by-bar
  // between a DEEP register (sub-bass + low chord swell) and a SPINY high
  // register (Bach-style mordent + descending Dm-scale phrase). Every bar
  // is anchored by a Moog-style filter-swept bass pedal on the downbeat.
  // Convolution reverb gives the whole thing a cathedral wash.
  //
  // 4-bar loop in D minor at 56 BPM:
  //   Bar 1 (Dm, DEEP)  - low chord swell + sub-bass D1
  //   Bar 2 (Gm, SPINY) - high chord swell + D5 Toccata mordent descent
  //   Bar 3 (Bb, DEEP)  - low chord swell + sub-bass Bb1
  //   Bar 4 (A7, SPINY) - high chord swell + A5 Toccata mordent climax
  //                       (lands on D at the loop restart for cadence)
  //
  // Notes are scheduled bar-by-bar via a 100ms look-ahead; oscillators
  // self-stop on their scheduled end time, so stopMusic() only needs to
  // cancel the scheduler and fade the submaster.
  startMusic() {
    if (!this.ctx || this._music) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.15;

    const conv = ctx.createConvolver();
    conv.buffer = this._makeCathedralIR(4.0, 2.4);

    const wet = ctx.createGain(); wet.gain.value = 0.65;
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

    // Tempo - slow, lurching, dramatic.
    const beat = 60 / 56;
    const bar  = beat * 4;

    // Sub-bass + bass + low-register pitches.
    const D1 = 36.71, A1 = 55.00, Bb1 = 58.27;
    const D2 = 73.42, F2 = 87.31, A2 = 110.00;
    // High-register pitches for spiny bars.
    const G3 = 196.00, Bb3 = 233.08, D4 = 293.66;
    const A3 = 220.00, Csh4 = 277.18, E4 = 329.63, G4 = 392.00;
    // Toccata mordent + descent pitches.
    const Bb4 = 466.16, G4m = 392.00, C5 = 523.25, D5 = 587.33;
    const E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.00;
    const A4 = 440.00;

    // Mordent: a 3-note ornament that opens both Toccata phrases. Quick,
    // 60ms per note, then the held note sustains for ~half a beat.
    const mord = (top, lower, holdDur) => ([
      { f: top,   when: 0.000, dur: 0.07 },
      { f: lower, when: 0.070, dur: 0.07 },
      { f: top,   when: 0.140, dur: holdDur },
    ]);

    // Bar 2 (over Gm) - high D5 Toccata mordent + descent to Gm root.
    const TOC_GM = [
      ...mord(D5, C5, beat * 0.7),
      { f: D5,  when: beat * 1.00, dur: beat * 0.45 },
      { f: C5,  when: beat * 1.50, dur: beat * 0.45 },
      { f: Bb4, when: beat * 2.00, dur: beat * 0.45 },
      { f: A4,  when: beat * 2.50, dur: beat * 0.45 },
      { f: G4m, when: beat * 3.00, dur: beat * 1.00 },
    ];
    // Bar 4 (over A7) - climactic A5 mordent + descent that lands on D
    // when the loop restarts.
    const TOC_A7 = [
      ...mord(A5, G5, beat * 0.7),
      { f: A5, when: beat * 1.00, dur: beat * 0.45 },
      { f: G5, when: beat * 1.50, dur: beat * 0.45 },
      { f: F5, when: beat * 2.00, dur: beat * 0.45 },
      { f: E5, when: beat * 2.50, dur: beat * 0.45 },
      { f: D5, when: beat * 3.00, dur: beat * 1.00 },
    ];

    const progression = [
      { name: "Dm", spiny: false, chord: [D2, F2, A2],      bass: D1 },
      { name: "Gm", spiny: true,  chord: [G3, Bb3, D4],     bass: 98.00,  melody: TOC_GM },
      { name: "Bb", spiny: false, chord: [Bb1, D2, F2],     bass: Bb1 },
      { name: "A7", spiny: true,  chord: [A3, Csh4, E4, G4], bass: A1,    melody: TOC_A7 },
    ];

    this._music = {
      sub, dry, wet, conv, organIn, moogIn,
      bar, beat, progression,
      barIndex: 0,
      nextBarAt: t0,
    };

    const tick = () => {
      if (!this._music) return;
      const m = this._music;
      const now = this.ctx.currentTime;
      if (m.nextBarAt < now - 1) m.nextBarAt = now + 0.1;
      while (m.nextBarAt < now + 0.25) {
        this._schedBar(m.barIndex % m.progression.length, m.nextBarAt);
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
    const c = m.progression[idx];

    // Chord swell across the full bar. DEEP bars get warm low harmonics
    // and a slow swell; SPINY bars get brighter upper harmonics and a
    // faster lift so the high register feels piercing.
    const chordOpts = c.spiny
      ? { attack: 0.40, peak: 0.22, release: 0.30,
          harms: [[1, 0.22], [2, 0.20], [3, 0.16], [4, 0.12], [6, 0.07], [8, 0.04]] }
      : { attack: 0.70, peak: 0.42, release: 0.35,
          harms: [[1, 0.42], [2, 0.26], [3, 0.10], [4, 0.05]] };
    for (const f of c.chord) {
      this._organVoice(t, m.bar * 0.96, f, chordOpts);
    }

    // Bass pedal on the downbeat. A7 (cadence) gets a second whack on
    // beat 3 for extra weight before the resolution.
    this._moogBass(t, c.bass);
    if (c.name === "A7") this._moogBass(t + m.beat * 2, c.bass);

    // Toccata melody, spiny tone, sharp attack.
    if (c.melody) {
      const noteOpts = {
        attack: 0.012, peak: 0.32, release: 0.06,
        harms: [[1, 0.22], [2, 0.20], [3, 0.16], [4, 0.12], [6, 0.08], [8, 0.05]],
        vibrato: true,
      };
      for (const n of c.melody) {
        this._organVoice(t + n.when, n.dur, n.f, noteOpts);
      }
    }
  }

  // Parameterized organ voice. Used for chord swells (deep + spiny) AND
  // for the melody notes - the envelope shape, peak gain, and drawbar
  // mix are the only things that change.
  _organVoice(t, dur, freq, opts = {}) {
    if (!this._music) return;
    const ctx = this.ctx;
    const attack  = opts.attack  ?? 0.18;
    const peak    = opts.peak    ?? 0.30;
    const release = opts.release ?? 0.30;
    const harms   = opts.harms   ?? [[1, 0.30], [2, 0.18], [3, 0.10], [4, 0.06]];

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.setValueAtTime(peak, t + Math.max(attack + 0.02, dur - release));
    env.gain.linearRampToValueAtTime(0, t + dur);
    env.connect(this._music.organIn);

    let vibLfo = null, vibG = null;
    if (opts.vibrato) {
      vibLfo = ctx.createOscillator();
      vibLfo.frequency.value = 5;
      vibG = ctx.createGain();
      vibG.gain.value = 7;
      vibLfo.connect(vibG);
      vibLfo.start(t);
      vibLfo.stop(t + dur + 0.1);
    }

    for (const [mult, amp] of harms) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq * mult;
      o.detune.value = (Math.random() - 0.5) * 8;
      if (vibG) vibG.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g).connect(env);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  _moogBass(t, freq) {
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
    g.gain.linearRampToValueAtTime(0.45, t + 0.005);
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
