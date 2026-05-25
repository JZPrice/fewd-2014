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
      const a = new Audio("assets/audio/silence.wav?v=126");
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
  // Sword-and-sorcery pipe organ: additive sawtooth drawbars (1f, 2f, 3f,
  // 4f) feed a synthetic cathedral convolution reverb for that ringing
  // dungeon-cathedral wash. A separate Moog-style filter-swept saw bass
  // pulses on each downbeat. A sparse high melody line surfaces on the
  // cadence bar (A7 -> Dm) for Phantom-y drama.
  //
  // 4-bar progression in D minor at 64 BPM, loops indefinitely. Notes are
  // scheduled bar-by-bar via a 100ms look-ahead; oscillators self-stop on
  // their scheduled end time, so stopMusic() only needs to cancel the
  // scheduler and fade the submaster.
  startMusic() {
    if (!this.ctx || this._music) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.15;

    // Cathedral reverb: synthetic exponentially-decaying noise impulse.
    const conv = ctx.createConvolver();
    conv.buffer = this._makeCathedralIR(3.8, 2.5);

    const wet = ctx.createGain(); wet.gain.value = 0.55;
    const dry = ctx.createGain(); dry.gain.value = 1.0;
    conv.connect(wet);

    const sub = ctx.createGain();
    sub.gain.setValueAtTime(0, t0);
    sub.gain.linearRampToValueAtTime(1.0, t0 + 2.5);
    dry.connect(sub);
    wet.connect(sub);
    sub.connect(this.musicGain);

    // Per-layer entry points: organ chords + melody share a bus; bass
    // gets its own with less reverb so it stays defined in the mix.
    const organIn = ctx.createGain(); organIn.gain.value = 0.55;
    organIn.connect(dry);
    organIn.connect(conv);

    const moogIn = ctx.createGain(); moogIn.gain.value = 0.50;
    moogIn.connect(dry);
    moogIn.connect(conv);

    // Tempo + bars. 64 BPM = stately, lurching.
    const beat = 60 / 64;
    const bar  = beat * 4;

    // 4-bar D-minor progression. Notes in mid-register so the bass below
    // has room to thump. Bass plays the root one octave lower.
    const D3 = 146.83, F3 = 174.61, A3 = 220.00;
    const G3 = 196.00, Bb3 = 233.08, D4 = 293.66;
    const Csh4 = 277.18, E4 = 329.63, G4 = 392.00;

    const progression = [
      { name: "Dm", chord: [D3, F3, A3],           bass: 73.42 },   // D2
      { name: "Gm", chord: [G3, Bb3, D4],          bass: 98.00 },   // G2
      { name: "Bb", chord: [Bb3, D4, F3 * 2],      bass: 116.54 },  // Bb2
      { name: "A7", chord: [A3, Csh4, E4, G4],     bass: 110.00 },  // A2
    ];

    // Descending Dm-scale melody fragment, played over the A7 cadence
    // bar so it lands on Dm when the loop restarts.
    const F4 = 349.23, A4 = 440.00;
    const melodyCadence = [
      { f: A4, when: 0,        dur: beat * 1.0 },
      { f: G4, when: beat,     dur: beat * 1.0 },
      { f: F4, when: beat * 2, dur: beat * 1.0 },
      { f: E4, when: beat * 3, dur: beat * 1.0 },
    ];

    this._music = {
      sub, dry, wet, conv, organIn, moogIn,
      bar, beat, progression, melodyCadence,
      barIndex: 0,
      nextBarAt: t0,
    };

    const tick = () => {
      if (!this._music) return;
      const m = this._music;
      const now = this.ctx.currentTime;
      // If the page was backgrounded and we're hopelessly behind, snap
      // forward so we don't dump a pile of overlapping bars at once.
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
    const chord = m.progression[idx];

    // Sustained organ chord across the bar
    for (const f of chord.chord) {
      this._organNote(t, m.bar * 0.96, f);
    }

    // Moog bass pulse on beat 1
    this._moogBass(t, chord.bass);

    // Melody only on the cadence (A7) bar so it isn't constant
    if (chord.name === "A7") {
      for (const n of m.melodyCadence) {
        this._melodyNote(t + n.when, n.dur, n.f);
      }
    }
  }

  _organNote(t, dur, freq) {
    if (!this._music) return;
    const ctx = this.ctx;
    // Soft attack ("chiff"), full sustain, slow release: pipe-organ envelope.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.30, t + 0.18);
    env.gain.setValueAtTime(0.30, t + Math.max(0.3, dur - 0.30));
    env.gain.linearRampToValueAtTime(0, t + dur);
    env.connect(this._music.organIn);

    // Drawbar additive synthesis: fundamental + 2f, 3f, 4f at decreasing
    // amplitudes. Slight per-osc detune for shimmer (organ ranks aren't
    // perfectly tuned).
    const harms = [[1, 0.30], [2, 0.18], [3, 0.10], [4, 0.06]];
    for (const [mult, amp] of harms) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq * mult;
      o.detune.value = (Math.random() - 0.5) * 8;
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
    const dur = 0.65;
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = "sawtooth";
    o2.frequency.value = freq;
    o2.detune.value = 9;
    // The signature Moog: resonant lowpass swept by a fast decay envelope.
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 11;
    filt.frequency.setValueAtTime(1900, t);
    filt.frequency.exponentialRampToValueAtTime(95, t + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.40, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o1.connect(filt);
    o2.connect(filt);
    filt.connect(g).connect(this._music.moogIn);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  _melodyNote(t, dur, freq) {
    if (!this._music) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    // Light vibrato for drama
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 8;
    lfo.connect(lfoG).connect(o.detune);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 2400;
    filt.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.04);
    g.gain.setValueAtTime(0.22, t + Math.max(0.05, dur - 0.15));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(filt).connect(g).connect(this._music.organIn);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
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
