// Audio engine: real-time synthesized V8 engine (pitch follows RPM), tyre screech,
// wind, horn, crash, near-miss whoosh, nitro + streamed music track.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
  }

  init(musicBuffer) {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    // No Web Audio support: run the game silently instead of crashing startGame().
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.noiseBuf = this._noise(2);

    // ---------- ENGINE ----------
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._distCurve(18);
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 800;
    this.engFilter.Q.value = 4;
    const engPre = ctx.createGain();
    engPre.gain.value = 0.35;
    engPre.connect(shaper).connect(this.engFilter).connect(this.engGain).connect(this.master);
    const mk = (type, mul, g) => {
      const o = ctx.createOscillator();
      o.type = type;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(engPre);
      o.start();
      return { o, mul };
    };
    this.engOsc = [mk('sawtooth', 1, 0.5), mk('square', 0.5, 0.35), mk('sawtooth', 2.01, 0.18), mk('triangle', 0.25, 0.5)];
    // rumble (low noise modulated)
    const rn = ctx.createBufferSource();
    rn.buffer = this.noiseBuf; rn.loop = true;
    this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 180;
    this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0.0;
    rn.connect(this.rumbleF).connect(this.rumbleG).connect(this.master); rn.start();

    // ---------- WIND ----------
    const wn = ctx.createBufferSource(); wn.buffer = this.noiseBuf; wn.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 600; this.windF.Q.value = 0.5;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    wn.connect(this.windF).connect(this.windG).connect(this.master); wn.start();

    // ---------- SKID ----------
    const sn = ctx.createBufferSource(); sn.buffer = this.noiseBuf; sn.loop = true;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 2400; sf.Q.value = 6;
    const sf2 = ctx.createBiquadFilter(); sf2.type = 'peaking'; sf2.frequency.value = 3200; sf2.gain.value = 12;
    this.skidG = ctx.createGain(); this.skidG.gain.value = 0;
    sn.connect(sf).connect(sf2).connect(this.skidG).connect(this.master); sn.start();
    this.skidLfo = ctx.createOscillator(); this.skidLfo.frequency.value = 13;
    const lg = ctx.createGain(); lg.gain.value = 300; this.skidLfo.connect(lg).connect(sf.frequency); this.skidLfo.start();

    // ---------- SCRAPE (guard rail) ----------
    const scn = ctx.createBufferSource(); scn.buffer = this.noiseBuf; scn.loop = true;
    const scf = ctx.createBiquadFilter(); scf.type = 'highpass'; scf.frequency.value = 3000;
    this.scrapeG = ctx.createGain(); this.scrapeG.gain.value = 0;
    scn.connect(scf).connect(this.scrapeG).connect(this.master); scn.start();

    // ---------- NITRO hiss ----------
    const nn = ctx.createBufferSource(); nn.buffer = this.noiseBuf; nn.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1500;
    this.nitroG = ctx.createGain(); this.nitroG.gain.value = 0;
    nn.connect(nf).connect(this.nitroG).connect(this.master); nn.start();

    // ---------- HORN ----------
    this.hornG = ctx.createGain(); this.hornG.gain.value = 0;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 2000;
    [415, 523].forEach(f => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hf); o.start(); });
    hf.connect(this.hornG).connect(this.master);

    // ---------- MUSIC ----------
    this.musicG = ctx.createGain(); this.musicG.gain.value = this.musicOn ? 0.28 : 0;
    this.musicG.connect(this.master);
    // Music is fetched in the background so it must be possible to attach it
    // after Start Race was pressed.
    if (musicBuffer) this.setMusicBuffer(musicBuffer);
  }

  setMusicBuffer(musicBuffer) {
    if (!this.ctx || !this.musicG || !musicBuffer || this.musicLoading || this.musicSource) return;
    this.musicLoading = true;
    this.ctx.decodeAudioData(musicBuffer.slice(0)).then(buf => {
      const source = this.ctx.createBufferSource();
      source.buffer = buf;
      source.loop = true;
      source.connect(this.musicG);
      source.start();
      this.musicSource = source;
    }).catch(() => {
      // Audio is a bonus; a bad/blocked music file must not affect gameplay.
    }).finally(() => { this.musicLoading = false; });
  }

  _noise(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _distCurve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x)); }
    return c;
  }
  _set(param, v, t = 0.05) { if (this.ctx) param.setTargetAtTime(v, this.ctx.currentTime, t); }

  update(s) {
    if (!this.ctx) return;
    const baseF = (s.rpm / 60) * 4 * 0.5; // V8 firing frequency (scaled)
    this.engOsc.forEach(e => this._set(e.o.frequency, baseF * e.mul, 0.03));
    this._set(this.engFilter.frequency, 400 + s.throttle * 2600 + s.rpm * 0.25, 0.05);
    this._set(this.engGain.gain, s.active ? 0.18 + s.throttle * 0.22 : 0, 0.08);
    this._set(this.rumbleG.gain, s.active ? 0.05 + s.throttle * 0.08 : 0, 0.1);
    this._set(this.windG.gain, s.active ? Math.min(0.35, (s.speed / 90) ** 2 * 0.35) : 0, 0.2);
    this._set(this.windF.frequency, 400 + s.speed * 12, 0.2);
    this._set(this.skidG.gain, s.active ? s.skid * 0.35 : 0, 0.05);
    this._set(this.scrapeG.gain, s.active ? s.scrape * 0.25 : 0, 0.03);
    this._set(this.nitroG.gain, s.active && s.nitro ? 0.12 : 0, 0.1);
    this._set(this.hornG.gain, s.active && s.horn ? 0.12 : 0, 0.01);
  }

  crash(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.8);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9 * power, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    n.connect(f).connect(g).connect(this.master); n.start(t); n.stop(t + 1.1);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const og = ctx.createGain(); og.gain.setValueAtTime(1.0 * power, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.6);
    // glass / metal tinkle
    for (let i = 0; i < 6; i++) {
      const m = ctx.createOscillator(); m.type = 'triangle'; m.frequency.value = 2000 + Math.random() * 4000;
      const mg = ctx.createGain(); const st = t + 0.05 + Math.random() * 0.4;
      mg.gain.setValueAtTime(0, t); mg.gain.setValueAtTime(0.08 * power, st); mg.gain.exponentialRampToValueAtTime(0.001, st + 0.25);
      m.connect(mg).connect(this.master); m.start(t); m.stop(st + 0.3);
    }
  }

  whoosh(vol = 0.5, pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.12); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; n.connect(f).connect(g).connect(p).connect(this.master); } else n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.8);
  }

  // other drivers honking (Doppler-ish falling pitch)
  trafficHorn(pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.03); g.gain.setValueAtTime(0.1, t + 0.5); g.gain.linearRampToValueAtTime(0, t + 0.7);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    [350, 440].forEach(fr => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(fr * 1.06, t); o.frequency.linearRampToValueAtTime(fr * 0.94, t + 0.7); o.connect(f); o.start(t); o.stop(t + 0.75); });
    if (p) { p.pan.value = pan; f.connect(g).connect(p).connect(this.master); } else f.connect(g).connect(this.master);
  }

  pickup(freqs = [660, 880, 1320]) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = ctx.createGain(); const st = t + i * 0.07;
      g.gain.setValueAtTime(0, t); g.gain.setValueAtTime(0.2, st); g.gain.exponentialRampToValueAtTime(0.001, st + 0.25);
      o.connect(g).connect(this.master); o.start(t); o.stop(st + 0.3);
    });
  }

  gearShift() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.connect(f).connect(g).connect(this.master); n.start(t); n.stop(t + 0.2);
    this.engGain.gain.cancelScheduledValues(t);
    this.engGain.gain.setValueAtTime(0.05, t);
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.musicG) this._set(this.musicG.gain, this.musicOn ? 0.28 : 0, 0.2);
  }

  // Ducks the entire mix on the master bus while an ad is playing and
  // restores it afterwards (a CrazyGames requirement: no game audio during ads).
  setMuted(muted) {
    this.adMuted = muted;
    if (!this.ctx || !this.master) return;
    this._set(this.master.gain, muted ? 0 : 0.8, 0.03);
  }
  suspend() { this.ctx && this.ctx.suspend(); }
  resume() { this.ctx && this.ctx.resume(); }
}
