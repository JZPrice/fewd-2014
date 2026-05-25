export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.fxGain = null;
    this.enabled = true;
    this._music = null;
    this._bellTimer = 0;
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
      const a = new Audio("assets/audio/silence.wav?v=125");
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
  // Dark medieval ambient drone. Two saws around A1 plus a sine sub and a
  // triangle on E2 (the fifth) feed a lowpass that gets swept slowly by an
  // LFO. Bells strike every 5-13s on a minor-pentatonic-ish set. No file
  // assets - it's all Web Audio so it stays in lock with the engine and
  // there's nothing to download.
  startMusic() {
    if (!this.ctx || this._music) return;
    const t = this.ctx.currentTime;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1.0, t + 2.5);

    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 360;
    filt.Q.value = 1.4;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 160;
    lfo.connect(lfoG).connect(filt.frequency);
    lfo.start(t);

    const oscs = [];
    const make = (freq, detuneCents, type, gain) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detuneCents;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(env);
      o.start(t);
      oscs.push(o);
    };
    make(55.00, -8, "sawtooth", 0.18);   // A1
    make(55.00, +7, "sawtooth", 0.18);   // A1 detuned partner
    make(27.50,  0, "sine",     0.20);   // A0 sub
    make(82.41,  0, "triangle", 0.10);   // E2 fifth (perfect 5th)

    env.connect(filt).connect(this.musicGain);

    this._music = { env, oscs, filt, lfo };
    this._scheduleNextBell(2500 + Math.random() * 2500);
  }

  _scheduleNextBell(ms) {
    clearTimeout(this._bellTimer);
    this._bellTimer = setTimeout(() => {
      this._strikeBell();
      this._scheduleNextBell(5000 + Math.random() * 8000);
    }, ms);
  }

  _strikeBell() {
    if (!this.ctx || !this._music) return;
    const t = this.ctx.currentTime;
    // A minor pentatonic: A3 C4 D4 E4 G4. Picks one at random per strike.
    const notes = [220, 261.63, 293.66, 329.63, 392.00];
    const f = notes[Math.floor(Math.random() * notes.length)];
    const o1 = this.ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = f;
    const o2 = this.ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = f * 2.005;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.10, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 3.5);
    o1.connect(g);
    o2.connect(g);
    g.connect(this.musicGain);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 3.6);
    o2.stop(t + 3.6);
  }

  stopMusic() {
    if (!this.ctx || !this._music) return;
    const t = this.ctx.currentTime;
    const m = this._music;
    m.env.gain.cancelScheduledValues(t);
    m.env.gain.setValueAtTime(m.env.gain.value, t);
    m.env.gain.linearRampToValueAtTime(0, t + 1.0);
    setTimeout(() => {
      for (const o of m.oscs) { try { o.stop(); } catch (_) {} }
      try { m.lfo.stop(); } catch (_) {}
    }, 1100);
    this._music = null;
    clearTimeout(this._bellTimer);
  }

  setMusicVolume(v) {
    if (this.musicGain) this.musicGain.gain.value = Math.max(0, Math.min(1, v));
  }
}
