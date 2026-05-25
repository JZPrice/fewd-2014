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
      const a = new Audio("assets/audio/silence.wav?v=133");
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
  // Berlin-school climbing-arpeggio piece in D dorian. Constant 16th-note
  // arpeggios cycle through the chord notes, a sustained pad breathes
  // behind, the Moog bass pulses underneath, and a sparse lead floats
  // on top in the later sections. The progression climbs through five
  // 8-bar sections that each add a layer of complexity. ~2 minutes
  // per loop at 78 BPM.
  //
  // Sections (each 8 bars):
  //   A (bars  1- 8): intro - arpeggio + pad + bass, no lead
  //   B (bars  9-16): + sparse ascending lead melody
  //   C (bars 17-24): walking climb - chord roots walk up scale,
  //                   walking bass under it
  //   D (bars 25-32): octave arp (two-octave climb each bar), bigger
  //                   melody phrases
  //   E (bars 33-40): climax - widest arp + ascending lead octave-jump
  //                   + final cadence back to Dm
  //
  // Notes are scheduled bar-by-bar via a 100ms look-ahead; oscillators
  // self-stop on their scheduled end time, so stopMusic() only needs to
  // cancel the scheduler and fade the submaster.
  startMusic() {
    if (!this.ctx || this._music) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.15;

    // Drier room than the previous cathedral wash - Moog wants to be
    // up-front and squelchy, not echoing through a chapel.
    const conv = ctx.createConvolver();
    conv.buffer = this._makeCathedralIR(1.4, 3.0);

    const wet = ctx.createGain(); wet.gain.value = 0.25;
    const dry = ctx.createGain(); dry.gain.value = 1.0;
    conv.connect(wet);

    const sub = ctx.createGain();
    sub.gain.setValueAtTime(0, t0);
    sub.gain.linearRampToValueAtTime(1.0, t0 + 3.0);
    dry.connect(sub);
    wet.connect(sub);
    sub.connect(this.musicGain);

    const organIn = ctx.createGain(); organIn.gain.value = 0.50;
    organIn.connect(dry);
    organIn.connect(conv);

    const moogIn = ctx.createGain(); moogIn.gain.value = 0.55;
    moogIn.connect(dry);
    moogIn.connect(conv);

    // 78 BPM = bouncy and forward-moving without feeling rushed. 40
    // bars at this tempo runs ~2:03.
    const beat = 60 / 78;
    const bar  = beat * 4;

    // Helper: midi-style pitch lookup. Cleaner than 60 named consts.
    const SEMI = { C: 0, Cs: 1, D: 2, Eb: 3, E: 4, F: 5, Fs: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
    const p = (name, oct) => 440 * Math.pow(2, ((oct + 1) * 12 + SEMI[name] - 69) / 12);

    // Chord library. `notes` is the close-position mid-register voicing;
    // `bass` is the deep root used by the Moog pulse.
    const CHORDS = {
      Dm: { notes: [p("D", 3), p("F", 3), p("A", 3)], bass: p("D", 1), arp: ["D", "F", "A"] },
      Em: { notes: [p("E", 3), p("G", 3), p("B", 3)], bass: p("E", 1), arp: ["E", "G", "B"] },
      F:  { notes: [p("F", 3), p("A", 3), p("C", 4)], bass: p("F", 1), arp: ["F", "A", "C"] },
      G:  { notes: [p("G", 3), p("B", 3), p("D", 4)], bass: p("G", 1), arp: ["G", "B", "D"] },
      Am: { notes: [p("A", 3), p("C", 4), p("E", 4)], bass: p("A", 1), arp: ["A", "C", "E"] },
      Bb: { notes: [p("Bb", 3), p("D", 4), p("F", 4)], bass: p("Bb", 1), arp: ["Bb", "D", "F"] },
      C:  { notes: [p("C", 4), p("E", 4), p("G", 4)], bass: p("C", 2), arp: ["C", "E", "G"] },
      D:  { notes: [p("D", 4), p("Fs", 4), p("A", 4)], bass: p("D", 2), arp: ["D", "Fs", "A"] },
      A7: { notes: [p("A", 3), p("Cs", 4), p("E", 4), p("G", 4)], bass: p("A", 1), arp: ["A", "Cs", "E"] },
    };

    // 40-bar progression. Bars 1-16 use the main vamp; 17-24 walk
    // chord roots up the D-dorian scale; 25-32 returns to the vamp
    // with thicker layers; 33-40 is the climax cadence.
    const PROG = [
      // Section A (intro)
      "Dm", "F", "C", "Am",  "Dm", "F", "G",  "Bb",
      // Section B (add lead)
      "Dm", "F", "C", "Am",  "Dm", "F", "G",  "Bb",
      // Section C (walking climb up D-dorian scale)
      "Dm", "Em", "F", "G",  "Am", "Bb", "C", "D",
      // Section D (back to vamp, thicker arp + bigger lead)
      "Dm", "F", "C", "Am",  "Dm", "F", "G",  "Bb",
      // Section E (climax progression with leading-tone A7)
      "Dm", "Bb", "F", "C",  "Bb", "Am", "A7", "Dm",
    ];

    // Per-section flags. complexity tunes filter brightness; lead/octave
    // gate the optional layers; walking adds a beat-by-beat bass walk.
    const SECTIONS = [
      { lead: false, octaveArp: false, walking: false, filterBrightness: 0.9 },
      { lead: true,  octaveArp: false, walking: false, filterBrightness: 1.0 },
      { lead: true,  octaveArp: false, walking: true,  filterBrightness: 1.1 },
      { lead: true,  octaveArp: true,  walking: false, filterBrightness: 1.2 },
      { lead: true,  octaveArp: true,  walking: false, filterBrightness: 1.3 },
    ];

    this._music = {
      sub, dry, wet, conv, organIn, moogIn,
      bar, beat, p, CHORDS, PROG, SECTIONS,
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
    const chordName = m.PROG[idx];
    const chord = m.CHORDS[chordName];
    const section = m.SECTIONS[Math.floor(idx / 8)];
    const bright = section.filterBrightness;

    // Per-bar Moog patches. All filter values scale with the section
    // brightness so later sections get progressively more "open".
    const arpOpts = {
      attack: 0.005, peak: 0.18, release: 0.04,
      fStart: 2400 * bright, fEnd: 1300 * bright, fSweep: 0.04, fQ: 5,
      detune: 6, voices: 2,
    };
    const padOpts = {
      attack: 0.6, peak: 0.13, release: 0.4,
      // Opens up across the bar (start dark, sweep bright) - that
      // slow filter swell is core Moog pad character.
      fStart: 600, fEnd: 1800 * bright, fSweep: m.bar * 0.7, fQ: 5,
      detune: 11, voices: 3,
    };
    const leadOpts = {
      attack: 0.015, peak: 0.30, release: 0.10,
      fStart: 3600 * bright, fEnd: 1000 * bright, fSweep: 0.10, fQ: 8,
      detune: 6, voices: 2,
      vibrato: true,
    };

    // BEAT - kick on every quarter + sub-bass pulse on every quarter,
    // for the Stranger-Things 4/4 drive underneath. Walking section
    // alternates bass root/5th to keep the climb feel. The climax
    // section doubles the bass to 8th-notes for extra urgency.
    const sectionIdx = Math.floor(idx / 8);
    const isClimax = sectionIdx === 4;
    for (let i = 0; i < 4; i++) {
      this._kick(t + i * m.beat);
      const bf = section.walking && (i % 2 === 1) ? chord.bass * 1.5 : chord.bass;
      this._pulseBass(t + i * m.beat, bf);
    }
    if (isClimax) {
      // Offbeat pulses turn the bass into 8th notes for the climax
      for (let i = 0; i < 4; i++) {
        this._pulseBass(t + (i + 0.5) * m.beat, chord.bass, 0.75);
      }
    }

    // PAD - sustained chord voicing across the bar.
    for (const f of chord.notes) {
      this._organVoice(t, m.bar * 0.97, f, padOpts);
    }

    // ARPEGGIO - 16th notes climbing through chord notes. Octave-arp
    // sections include the next octave up for a wider climbing range.
    const arpRoot = chord.arp;
    const arpFreqs = section.octaveArp
      ? [
          m.p(arpRoot[0], 4), m.p(arpRoot[1], 4), m.p(arpRoot[2], 4),
          m.p(arpRoot[0], 5), m.p(arpRoot[1], 5), m.p(arpRoot[2], 5),
          m.p(arpRoot[0], 5), m.p(arpRoot[1], 4),
        ]
      : [
          m.p(arpRoot[0], 4), m.p(arpRoot[1], 4), m.p(arpRoot[2], 4),
          m.p(arpRoot[0], 5),
        ];
    const sixteenth = m.beat * 0.25;
    for (let i = 0; i < 16; i++) {
      this._organVoice(
        t + i * sixteenth,
        sixteenth * 0.85,
        arpFreqs[i % arpFreqs.length],
        arpOpts,
      );
    }

    // LEAD - climbing 4-note phrase aligned to the chord. Plays one
    // note per beat. Sparse: only every other bar in sections B/C/D,
    // then every bar in section E (climax).
    if (section.lead) {
      const sectionIdx = Math.floor(idx / 8);
      const barInSection = idx % 8;
      const playThisBar = sectionIdx === 4 || barInSection % 2 === 1;
      if (playThisBar) {
        // Ascending chord-tone phrase: root, 3rd, 5th, octave-root.
        const oct = section.octaveArp ? 5 : 4;
        const leadPitches = [
          m.p(arpRoot[0], oct),
          m.p(arpRoot[1], oct),
          m.p(arpRoot[2], oct),
          m.p(arpRoot[0], oct + 1),
        ];
        for (let i = 0; i < 4; i++) {
          this._organVoice(
            t + i * m.beat,
            m.beat * 0.85,
            leadPitches[i],
            leadOpts,
          );
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

  // Short, plucky version of the Moog bass for the per-quarter pulse
  // pattern. Tight envelope so consecutive pulses don't smear into
  // each other. Stranger-Things "synth bass on every beat" character.
  _pulseBass(t, freq, gainMult = 1.0) {
    if (!this._music) return;
    const ctx = this.ctx;
    const dur = 0.22;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 7;
    filt.frequency.setValueAtTime(1500, t);
    filt.frequency.exponentialRampToValueAtTime(180, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.30 * gainMult, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(filt).connect(g).connect(this._music.moogIn);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Kick drum: pitched sine sweep (130->45Hz over 60ms) for the body
  // plus a short noise click for transient definition. Drives the 4/4
  // pulse underneath the music.
  _kick(t) {
    if (!this._music) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    o.connect(g).connect(this._music.moogIn);
    o.start(t);
    o.stop(t + 0.2);

    // Transient click on top
    const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * 0.018));
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const nf = ctx.createBiquadFilter();
    nf.type = "highpass";
    nf.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.value = 0.16;
    noise.connect(nf).connect(ng).connect(this._music.moogIn);
    noise.start(t);
    noise.stop(t + 0.025);
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
