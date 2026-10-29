/*
 * sound.js — a generated soundscape for the tree (no audio files).
 *
 * Wind and leaf rustle are filtered noise; birdsong, the cardinal's whistle,
 * crickets and the swing's creak are scheduled oscillator phrases. Off until
 * the visitor turns it on (browsers only allow audio after a click).
 */
(function (global) {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function create() {
    let ctx = null, master = null, verb = null, on = false, timer = null, noiseBuf = null;
    let wind, windLow, rustle;
    const crickets = [];
    const state = { birds: 0, cardinal: false, crickets: 0 };
    let nextBird = 0, nextCardinal = 0, lastUpdate = 0;

    function pinkNoise(seconds) {
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
        }
      }
      return buf;
    }

    function noiseLayer(type, freq, q) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(master);
      src.start(0, Math.random() * noiseBuf.duration);
      return { f, g };
    }

    function build() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3;
      master.connect(comp).connect(ctx.destination);

      // a little air around the birds: two damped feedback delays
      verb = ctx.createGain();
      verb.gain.value = 0.25;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass'; damp.frequency.value = 3200;
      for (const [dt, fb] of [[0.071, 0.34], [0.113, 0.28]]) {
        const d = ctx.createDelay(1), g = ctx.createGain();
        d.delayTime.value = dt; g.gain.value = fb;
        verb.connect(d); d.connect(g).connect(d); d.connect(damp);
      }
      damp.connect(master);

      noiseBuf = pinkNoise(5);
      wind = noiseLayer('bandpass', 380, 0.8);
      windLow = noiseLayer('lowpass', 170, 0.7);
      rustle = noiseLayer('highpass', 2600, 0.6);

      for (const f of [4300, 4720, 5150]) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = 0;
        const p = ctx.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 1.4;
        o.connect(g).connect(p).connect(master);
        o.start();
        crickets.push({ g, next: 0 });
      }
      timer = setInterval(schedule, 100);
      return true;
    }

    function note(t, f0, f1, dur, vol, pan, vib) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      if (vib) {
        const l = ctx.createOscillator(), lg = ctx.createGain();
        l.frequency.value = vib[0]; lg.gain.value = vib[1];
        l.connect(lg).connect(o.frequency);
        l.start(t); l.stop(t + dur + 0.03);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      o.connect(g).connect(p);
      p.connect(master); p.connect(verb);
      o.start(t); o.stop(t + dur + 0.04);
    }

    function songbird(t) {
      const pan = (Math.random() - 0.5) * 1.4, kind = Math.random();
      const vol = 0.03 + Math.random() * 0.03;
      if (kind < 0.45) {                     // a carolling phrase
        let tt = t;
        const n = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const base = 2200 + Math.random() * 1600, d = 0.09 + Math.random() * 0.12;
          note(tt, base, base * (0.75 + Math.random() * 0.6), d, vol, pan);
          tt += d + 0.04 + Math.random() * 0.08;
        }
      } else if (kind < 0.75) {              // a finch's trill and flourish
        let tt = t;
        const n = 6 + Math.floor(Math.random() * 8), f = 4200 + Math.random() * 1800;
        for (let i = 0; i < n; i++) { note(tt, f * 1.1, f * 0.85, 0.045, vol * 0.8, pan); tt += 0.06; }
        note(tt + 0.02, f * 0.8, f * 1.25, 0.16, vol, pan, [38, 260]);
      } else {                               // sparrow chips
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) note(t + i * 0.2, 5200, 3800, 0.035, vol * 0.8, pan);
      }
    }

    function cardinal(t) {                   // "cheer, cheer, cheer"
      const n = 3 + Math.floor(Math.random() * 3), pan = -0.35 + Math.random() * 0.2;
      for (let i = 0; i < n; i++) note(t + i * 0.32, 3900, 2100, 0.24, 0.045, pan);
    }

    function chirp(c, t, amt) {
      for (let k = 0; k < 3; k++) {
        const s = t + k * 0.036;
        c.g.gain.setValueAtTime(0, s);
        c.g.gain.linearRampToValueAtTime(0.011 * amt, s + 0.006);
        c.g.gain.linearRampToValueAtTime(0, s + 0.022);
      }
    }

    function schedule() {
      if (!on || !ctx) return;
      const now = ctx.currentTime, ahead = now + 0.3;
      if (state.birds > 0.05) {
        if (nextBird < now) nextBird = now + Math.random() * 0.6;
        while (nextBird < ahead) { songbird(nextBird); nextBird += (1.4 + Math.random() * 3.6) / state.birds; }
      }
      if (state.cardinal) {
        if (nextCardinal < now) nextCardinal = now + 0.5 + Math.random() * 2;
        while (nextCardinal < ahead) { cardinal(nextCardinal); nextCardinal += 5 + Math.random() * 6; }
      }
      if (state.crickets > 0.05) {
        for (const c of crickets) {
          if (c.next < now) c.next = now + Math.random() * 0.8;
          while (c.next < ahead) { chirp(c, c.next, state.crickets); c.next += 0.5 + Math.random() * 0.45; }
        }
      }
    }

    // p: { wind 0..1, gust 0..1, foliage 0..1, snowing 0..1, birds 0..1, cardinal bool, crickets 0..1 }
    function update(p) {
      if (!on || !ctx) return;
      const now = ctx.currentTime;
      if (now - lastUpdate < 0.08) return;
      lastUpdate = now;
      const breath = 0.6 + 0.4 * Math.sin(now * 0.23) * Math.sin(now * 0.071 + 1);
      const w = clamp(p.wind * (0.55 + 0.45 * breath) + p.gust * 0.6, 0, 1.4);
      const muffle = p.snowing;
      wind.g.gain.setTargetAtTime((0.05 + 0.15 * w) * (1 - 0.55 * muffle), now, 0.3);
      wind.f.frequency.setTargetAtTime((280 + 520 * w) * (1 - 0.45 * muffle), now, 0.4);
      windLow.g.gain.setTargetAtTime(0.05 + 0.07 * w, now, 0.5);
      rustle.g.gain.setTargetAtTime(p.foliage * (0.01 + 0.06 * w + 0.12 * p.gust), now, 0.15);
      state.birds = p.birds;
      state.cardinal = p.cardinal;
      state.crickets = p.crickets;
    }

    function creak() {
      if (!on || !ctx) return;
      const t = ctx.currentTime + 0.01;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(200, t);
      o.frequency.linearRampToValueAtTime(150, t + 0.24);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.03, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.connect(bp).connect(g).connect(master);
      o.start(t); o.stop(t + 0.3);
    }

    // geese overhead: a few nasal two-note honks, now and then, far off
    let nextHonk = 0;
    function geese() {
      if (!on || !ctx) return;
      const now = ctx.currentTime;
      if (now < nextHonk) return;
      nextHonk = now + 0.6 + Math.random() * 1.6;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const t = now + 0.05 + i * (0.16 + Math.random() * 0.12), f = 300 + Math.random() * 80;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.92, t);
        o.frequency.linearRampToValueAtTime(f * 1.06, t + 0.05);
        o.frequency.linearRampToValueAtTime(f * 0.95, t + 0.16);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 300; bp.Q.value = 3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.022, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
        const p = ctx.createStereoPanner(); p.pan.value = 0.6 - Math.random() * 0.4;
        o.connect(bp).connect(g).connect(p);
        p.connect(master); p.connect(verb);
        o.start(t); o.stop(t + 0.2);
      }
    }

    function shake(kind) {
      if (!on || !ctx) return;
      const t = ctx.currentTime;
      rustle.g.gain.cancelScheduledValues(t);
      rustle.g.gain.setTargetAtTime(kind === 'snow' ? 0.05 : kind ? 0.2 : 0.1, t, 0.02);
      rustle.g.gain.setTargetAtTime(0.02, t + 0.3, 0.45);
      if (kind === 'snow') {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 320;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        src.connect(lp).connect(g).connect(master);
        src.start(t, Math.random() * 3); src.stop(t + 0.7);
      }
    }

    async function setOn(v) {
      if (v && !ctx && !build()) return false;
      on = v;
      if (!ctx) return false;
      const t = ctx.currentTime;
      if (v) {
        await ctx.resume();
        master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
      } else {
        master.gain.setTargetAtTime(0, t, 0.15);
        setTimeout(() => { if (!on && ctx) ctx.suspend(); }, 800);
      }
      return on;
    }

    return { setOn, update, creak, shake, geese, get on() { return on; } };
  }

  global.TreeSound = { create };
})(typeof window !== 'undefined' ? window : globalThis);
