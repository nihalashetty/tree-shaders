/*
 * actors.js — the life around the tree.
 *
 * Birds (a nest with chicks, migrating geese, a winter cardinal, spring
 * visitors), a squirrel, butterflies, bees, fireflies, wildflowers, a girl
 * on a rope swing, a snowman, and, a lifetime later, the same girl grown
 * old on a bench under the blossom.
 *
 * Sprites are drawn once into an atlas with the same tone encoding as the
 * leaves (red = tone; green above red = accent 1; blue above red = accent 2)
 * and stippled in the shader like the bark. Each frame update() lays out a
 * few hundred instances on the CPU: people are jointed rigs, flying birds
 * have jointed wings flapping in 3D, and the swing, the ponytail and
 * anything shaken loose are simulated.
 */
(function (global) {
  'use strict';

  const CELL = 256, COLS = 8, ROWS = 6;
  const C = {
    BIRD: 0, BIRD_PECK: 1, CARDINAL: 2, CARDINAL_PECK: 3, FLYBODY: 4, FLYBODY_CREST: 5, GOOSE: 6, WING_IN: 7,
    WING_OUT: 8, NEST: 9, NEST_SNOW: 10, CHICK_OPEN: 11, CHICK: 12, SQ_RUN_A: 13, SQ_RUN_B: 14, SQ_SIT: 15,
    BUTTERFLY: 16, BEE: 17, LIMB: 18, LIMB_CAP: 19, HEAD_GIRL: 20, TORSO_GIRL: 21, SKIRT_GIRL: 22, HAIRLOCK: 23,
    SHOE: 24, HEAD_OLD: 25, TORSO_OLD: 26, SKIRT_OLD: 27, SEAT: 28, SOLID: 29, SNOWBALL: 30, CARROT: 31,
    TWIG: 32, DOT: 33, BENCH: 34, SHADOW: 35, DAISY: 36, BUTTERCUP: 37, MUSHROOMS: 38, GLOW: 39,
    PUFF: 40, PRINTS: 41, LEAF: 42, PETAL: 43, SNOWCAP: 44, BENCH_NEAR: 45,
  };
  const FLOATS = 24;   // per instance: 6 × vec4 (see ACTOR_VS in app.js)

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ramp = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
  const smooth = (a, b, x) => { const t = ramp(x, a, b); return t * t * (3 - 2 * t); };
  const fract = (x) => x - Math.floor(x);
  const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mixc = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
  const mixPal = (a, b, t) => a.map((c, i) => mixc(c, b[i], t));
  const rr = (a, b) => a + (b - a) * Math.random();

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // base, light, accent 1, accent 2
  const pal = (...h) => h.map(hex);
  const PAL = {
    robin: pal('#5d4c40', '#ddd0bf', '#c66a3b', '#2b2521'),
    finch: pal('#5f6040', '#e6e0b6', '#cfae45', '#2a2a20'),
    sparrow: pal('#4f4a44', '#d9d2c6', '#8f8274', '#2d2722'),
    cardinal: pal('#a52e29', '#ecb7a8', '#c4473c', '#161312'),
    goose: pal('#5d564d', '#d9d2c5', '#1e1c1a', '#f1eee6'),
    nest: pal('#5e4934', '#c9b494', '#5e4934', '#2a2018'),
    chick: pal('#776757', '#e3d8c8', '#e8ad3c', '#2b2521'),
    squirrel: pal('#8a4528', '#ecc9a4', '#efd9bd', '#6a4022'),
    girlSkin: pal('#d2a083', '#f8e8db', '#c0453c', '#4b3326'),   // blush + ribbon, hair
    girlDress: pal('#c98f3a', '#f5e6c2', '#f7f2e8', '#6b4a26'),  // collar, sash
    hair: pal('#4b3326', '#a27c5e', '#4b3326', '#2a1c14'),
    shoe: pal('#3b2b25', '#a08a80', '#3b2b25', '#3b2b25'),
    oldSkin: pal('#c69a82', '#f4e3d6', '#3a3431', '#cfcbc4'),     // glasses, grey hair
    cardigan: pal('#687a8e', '#d8dfe8', '#ad4a40', '#2e3540'),    // the ribbon's red, in a shawl
    oldSkirt: pal('#4b4652', '#c9c3cd', '#4b4652', '#2a262e'),
    stocking: pal('#5b5661', '#bbb5bf', '#5b5661', '#5b5661'),
    rope: pal('#8c7659', '#ddcdb1', '#8c7659', '#5a4a38'),
    wood: pal('#6a5341', '#d8c6ae', '#8a6b4f', '#3a2c22'),
    bench: pal('#7b5f45', '#e0ccb0', '#8a6b4f', '#2f2e2c'),
    snow: pal('#a9b5c2', '#fbfcfd', '#dfe5ec', '#7b8794'),
    carrot: pal('#2b2a28', '#f0e3d0', '#d47a35', '#2b2a28'),
    scarf: pal('#7b2f2c', '#d9a49a', '#7b2f2c', '#3a1c1a'),
    mushroom: pal('#5c4b3c', '#efe6d6', '#9a4f30', '#3a2b22'),
    bee: pal('#2a261f', '#f2efe6', '#d9ad3c', '#2a261f'),
    glow: pal('#000000', '#f1f6a8', '#f1f6a8', '#f1f6a8'),
    ink: pal('#15321f', '#e6e1d6', '#15321f', '#15321f'),
  };
  const BUTTERFLIES = [
    pal('#cdb25e', '#f6efc9', '#b5862f', '#3a3226'),
    pal('#c8c3b5', '#fbf9f2', '#9aa0a8', '#3a3836'),
    pal('#c7733a', '#f2d2ad', '#e3a14d', '#3a2a20'),
    pal('#7489ac', '#dfe6f1', '#a8b8d4', '#2b3240'),
  ];
  const darkCache = new Map();
  const darker = (p, k = 0.72) => {
    let d = darkCache.get(p);
    if (!d) { d = p.map((c) => c.map((v) => v * k)); darkCache.set(p, d); }
    return d;
  };

  // ---------------------------------------------------------------- atlas
  function buildAtlas(drawLeaf, drawPetal) {
    const cv = document.createElement('canvas');
    cv.width = CELL * COLS;
    cv.height = CELL * ROWS;
    const ctx = cv.getContext('2d');
    const R = mulberry32(4242);
    const rnd = (a, b) => a + (b - a) * R();
    const tone = (t, a = 1) => { const v = Math.round(t * 255); return `rgba(${v},${v},${v},${a})`; };
    const acc1 = (t, a = 1) => { const v = Math.round(t * 255); return `rgba(${v},255,${v},${a})`; };
    const acc2 = (t, a = 1) => { const v = Math.round(t * 255); return `rgba(${v},${v},255,${a})`; };
    const INK = tone(0.04);
    const seg = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    const circ = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    const ell = (x, y, rx, ry, a = 0) => { const p = new Path2D(); p.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); return p; };
    // outline the union of several shapes: wide ink stroke first, fills on top
    const inked = (paths, fill, w = 3) => {
      ctx.strokeStyle = INK;
      ctx.lineWidth = w * 2;
      for (const p of paths) ctx.stroke(p);
      ctx.fillStyle = fill;
      for (const p of paths) ctx.fill(p);
    };
    // light from the upper left, like the tree: a soft tonal gradient inside a shape
    const shade = (path, x0, y0, x1, y1, a = 0.75) => {
      ctx.save(); ctx.clip(path);
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, tone(0.78, a)); g.addColorStop(0.45, tone(0.36, 0)); g.addColorStop(1, tone(0.1, a));
      ctx.fillStyle = g; ctx.fillRect(0, 0, CELL, CELL);
      ctx.restore();
    };
    const roundShade = (path, cx, cy, r, a = 0.8) => {
      ctx.save(); ctx.clip(path);
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r * 1.15);
      g.addColorStop(0, tone(0.8, a)); g.addColorStop(0.5, tone(0.36, 0)); g.addColorStop(1, tone(0.08, a));
      ctx.fillStyle = g; ctx.fillRect(0, 0, CELL, CELL);
      ctx.restore();
    };
    const cell = (i, fn) => {
      ctx.save();
      ctx.translate((i % COLS) * CELL, Math.floor(i / COLS) * CELL);
      ctx.beginPath(); ctx.rect(2, 2, CELL - 4, CELL - 4); ctx.clip();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      fn();
      ctx.restore();
    };

    // songbird perched, facing right; feet at (124, 214)
    function bird(peck, crest) {
      const hx = peck ? 178 : 166, hy = peck ? 140 : 100;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      seg(116, 184, 112, 214); seg(132, 184, 134, 214);
      seg(100, 214, 124, 214); seg(122, 214, 146, 214);
      const body = new Path2D();
      body.moveTo(58, 178);
      body.bezierCurveTo(68, 122, 118, 104, 160, 116);
      body.bezierCurveTo(188, 128, 194, 164, 172, 182);
      body.bezierCurveTo(150, 200, 98, 200, 58, 178);
      const tail = new Path2D();
      tail.moveTo(84, 166); tail.lineTo(20, 204); tail.lineTo(30, 214); tail.lineTo(94, 186); tail.closePath();
      const head = new Path2D();
      head.arc(hx, hy, 28, 0, Math.PI * 2);
      const parts = [tail, body, head];
      if (crest) {
        const c = new Path2D();
        c.moveTo(hx - 14, hy - 18); c.quadraticCurveTo(hx - 30, hy - 44, hx - 40, hy - 58);
        c.quadraticCurveTo(hx - 8, hy - 44, hx + 8, hy - 24); c.closePath();
        parts.push(c);
      }
      inked(parts, tone(0.36));
      shade(body, 70, 110, 120, 200);
      roundShade(head, hx, hy, 28);
      ctx.save();
      ctx.clip(body);
      ctx.fillStyle = acc1(0.45, 0.95);
      ctx.beginPath(); ctx.ellipse(166, 170, 42, 36, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.clip(head);
      ctx.fillStyle = acc2(0.16, 0.95);
      ctx.beginPath(); ctx.ellipse(hx + 17, hy + (peck ? 8 : 3), 17, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      const wing = new Path2D();
      wing.moveTo(156, 128);
      wing.bezierCurveTo(122, 118, 86, 140, 64, 182);
      wing.bezierCurveTo(100, 182, 138, 168, 158, 148);
      wing.closePath();
      ctx.fillStyle = tone(0.2);
      ctx.fill(wing);
      ctx.strokeStyle = tone(0.66, 0.75);
      ctx.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.moveTo(144 - k * 14, 136 + k * 5);
        ctx.quadraticCurveTo(120 - k * 12, 150 + k * 6, 86 - k * 5, 176 + k * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.stroke(wing);
      const beak = new Path2D();
      if (peck) { beak.moveTo(hx + 16, hy + 14); beak.lineTo(hx + 30, hy + 42); beak.lineTo(hx + 4, hy + 24); }
      else { beak.moveTo(hx + 22, hy - 8); beak.lineTo(hx + 48, hy + 2); beak.lineTo(hx + 22, hy + 10); }
      beak.closePath();
      ctx.fillStyle = tone(crest ? 0.95 : 0.78);
      ctx.fill(beak);
      ctx.stroke(beak);
      ctx.fillStyle = tone(0.02);
      circ(hx + 9, hy - (peck ? 0 : 5), 5);
      ctx.fillStyle = tone(1);
      circ(hx + 10.5, hy - (peck ? 1.5 : 6.5), 1.8);
    }

    // songbird in flight, without its wings (they are jointed sprites of
    // their own); facing right, body centred, shoulder at (138, 116)
    function flyBody(crest) {
      const body = new Path2D();
      body.moveTo(66, 130);
      body.bezierCurveTo(84, 106, 138, 100, 166, 112);
      body.bezierCurveTo(188, 122, 186, 144, 164, 150);
      body.bezierCurveTo(130, 160, 88, 154, 66, 130);
      const head = new Path2D(); head.arc(178, 118, 20, 0, Math.PI * 2);
      const tail = new Path2D();
      tail.moveTo(84, 124); tail.lineTo(22, 112); tail.lineTo(16, 130); tail.lineTo(24, 148); tail.lineTo(86, 140); tail.closePath();
      const parts = [tail, body, head];
      if (crest) {
        const c = new Path2D();
        c.moveTo(168, 104); c.quadraticCurveTo(156, 84, 140, 74); c.quadraticCurveTo(168, 82, 184, 100); c.closePath();
        parts.push(c);
      }
      inked(parts, tone(0.36));
      shade(body, 90, 100, 110, 160);
      roundShade(head, 178, 118, 20);
      ctx.save(); ctx.clip(body);
      ctx.fillStyle = acc1(0.45, 0.95);
      ctx.beginPath(); ctx.ellipse(162, 146, 30, 14, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tone(0.75, 0.5);
      ctx.beginPath(); ctx.ellipse(118, 150, 34, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.clip(head);
      ctx.fillStyle = acc2(0.16, 0.95);
      ctx.beginPath(); ctx.ellipse(190, 122, 13, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = tone(0.2, 0.7); ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) seg(30, 120 + k * 9, 84, 128 + k * 4);
      const beak = new Path2D(); beak.moveTo(194, 112); beak.lineTo(216, 119); beak.lineTo(194, 126); beak.closePath();
      ctx.fillStyle = tone(crest ? 0.95 : 0.78); ctx.fill(beak);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke(beak);
      ctx.fillStyle = tone(0.02); circ(184, 114, 4);
      ctx.fillStyle = tone(1); circ(185.2, 112.8, 1.4);
    }

    // a goose in flight, wingless, facing right: long dark neck, pale chin strap
    function goose() {
      const body = new Path2D();
      body.moveTo(40, 140);
      body.bezierCurveTo(56, 116, 120, 112, 158, 122);
      body.bezierCurveTo(176, 128, 176, 150, 152, 156);
      body.bezierCurveTo(110, 166, 60, 160, 40, 140);
      const tail = new Path2D();
      tail.moveTo(52, 136); tail.lineTo(18, 132); tail.lineTo(20, 148); tail.lineTo(54, 148); tail.closePath();
      const neck = new Path2D();
      neck.moveTo(150, 124); neck.quadraticCurveTo(186, 112, 214, 112);
      neck.lineTo(218, 126); neck.quadraticCurveTo(188, 128, 160, 146); neck.closePath();
      const head = ell(222, 116, 15, 11, -0.1);
      inked([tail, body, neck, head], tone(0.36));
      shade(body, 70, 112, 90, 166);
      ctx.save(); ctx.clip(body);
      ctx.fillStyle = tone(0.85, 0.85);
      ctx.beginPath(); ctx.ellipse(60, 150, 26, 10, 0.2, 0, Math.PI * 2); ctx.fill();   // pale undertail
      ctx.strokeStyle = tone(0.62, 0.5); ctx.lineWidth = 2;
      for (let k = 0; k < 5; k++) seg(80 + k * 16, 122, 74 + k * 16, 150);
      ctx.restore();
      ctx.fillStyle = acc1(0.1);
      ctx.fill(neck); ctx.fill(head);
      ctx.fillStyle = acc2(0.95);
      ctx.beginPath(); ctx.ellipse(214, 122, 7, 5, -0.3, 0, Math.PI * 2); ctx.fill();
      const bill = new Path2D(); bill.moveTo(234, 112); bill.lineTo(252, 118); bill.lineTo(234, 122); bill.closePath();
      ctx.fillStyle = acc1(0.1); ctx.fill(bill);
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke(bill);
      ctx.fillStyle = tone(0.9); circ(226, 113, 1.8);
    }

    // wing parts: the span runs up the cell (root at the bottom), the
    // leading edge is on the right
    function wingInner() {
      const p = new Path2D();
      p.moveTo(212, 254);
      p.bezierCurveTo(222, 170, 222, 80, 214, 2);
      p.lineTo(60, 2);
      let y = 2;
      for (let k = 0; k < 7; k++) {
        const y1 = 2 + (k + 1) * 36;
        p.quadraticCurveTo(30 + k * 2, (y + y1) / 2, 58 + k * 3, Math.min(254, y1));
        y = y1;
      }
      p.closePath();
      inked([p], tone(0.3), 2.5);
      ctx.save(); ctx.clip(p);
      const g = ctx.createLinearGradient(220, 0, 40, 0);
      g.addColorStop(0, tone(0.62, 0.9)); g.addColorStop(0.35, tone(0.4, 0.4)); g.addColorStop(1, tone(0.12, 0.7));
      ctx.fillStyle = g; ctx.fillRect(0, 0, CELL, CELL);
      // coverts
      ctx.fillStyle = tone(0.5, 0.65);
      for (let k = 0; k < 8; k++) { ctx.beginPath(); ctx.ellipse(186, 20 + k * 32, 30, 18, 0.3, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = tone(0.06, 0.7); ctx.lineWidth = 2;
      for (let k = 0; k < 8; k++) seg(170, 10 + k * 32, 54 + k * 2, 30 + k * 32);
      ctx.restore();
    }
    function wingOuter() {
      const feathers = [];
      for (let k = 0; k < 6; k++) {
        const bx = 206 - k * 26, tx = 168 - k * 22, ty = 4 + k * 16;
        const p = new Path2D();
        p.moveTo(bx + 10, 254);
        p.quadraticCurveTo(tx + 26, (254 + ty) / 2, tx, ty);
        p.quadraticCurveTo(tx - 16, (254 + ty) / 2 + 20, bx - 22, 254);
        p.closePath();
        feathers.push(p);
      }
      inked(feathers, tone(0.24), 2.5);
      ctx.strokeStyle = tone(0.6, 0.6); ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const bx = 206 - k * 26, tx = 168 - k * 22, ty = 4 + k * 16;
        ctx.beginPath(); ctx.moveTo(bx - 4, 250); ctx.quadraticCurveTo(tx + 8, (254 + ty) / 2 + 4, tx + 2, ty + 10); ctx.stroke();
      }
      const cov = new Path2D();
      cov.moveTo(222, 254); cov.quadraticCurveTo(220, 190, 190, 150); cov.quadraticCurveTo(150, 190, 80, 254); cov.closePath();
      ctx.fillStyle = tone(0.46); ctx.fill(cov);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke(cov);
    }

    function nest() {
      const cup = new Path2D();
      cup.moveTo(34, 116);
      cup.bezierCurveTo(40, 200, 216, 200, 222, 116);
      cup.bezierCurveTo(184, 136, 72, 136, 34, 116);
      inked([cup], tone(0.36));
      ctx.save(); ctx.clip(cup);
      for (let k = 0; k < 170; k++) {
        const x = rnd(30, 226), y = rnd(112, 196), l = rnd(18, 50), a = rnd(-0.5, 0.5);
        ctx.strokeStyle = R() < 0.55 ? tone(0.08, 0.9) : tone(0.7, 0.7);
        ctx.lineWidth = rnd(1.5, 3);
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + l * 0.5, y + rnd(-10, 10), x + l * Math.cos(a), y + l * Math.sin(a));
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = tone(0.03);
      ctx.beginPath(); ctx.ellipse(128, 114, 78, 13, 0, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 40; k++) {
        const a = rnd(0, Math.PI * 2), x = 128 + Math.cos(a) * 86, y = 116 + Math.sin(a) * 15;
        ctx.strokeStyle = R() < 0.5 ? INK : tone(0.6);
        ctx.lineWidth = rnd(1.5, 3);
        seg(x, y, x + rnd(-26, 26), y + rnd(-10, 6));
      }
    }

    function nestSnow() {
      const p = new Path2D();
      p.moveTo(30, 122);
      p.bezierCurveTo(40, 82, 80, 92, 100, 88);
      p.bezierCurveTo(124, 72, 150, 80, 168, 86);
      p.bezierCurveTo(196, 84, 224, 96, 226, 122);
      p.bezierCurveTo(180, 136, 76, 136, 30, 122);
      const g = ctx.createLinearGradient(0, 76, 0, 134);
      g.addColorStop(0, tone(1)); g.addColorStop(1, tone(0.55));
      ctx.fillStyle = g; ctx.fill(p);
      ctx.strokeStyle = tone(0.3); ctx.lineWidth = 2.5; ctx.stroke(p);
    }

    function chick(open) {
      const head = new Path2D(); head.arc(126, 156, 38, 0, Math.PI * 2);
      inked([head], tone(0.4));
      roundShade(head, 126, 156, 38);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
      for (let k = 0; k < 7; k++) { const x = 100 + k * 8; seg(x, 122, x + rnd(-8, 8), 104 + rnd(-6, 6)); }
      if (open) {
        const gape = new Path2D(); gape.moveTo(150, 148); gape.lineTo(204, 120); gape.lineTo(160, 160); gape.lineTo(202, 190); gape.lineTo(150, 168); gape.closePath();
        ctx.fillStyle = acc1(0.45); ctx.fill(gape);
        ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke(gape);
        ctx.fillStyle = acc1(0.2, 0.8);
        ctx.beginPath(); ctx.moveTo(156, 152); ctx.lineTo(188, 140); ctx.lineTo(156, 162); ctx.lineTo(186, 176); ctx.lineTo(154, 166); ctx.closePath(); ctx.fill();
      } else {
        const b = new Path2D(); b.moveTo(156, 148); b.lineTo(186, 158); b.lineTo(156, 168); b.closePath();
        ctx.fillStyle = acc1(0.5); ctx.fill(b); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke(b);
      }
      ctx.fillStyle = tone(0.02); circ(138, 144, 5.5);
      ctx.fillStyle = tone(1); circ(139.5, 142.5, 1.8);
    }

    // squirrel facing right; feet at (128, 206)
    function squirrel(pose) {
      const tail = new Path2D();
      if (pose === 'sit') {
        tail.moveTo(104, 196); tail.bezierCurveTo(56, 170, 46, 90, 82, 52); tail.bezierCurveTo(104, 30, 134, 40, 128, 62);
        tail.bezierCurveTo(98, 60, 84, 104, 98, 140); tail.bezierCurveTo(108, 168, 120, 182, 118, 196); tail.closePath();
      } else {
        const up = pose === 'runA' ? 0 : 18;
        tail.moveTo(86, 150); tail.bezierCurveTo(44, 150 - up, 18, 96 - up, 40, 58 - up); tail.bezierCurveTo(56, 34 - up, 92, 40 - up, 82, 66 - up);
        tail.bezierCurveTo(62, 80 - up, 58, 116 - up, 92, 136); tail.closePath();
      }
      const parts = [tail];
      let body;
      if (pose === 'sit') {
        body = ell(134, 158, 30, 44, 0.12);
        const head = ell(146, 104, 22, 20, 0.2);
        const snout = ell(166, 110, 12, 9, 0.2);
        const ear = new Path2D(); ear.moveTo(134, 90); ear.lineTo(138, 66); ear.lineTo(150, 88); ear.closePath();
        const leg = ell(122, 192, 26, 14);
        const foot = ell(146, 202, 20, 6);
        parts.push(body, leg, foot, head, snout, ear);
        inked(parts, tone(0.36));
        shade(body, 110, 110, 160, 200);
        ctx.save(); ctx.clip(body); ctx.fillStyle = acc1(0.7, 0.9); ctx.beginPath(); ctx.ellipse(152, 166, 16, 34, 0.1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.fillStyle = acc2(0.3); circ(170, 130, 9);
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(170, 130, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 5; seg(150, 136, 166, 128);
        ctx.fillStyle = tone(0.02); circ(150, 100, 4.2);
      } else {
        const a = pose === 'runA';
        body = ell(124, a ? 162 : 156, a ? 50 : 40, a ? 20 : 26, a ? -0.08 : -0.2);
        const head = ell(176, a ? 150 : 138, 20, 17, 0.25);
        const snout = ell(194, a ? 158 : 146, 10, 8, 0.3);
        const ear = new Path2D(); const ey = a ? 136 : 124;
        ear.moveTo(166, ey); ear.lineTo(170, ey - 22); ear.lineTo(180, ey - 2); ear.closePath();
        const fl = new Path2D(), hl = new Path2D();
        if (a) {
          fl.moveTo(160, 170); fl.lineTo(204, 192); fl.lineTo(206, 200); fl.lineTo(158, 182); fl.closePath();
          hl.moveTo(92, 166); hl.lineTo(52, 196); hl.lineTo(48, 204); hl.lineTo(98, 180); hl.closePath();
        } else {
          fl.moveTo(150, 170); fl.lineTo(146, 204); fl.lineTo(156, 206); fl.lineTo(160, 172); fl.closePath();
          hl.ellipse(104, 180, 24, 18, 0.5, 0, Math.PI * 2);
          parts.push(ell(118, 202, 20, 6));
        }
        parts.push(hl, body, fl, head, snout, ear);
        inked(parts, tone(0.36));
        shade(body, 100, 130, 130, 190);
        ctx.save(); ctx.clip(body); ctx.fillStyle = acc1(0.7, 0.85); ctx.beginPath(); ctx.ellipse(140, a ? 176 : 172, 40, 10, -0.1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.fillStyle = tone(0.02); circ(182, a ? 146 : 134, 4);
      }
      ctx.save(); ctx.clip(tail);
      shade(tail, 30, 40, 120, 190, 0.6);
      ctx.strokeStyle = tone(0.72, 0.55); ctx.lineWidth = 2;
      for (let k = 0; k < 40; k++) { const x = rnd(20, 140), y = rnd(30, 200); seg(x, y, x + rnd(-10, 10), y + rnd(-14, 4)); }
      ctx.restore();
    }

    function butterfly() {
      const wings = [];
      for (const s of [-1, 1]) {
        const fw = new Path2D();
        fw.moveTo(128, 118);
        fw.bezierCurveTo(128 + s * 40, 40, 128 + s * 112, 32, 128 + s * 106, 84);
        fw.bezierCurveTo(128 + s * 100, 120, 128 + s * 50, 134, 128, 130);
        const hw = new Path2D();
        hw.moveTo(128, 132);
        hw.bezierCurveTo(128 + s * 70, 128, 128 + s * 86, 176, 128 + s * 58, 200);
        hw.bezierCurveTo(128 + s * 34, 214, 128 + s * 12, 176, 128, 142);
        wings.push(fw, hw);
      }
      inked(wings, tone(0.8), 2.5);
      for (const w of wings) {
        ctx.save(); ctx.clip(w);
        ctx.strokeStyle = acc2(0.25, 0.9); ctx.lineWidth = 14; ctx.stroke(w);
        ctx.restore();
      }
      ctx.fillStyle = acc1(0.5, 0.95);
      for (const s of [-1, 1]) { circ(128 + s * 78, 76, 10); circ(128 + s * 62, 176, 8); }
      ctx.strokeStyle = tone(0.15, 0.6); ctx.lineWidth = 1.6;
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) seg(128, 124, 128 + s * (60 + k * 16), 60 + k * 18);
      ctx.fillStyle = tone(0.04); ctx.fill(ell(128, 132, 6, 36));
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(126, 98); ctx.quadraticCurveTo(116, 70, 104, 62); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(130, 98); ctx.quadraticCurveTo(140, 70, 152, 62); ctx.stroke();
    }

    function bee() {
      const w1 = ell(112, 92, 24, 14, -0.5), w2 = ell(136, 88, 22, 13, 0.4);
      ctx.fillStyle = tone(0.95, 0.75); ctx.fill(w1); ctx.fill(w2);
      ctx.strokeStyle = tone(0.3, 0.8); ctx.lineWidth = 2; ctx.stroke(w1); ctx.stroke(w2);
      const body = ell(120, 128, 36, 22);
      const head = new Path2D(); head.arc(160, 126, 14, 0, Math.PI * 2);
      inked([body, head], acc1(0.4));
      ctx.save(); ctx.clip(body); ctx.fillStyle = INK;
      for (const x of [98, 118, 138]) ctx.fillRect(x, 100, 8, 60);
      ctx.restore();
      ctx.fillStyle = INK; ctx.fill(head);
    }

    // a limb segment (fills the cell height, half its width) and its round
    // end; both shaded across the width so they join without a seam
    const limbGrad = () => {
      const g = ctx.createLinearGradient(64, 0, 192, 0);
      g.addColorStop(0, tone(0.66)); g.addColorStop(0.3, tone(0.5)); g.addColorStop(0.6, tone(0.34));
      g.addColorStop(0.9, tone(0.16)); g.addColorStop(1, tone(0.1));
      return g;
    };
    function limb() {
      ctx.fillStyle = limbGrad(); ctx.fillRect(64, 0, 128, CELL);
      ctx.fillStyle = INK; ctx.fillRect(64, 0, 9, CELL); ctx.fillRect(183, 0, 9, CELL);
    }
    function limbCap() {
      const p = new Path2D(); p.arc(128, 128, 64, 0, Math.PI * 2);
      ctx.fillStyle = INK; circ(128, 128, 64);
      ctx.fillStyle = limbGrad(); circ(128, 128, 55);
    }

    // girl's head in profile, facing right; skull centre (122, 126), neck at (122, 206)
    function headGirl() {
      const skin = new Path2D();
      skin.arc(122, 126, 58, Math.PI * 0.62, Math.PI * 1.8);
      skin.bezierCurveTo(178, 98, 184, 108, 185, 118);
      skin.quadraticCurveTo(200, 134, 192, 141);
      skin.quadraticCurveTo(188, 145, 187, 148);
      skin.quadraticCurveTo(192, 153, 186, 158);
      skin.quadraticCurveTo(185, 170, 168, 176);
      skin.quadraticCurveTo(152, 182, 140, 180);
      skin.lineTo(138, 210); skin.lineTo(106, 210); skin.lineTo(102, 178);
      skin.closePath();
      inked([skin], tone(0.36));
      roundShade(skin, 130, 128, 66);
      // hair: a cap over the crown and the back, with a fringe
      const hair = new Path2D();
      hair.moveTo(172, 94);
      hair.arc(122, 126, 63, Math.PI * 1.79, Math.PI * 0.7, true);
      hair.quadraticCurveTo(96, 160, 106, 140);
      hair.quadraticCurveTo(128, 118, 150, 112);
      hair.quadraticCurveTo(170, 110, 176, 102);
      hair.closePath();
      ctx.fillStyle = acc2(0.3); ctx.fill(hair);
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke(hair);
      ctx.save(); ctx.clip(hair);
      ctx.strokeStyle = acc2(0.6, 0.55); ctx.lineWidth = 2.2;
      for (let k = 0; k < 9; k++) { ctx.beginPath(); ctx.moveTo(160 - k * 10, 76 + k * 3); ctx.quadraticCurveTo(120 - k * 6, 70 + k * 8, 80 + k, 112 + k * 6); ctx.stroke(); }
      ctx.restore();
      // ear, eye, brow, blush
      const ear = ell(116, 136, 9, 13, 0.1);
      ctx.fillStyle = tone(0.42); ctx.fill(ear);
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke(ear);
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(118, 137, 5, -1.2, 1.4); ctx.stroke();
      ctx.fillStyle = tone(0.02); ctx.fill(ell(168, 126, 4.5, 5.5));
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5; seg(161, 120, 172, 119);
      ctx.strokeStyle = acc2(0.25); ctx.lineWidth = 3; seg(160, 112, 176, 110);
      ctx.fillStyle = acc1(0.55, 0.35); circ(160, 150, 10);
      ctx.strokeStyle = tone(0.15); ctx.lineWidth = 2; seg(181, 152, 188, 152);
      // a bun where the ponytail starts, tied with a ribbon
      const bun = ell(70, 104, 16, 14);
      ctx.fillStyle = acc2(0.3); ctx.fill(bun); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke(bun);
      const bow = [ell(64, 82, 14, 8, -0.9), ell(84, 88, 13, 8, 0.6)];
      for (const b of bow) { ctx.fillStyle = acc1(0.45); ctx.fill(b); ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke(b); }
      ctx.fillStyle = acc1(0.3); circ(74, 90, 6);
    }

    // the same face sixty years on: grey bun, spectacles
    function headOld() {
      const skin = new Path2D();
      skin.arc(122, 126, 58, Math.PI * 0.62, Math.PI * 1.8);
      skin.bezierCurveTo(176, 98, 182, 106, 184, 118);
      skin.quadraticCurveTo(204, 138, 194, 146);
      skin.quadraticCurveTo(188, 148, 186, 150);
      skin.quadraticCurveTo(190, 156, 184, 160);
      skin.quadraticCurveTo(184, 172, 166, 178);
      skin.quadraticCurveTo(150, 186, 140, 182);
      skin.lineTo(138, 210); skin.lineTo(106, 210); skin.lineTo(102, 178);
      skin.closePath();
      inked([skin], tone(0.36));
      roundShade(skin, 130, 128, 66);
      const hair = new Path2D();
      hair.moveTo(170, 92);
      hair.arc(122, 126, 61, Math.PI * 1.78, Math.PI * 0.72, true);
      hair.quadraticCurveTo(100, 150, 108, 130);
      hair.quadraticCurveTo(132, 110, 176, 100);
      hair.closePath();
      ctx.fillStyle = acc2(0.62); ctx.fill(hair);
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke(hair);
      const bun = ell(96, 66, 26, 22, -0.4);
      ctx.fillStyle = acc2(0.62); ctx.fill(bun); ctx.strokeStyle = INK; ctx.lineWidth = 3.5; ctx.stroke(bun);
      for (const p of [hair, bun]) {
        ctx.save(); ctx.clip(p);
        ctx.strokeStyle = acc2(0.95, 0.6); ctx.lineWidth = 2;
        for (let k = 0; k < 10; k++) { ctx.beginPath(); ctx.moveTo(170 - k * 11, 84 + k * 2); ctx.quadraticCurveTo(120 - k * 5, 60 + k * 7, 76 + k * 2, 70 + k * 9); ctx.stroke(); }
        ctx.restore();
      }
      const ear = ell(116, 138, 9, 15, 0.1);
      ctx.fillStyle = tone(0.42); ctx.fill(ear);
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke(ear);
      ctx.fillStyle = tone(0.02); ctx.fill(ell(168, 127, 4, 3.5));
      ctx.strokeStyle = tone(0.2, 0.8); ctx.lineWidth = 1.8;
      seg(158, 132, 150, 136); seg(160, 136, 152, 142); seg(172, 160, 166, 168);     // laugh lines
      // spectacles
      ctx.strokeStyle = acc1(0.12); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(170, 127, 12, 0, Math.PI * 2); ctx.stroke();
      seg(158, 125, 120, 128);
      ctx.strokeStyle = tone(0.2); ctx.lineWidth = 2; seg(180, 153, 187, 154);
    }

    // torsos: shoulders at (126, 44), hip at (126, 214), facing right
    function torsoGirl() {
      const p = new Path2D();
      p.moveTo(104, 40);
      p.quadraticCurveTo(92, 120, 100, 216);
      p.lineTo(152, 216);
      p.quadraticCurveTo(150, 170, 160, 104);
      p.quadraticCurveTo(164, 72, 146, 38);
      p.closePath();
      inked([p], tone(0.36));
      shade(p, 96, 40, 160, 210);
      const sleeve = ell(120, 70, 28, 22, 0.2);
      inked([sleeve], tone(0.42), 2.5);
      roundShade(sleeve, 120, 70, 28);
      ctx.fillStyle = acc2(0.3); ctx.fillRect(96, 194, 62, 16);                    // sash
      const collar = new Path2D(); collar.moveTo(128, 40); collar.quadraticCurveTo(160, 40, 156, 62); collar.quadraticCurveTo(140, 58, 128, 48); collar.closePath();
      ctx.fillStyle = acc1(0.92); ctx.fill(collar); ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke(collar);
    }
    function torsoOld() {
      const p = new Path2D();
      p.moveTo(112, 38);
      p.bezierCurveTo(80, 52, 76, 110, 94, 216);
      p.lineTo(154, 216);
      p.quadraticCurveTo(150, 160, 158, 110);
      p.quadraticCurveTo(160, 70, 140, 38);
      p.closePath();
      inked([p], tone(0.36));
      shade(p, 90, 40, 160, 210);
      ctx.fillStyle = acc2(0.3);
      for (const y of [120, 150, 180]) circ(150, y, 4);
      // a shawl over the shoulders, in the ribbon's red
      const sh = new Path2D();
      sh.moveTo(104, 34); sh.quadraticCurveTo(140, 28, 156, 50);
      sh.quadraticCurveTo(164, 96, 156, 128); sh.lineTo(140, 120);
      sh.quadraticCurveTo(130, 80, 100, 74); sh.quadraticCurveTo(82, 96, 84, 120);
      sh.lineTo(80, 82); sh.closePath();
      ctx.fillStyle = acc1(0.42); ctx.fill(sh);
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke(sh);
      ctx.save(); ctx.clip(sh);
      ctx.strokeStyle = acc1(0.7, 0.5); ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) seg(100 + k * 10, 40, 92 + k * 12, 120);
      ctx.restore();
    }

    // seated skirts: waist at (52, 96), the lap runs right to the knee at (200, ~104)
    function skirtGirl() {
      const p = new Path2D();
      p.moveTo(40, 86);
      p.quadraticCurveTo(120, 80, 200, 96);
      p.quadraticCurveTo(222, 106, 220, 150);
      p.quadraticCurveTo(180, 162, 140, 150);
      p.quadraticCurveTo(90, 160, 34, 154);
      p.quadraticCurveTo(26, 120, 40, 86);
      p.closePath();
      inked([p], tone(0.36));
      shade(p, 80, 80, 120, 160);
      ctx.save(); ctx.clip(p);
      ctx.strokeStyle = tone(0.12, 0.6); ctx.lineWidth = 2.5;
      for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(60 + k * 24, 92); ctx.quadraticCurveTo(70 + k * 28, 130, 64 + k * 30, 160); ctx.stroke(); }
      ctx.fillStyle = acc1(0.9, 0.9);
      ctx.beginPath(); ctx.moveTo(30, 150); ctx.quadraticCurveTo(120, 160, 222, 146); ctx.lineTo(222, 156); ctx.quadraticCurveTo(120, 170, 30, 160); ctx.fill();
      ctx.restore();
    }
    function skirtOld() {
      const p = new Path2D();
      p.moveTo(40, 84);
      p.quadraticCurveTo(120, 80, 200, 92);
      p.quadraticCurveTo(226, 110, 222, 240);
      p.lineTo(184, 244);
      p.quadraticCurveTo(178, 160, 150, 132);
      p.quadraticCurveTo(90, 140, 34, 150);
      p.quadraticCurveTo(26, 114, 40, 84);
      p.closePath();
      inked([p], tone(0.36));
      shade(p, 80, 80, 200, 240);
      ctx.save(); ctx.clip(p);
      ctx.strokeStyle = tone(0.12, 0.55); ctx.lineWidth = 2.5;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(196 + k * 6, 110); ctx.quadraticCurveTo(200 + k * 5, 170, 194 + k * 7, 240); ctx.stroke(); }
      for (let k = 0; k < 4; k++) seg(60 + k * 34, 92, 70 + k * 30, 136);
      ctx.restore();
    }

    // a lock of hair: root (wide) at the top, tip at the bottom
    function hairLock() {
      const p = new Path2D();
      p.moveTo(84, 8);
      p.quadraticCurveTo(128, -4, 172, 8);
      p.quadraticCurveTo(170, 140, 128, 252);
      p.quadraticCurveTo(84, 140, 84, 8);
      p.closePath();
      inked([p], tone(0.36), 3);
      shade(p, 90, 0, 170, 200, 0.6);
      ctx.save(); ctx.clip(p);
      ctx.strokeStyle = tone(0.7, 0.5); ctx.lineWidth = 2.5;
      for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(96 + k * 12, 10); ctx.quadraticCurveTo(108 + k * 6, 130, 126 + k * 1, 240); ctx.stroke(); }
      ctx.restore();
    }

    // a shoe in profile, toe to the right; ankle at (110, 96)
    function shoe() {
      const p = new Path2D();
      p.moveTo(92, 92); p.lineTo(132, 92);
      p.quadraticCurveTo(150, 112, 196, 120);
      p.quadraticCurveTo(222, 126, 220, 148);
      p.lineTo(84, 152);
      p.quadraticCurveTo(76, 120, 92, 92);
      p.closePath();
      inked([p], tone(0.36));
      shade(p, 90, 90, 140, 152);
      ctx.fillStyle = tone(0.08); ctx.fillRect(84, 146, 138, 8);
      ctx.fillStyle = tone(0.85, 0.7); ctx.fill(ell(176, 124, 16, 5, 0.25));
    }

    // the swing seat seen end-on (the ropes come down either end of it)
    function seat() {
      const p = new Path2D(); p.roundRect(40, 110, 176, 36, 6);
      inked([p], tone(0.45), 2.5);
      shade(p, 40, 110, 60, 146);
      ctx.strokeStyle = tone(0.15, 0.7); ctx.lineWidth = 1.6;
      for (let k = 0; k < 3; k++) seg(50, 118 + k * 9, 206, 117 + k * 9.5);
    }

    function snowball() {
      const g = ctx.createRadialGradient(96, 92, 10, 128, 128, 116);
      g.addColorStop(0, tone(1)); g.addColorStop(0.6, tone(0.9)); g.addColorStop(1, tone(0.45));
      ctx.fillStyle = g; circ(128, 128, 112);
      ctx.fillStyle = tone(0.4, 0.5);
      for (let k = 0; k < 160; k++) {
        const a = rnd(0, Math.PI * 2), r = Math.sqrt(R()) * 108, x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
        if ((x - 70) + (y - 70) < 150) continue;
        circ(x, y, rnd(1, 2.4));
      }
      ctx.strokeStyle = tone(0.3); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.stroke();
    }

    function carrot() {
      const p = new Path2D(); p.moveTo(30, 108); p.lineTo(236, 128); p.lineTo(30, 150); p.closePath();
      ctx.fillStyle = acc1(0.45); ctx.fill(p);
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke(p);
      ctx.lineWidth = 2.5;
      for (const x of [70, 110, 150]) seg(x, 112 + (x - 30) * 0.1, x + 6, 146 - (x - 30) * 0.1);
    }

    function twig() {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 9; seg(16, 200, 236, 64);
      ctx.lineWidth = 6; seg(150, 118, 190, 52); seg(196, 90, 244, 96);
      ctx.lineWidth = 4; seg(90, 154, 96, 112);
    }

    // A park bench seen from its end, the way someone sitting on it in
    // profile is seen: the near cast-iron end frame, the slats receding
    // behind it. The seat top is at y = 160 (back edge x = 100, front x = 176),
    // the near front foot at (184, 244). The near end (frame and slat ends)
    // is a separate cell drawn in front of the sitter.
    const BD = [-30, -18];                 // the bench's length, receding
    const benchFrame = (ox, oy, w) => {
      const m = (x, y) => [x + ox, y + oy];
      const path = (pts, curve) => {
        ctx.beginPath(); ctx.moveTo(...m(pts[0], pts[1]));
        if (curve) ctx.quadraticCurveTo(...m(pts[2], pts[3]), ...m(pts[4], pts[5]));
        else ctx.lineTo(...m(pts[2], pts[3]));
        ctx.stroke();
      };
      ctx.lineWidth = 9 * w; path([166, 166, 167, 208, 172, 244], true);          // front leg, set back under the seat
      ctx.lineWidth = 9 * w; path([106, 166, 99, 206, 92, 244], true);            // back leg
      ctx.lineWidth = 8 * w; path([105, 168, 97, 128, 84, 82], true);             // backrest support
      ctx.lineWidth = 7 * w;                                                      // armrest with a scroll
      ctx.beginPath(); ctx.moveTo(...m(94, 124)); ctx.quadraticCurveTo(...m(136, 112), ...m(170, 120));
      ctx.quadraticCurveTo(...m(186, 126), ...m(178, 136)); ctx.quadraticCurveTo(...m(170, 142), ...m(166, 134)); ctx.stroke();
      ctx.lineWidth = 6 * w; path([172, 134, 168, 160]);
      ctx.lineWidth = 6 * w; path([104, 196, 166, 196]);                          // brace
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(...m(164, 239), 16 * w, 7); ctx.fillRect(...m(84, 239), 16 * w, 7);
    };
    // a slat: its near end face, and the slat itself running back along BD
    const slatFace = (cx, cy, len, thick, ang) => {
      const c = Math.cos(ang), s2 = Math.sin(ang);
      const hx = c * len / 2, hy = s2 * len / 2, tx = -s2 * thick / 2, ty = c * thick / 2;
      return [[cx - hx - tx, cy - hy - ty], [cx + hx - tx, cy + hy - ty], [cx + hx + tx, cy + hy + ty], [cx - hx + tx, cy - hy + ty]];
    };
    const hull = (pts) => {
      pts = pts.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const cross = (o, a2, b2) => (a2[0] - o[0]) * (b2[1] - o[1]) - (a2[1] - o[1]) * (b2[0] - o[0]);
      const lo = [], up = [];
      for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    };
    const polyPath = (pts) => { const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); return p; };
    const SEAT_SLATS = [[113, 164, 22, 8, 0], [139, 164, 22, 8, 0], [165, 164, 22, 8, 0]];
    const BACK_SLATS = [[103, 140, 24, 9, 1.33], [96, 110, 24, 9, 1.33]];
    function bench() {
      ctx.strokeStyle = acc2(0.12); ctx.lineCap = 'round';
      benchFrame(BD[0], BD[1], 0.85);                                            // the far end
      for (const [cx, cy, len, th, ang] of [...BACK_SLATS, ...SEAT_SLATS]) {
        const f = slatFace(cx, cy, len, th, ang);
        const body = polyPath(hull([...f, ...f.map((q) => [q[0] + BD[0], q[1] + BD[1]])]));
        inked([body], tone(0.4), 2);
        shade(body, cx + BD[0], cy + BD[1] - 10, cx, cy + 10, 0.5);
        ctx.strokeStyle = tone(0.2, 0.45); ctx.lineWidth = 1.4;
        seg(cx, cy, cx + BD[0], cy + BD[1]);
      }
      ctx.strokeStyle = acc2(0.2);
    }
    // the near end: in front of whoever sits on the bench
    function benchNear() {
      ctx.strokeStyle = acc2(0.2); ctx.lineCap = 'round';
      for (const [cx, cy, len, th, ang] of SEAT_SLATS) {
        const f = polyPath(slatFace(cx, cy, len, th, ang));
        inked([f], tone(0.3), 1.6);
        shade(f, cx - 10, cy - 4, cx + 10, cy + 4, 0.5);
      }
      ctx.strokeStyle = acc2(0.2);
      benchFrame(0, 0, 1);
    }

    function shadowBlob() {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 124);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, CELL, CELL);
    }

    // a lumpy strip of snow lying on something; bottom edge at y = 150
    function snowcap() {
      const p = new Path2D();
      p.moveTo(6, 150);
      let x = 6;
      p.lineTo(6, 136);
      while (x < 246) {
        const w = rnd(24, 44), h = rnd(18, 38);
        p.quadraticCurveTo(x + w * 0.5, 136 - h, Math.min(250, x + w), 136 - rnd(0, 8));
        x += w;
      }
      p.lineTo(250, 150); p.closePath();
      const g = ctx.createLinearGradient(0, 96, 0, 152);
      g.addColorStop(0, tone(1)); g.addColorStop(0.7, tone(0.9)); g.addColorStop(1, tone(0.55));
      ctx.fillStyle = g; ctx.fill(p);
      ctx.strokeStyle = tone(0.35); ctx.lineWidth = 3; ctx.stroke(p);
    }

    function daisy() {
      ctx.strokeStyle = tone(0.3); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(128, 252); ctx.quadraticCurveTo(136, 180, 126, 104); ctx.stroke();
      inked([ell(146, 206, 22, 7, -0.6)], tone(0.35), 1.5);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const p = ell(126 + Math.cos(a) * 26, 82 + Math.sin(a) * 18, 18, 6, a);
        ctx.fillStyle = tone(1); ctx.fill(p); ctx.strokeStyle = tone(0.25); ctx.lineWidth = 1.6; ctx.stroke(p);
      }
      ctx.fillStyle = acc1(0.45); circ(126, 82, 12);
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(126, 82, 12, 0, Math.PI * 2); ctx.stroke();
    }

    function buttercup() {
      ctx.strokeStyle = tone(0.3); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(128, 252); ctx.quadraticCurveTo(118, 180, 128, 116); ctx.stroke();
      const parts = [];
      for (let k = -2; k <= 2; k++) parts.push(ell(128 + k * 15, 98 - Math.abs(k) * 4, 15, 24, k * 0.35));
      inked(parts, acc1(0.5), 1.8);
      ctx.fillStyle = acc1(0.75, 0.8); circ(124, 92, 6);
    }

    function mushrooms() {
      const one = (x, h, r) => {
        const stem = new Path2D(); stem.rect(x - r * 0.25, 248 - h, r * 0.5, h);
        inked([stem], tone(0.85), 2);
        const cap = new Path2D();
        cap.moveTo(x - r, 252 - h); cap.bezierCurveTo(x - r, 252 - h - r * 1.2, x + r, 252 - h - r * 1.2, x + r, 252 - h); cap.closePath();
        inked([cap], acc1(0.35), 2.5);
        ctx.fillStyle = tone(0.95, 0.85);
        for (let k = 0; k < 4; k++) circ(x + rnd(-r * 0.6, r * 0.6), 252 - h - rnd(r * 0.2, r * 0.75), rnd(3, 6));
      };
      one(92, 70, 40); one(160, 104, 52); one(204, 46, 28);
    }

    function glow() {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 124);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, CELL, CELL);
    }

    function puff() {
      const blobs = [[128, 140, 60], [84, 150, 42], [172, 150, 44], [110, 104, 40], [152, 108, 36]];
      const g = ctx.createLinearGradient(0, 70, 0, 200);
      g.addColorStop(0, tone(1)); g.addColorStop(1, tone(0.6));
      ctx.strokeStyle = tone(0.4); ctx.lineWidth = 5;
      for (const [x, y, r] of blobs) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = g;
      for (const [x, y, r] of blobs) circ(x, y, r);
    }

    function prints() {
      ctx.fillStyle = tone(0.15, 0.7);
      const boot = (x, y, a) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(0, -18, 20, 30, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, 32, 15, 17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };
      boot(96, 96, 0.15); boot(160, 168, 0.15);
    }

    cell(C.BIRD, () => bird(false, false));
    cell(C.BIRD_PECK, () => bird(true, false));
    cell(C.CARDINAL, () => bird(false, true));
    cell(C.CARDINAL_PECK, () => bird(true, true));
    cell(C.FLYBODY, () => flyBody(false));
    cell(C.FLYBODY_CREST, () => flyBody(true));
    cell(C.GOOSE, goose);
    cell(C.WING_IN, wingInner);
    cell(C.WING_OUT, wingOuter);
    cell(C.NEST, nest);
    cell(C.NEST_SNOW, nestSnow);
    cell(C.CHICK_OPEN, () => chick(true));
    cell(C.CHICK, () => chick(false));
    cell(C.SQ_RUN_A, () => squirrel('runA'));
    cell(C.SQ_RUN_B, () => squirrel('runB'));
    cell(C.SQ_SIT, () => squirrel('sit'));
    cell(C.BUTTERFLY, butterfly);
    cell(C.BEE, bee);
    cell(C.LIMB, limb);
    cell(C.LIMB_CAP, limbCap);
    cell(C.HEAD_GIRL, headGirl);
    cell(C.TORSO_GIRL, torsoGirl);
    cell(C.SKIRT_GIRL, skirtGirl);
    cell(C.HAIRLOCK, hairLock);
    cell(C.SHOE, shoe);
    cell(C.HEAD_OLD, headOld);
    cell(C.TORSO_OLD, torsoOld);
    cell(C.SKIRT_OLD, skirtOld);
    cell(C.SEAT, seat);
    // SOLID fills the whole cell (no inset), so stretched lines have no fringe
    ctx.save(); ctx.translate((C.SOLID % COLS) * CELL, Math.floor(C.SOLID / COLS) * CELL);
    ctx.fillStyle = tone(0.3); ctx.fillRect(0, 0, CELL, CELL); ctx.restore();
    cell(C.SNOWBALL, snowball);
    cell(C.CARROT, carrot);
    cell(C.TWIG, twig);
    cell(C.DOT, () => { ctx.fillStyle = tone(0.3); circ(128, 128, 110); });
    cell(C.BENCH, bench);
    cell(C.SHADOW, shadowBlob);
    cell(C.DAISY, daisy);
    cell(C.BUTTERCUP, buttercup);
    cell(C.MUSHROOMS, mushrooms);
    cell(C.GLOW, glow);
    cell(C.PUFF, puff);
    cell(C.PRINTS, prints);
    cell(C.LEAF, () => { ctx.translate(48, 0); ctx.scale(0.5, 0.5); drawLeaf(ctx); });
    cell(C.PETAL, () => { ctx.translate(48, 0); ctx.scale(0.5, 0.5); drawPetal(ctx); });
    cell(C.SNOWCAP, snowcap);
    cell(C.BENCH_NEAR, benchNear);
    return cv;
  }

  // -------------------------------------------------------------- the cast
  // world sizes of the people (the tree is about 1.1 units tall)
  const GK = 1.35, OK = 1.2;
  const GIRL = { torso: 0.024 * GK, thigh: 0.019 * GK, shin: 0.018 * GK, upper: 0.0125 * GK, fore: 0.0125 * GK, head: 0.0068 * GK, armW: 0.0036 * GK, legW: 0.0046 * GK };
  const OLD = { torso: 0.029 * OK, thigh: 0.024 * OK, upper: 0.0155 * OK, fore: 0.015 * OK, head: 0.0076 * OK, armW: 0.0044 * OK, legW: 0.0054 * OK };
  const BENCH = { x: -0.58, y: -0.044, size: 0.112 * OK };
  // wing rigs, in units of the bird's sprite size
  const RIG = {
    song: { shF: 0.04, shU: 0.05, l1: 0.21, l2: 0.27, c1: 0.22, c2: 0.19, body: 1 },
    goose: { shF: -0.02, shU: 0.03, l1: 0.3, l2: 0.4, c1: 0.27, c2: 0.23, body: 1 },
  };

  function create(tree, seed) {
    const sites = tree.sites;
    const R = mulberry32(seed * 977 + 13);
    const rnd = (a, b) => a + (b - a) * R();
    const MAX = 1800;
    const layers = {
      back: { data: new Float32Array(MAX * FLOATS), n: 0 },
      front: { data: new Float32Array(MAX * FLOATS), n: 0 },
      glow: { data: new Float32Array(MAX * FLOATS), n: 0 },
    };

    // twig spots across the crown (bee targets, where loose things come from)
    const twigs = [], crownSpots = [];
    for (let i = 0; i < tree.blossomCount; i += 7) {
      const o = i * 12;
      const p = [tree.blossomData[o], tree.blossomData[o + 1]];
      crownSpots.push(p);
      if (tree.blossomData[o + 7] > 0.1) twigs.push(p);
    }
    const perchUp = (p) => {
      let nx = Math.cos(p.a), ny = -Math.sin(p.a);
      if (ny < 0) { nx = -nx; ny = -ny; }
      return [nx, ny];
    };
    const springPerches = sites.perches.filter((p) => p.y > 0.42 && Math.abs(p.x) < 0.62);

    // wildflowers that come and go over the years
    const flowers = [];
    for (let i = 0; i < 70; i++) {
      const y = rnd(-0.085, 0.012), x = rnd(-1.7, 1.5);
      const birth = rnd(0.25, 0.95), life = rnd(0.06, 0.3);
      if (Math.abs(x) < 0.12 || (Math.abs(x - BENCH.x) < 0.06 && y < -0.02)) continue;
      flowers.push({ x, y, size: lerp(0.026, 0.042, ramp(-y, -0.012, 0.085)) * rnd(0.85, 1.15),
        cell: R() < 0.55 ? C.DAISY : C.BUTTERCUP, ph: rnd(0, 6.28), k: R(), lean: rnd(-0.18, 0.18),
        birth, death: birth + life < 1 ? birth + life : 9, spring: R() < 0.6 });
    }
    flowers.sort((a, b) => b.y - a.y);
    // a few fireflies, low under the crown where the air is still
    const fireflies = Array.from({ length: 22 }, () => ({
      x: rnd(-0.55, 0.62), y: 0.014 + 0.2 * Math.pow(R(), 1.7), ax: rnd(0.03, 0.08), ay: rnd(0.008, 0.025),
      f1: rnd(0.12, 0.3), f2: rnd(0.15, 0.4), p1: rnd(0, 6.28), p2: rnd(0, 6.28),
      period: rnd(3.4, 7.5), off: rnd(0, 10), size: rnd(0.85, 1.15),
    }));
    const butterflies = Array.from({ length: 6 }, (_, i) => ({
      cx: rnd(-0.6, 0.75), cy: rnd(0.06, 0.36), ax: rnd(0.12, 0.3), ay: rnd(0.04, 0.1), w1: rnd(0.25, 0.5), w2: rnd(0.4, 0.9),
      p1: rnd(0, 6.28), p2: rnd(0, 6.28), flap: rnd(9, 13), pal: BUTTERFLIES[i % BUTTERFLIES.length], size: rnd(0.026, 0.034),
    }));
    const bees = Array.from({ length: 10 }, () => ({ seg: rnd(4, 7), off: rnd(0, 10), k: Math.floor(rnd(0, 1e4)) }));

    // birds with minds of their own
    const springBirds = [PAL.robin, PAL.finch, PAL.sparrow, PAL.robin, PAL.finch].map((p, i) => ({
      pal: p, state: 'away', until: 0.6 + i * 1.4, perch: -1, path: null, idleT: 0, flip: 1, size: 0.044 + 0.004 * (i % 2),
    }));
    const parent = { state: 'away', until: 1, path: null, side: 1, rim: null };
    const cardinal = { path: null, back: 0, state: 'perch' };
    const swingSt = { th: 0.05, w: 0, px: null, py: null, pvx: 0, pvy: 0, hair: null, lastSign: 0 };
    const particles = [];
    let startle = null;
    let flockClock = 0, lastT = 0;

    // ------------------------------------------------------- emitting
    function emitAff(L, cell, x, y, Xx, Xy, Yx, Yy, o) {
      if (L.n >= MAX) return;
      const f = L.data, i = L.n * FLOATS;
      const p = o.pal;
      f[i] = x; f[i + 1] = y; f[i + 2] = Xx; f[i + 3] = Xy;
      f[i + 4] = cell; f[i + 5] = Yx; f[i + 6] = Yy; f[i + 7] = o.alpha == null ? 1 : o.alpha;
      f[i + 8] = p[0][0]; f[i + 9] = p[0][1]; f[i + 10] = p[0][2]; f[i + 11] = o.mode || 0;
      f[i + 12] = p[1][0]; f[i + 13] = p[1][1]; f[i + 14] = p[1][2]; f[i + 15] = o.grain == null ? 1 : o.grain;
      f[i + 16] = p[2][0]; f[i + 17] = p[2][1]; f[i + 18] = p[2][2]; f[i + 19] = 0;
      f[i + 20] = p[3][0]; f[i + 21] = p[3][1]; f[i + 22] = p[3][2]; f[i + 23] = 0;
      L.n++;
    }
    function emit(L, cell, x, y, rot, size, o) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const sx = size * (o.aspect || 1) * (o.flip || 1), sy = size * (o.sy || 1);
      emitAff(L, cell, x, y, c * sx, s * sx, -s * sy, c * sy, o);
    }
    // put cell point (u, v) — 0..1, v down — on world point (px, py)
    function at(L, cell, px, py, u, v, rot, size, o) {
      const fx = o.flip || 1, asp = o.aspect || 1, sy = o.sy || 1;
      const lx = (u - 0.5) * asp * fx * size, ly = (0.5 - v) * sy * size;
      const c = Math.cos(rot), s = Math.sin(rot);
      emit(L, cell, px - (c * lx - s * ly), py - (s * lx + c * ly), rot, size, o);
    }
    // where cell point (u, v) of a sprite placed with at() ends up
    function cellPoint(px, py, u0, v0, rot, size, flip, u, v) {
      const lx = (u - u0) * flip * size, ly = (v0 - v) * size;
      const c = Math.cos(rot), s = Math.sin(rot);
      return [px + c * lx - s * ly, py + s * lx + c * ly];
    }
    function line(L, x0, y0, x1, y1, width, o) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
      if (len < 1e-6) return;
      emitAff(L, C.SOLID, (x0 + x1) / 2, (y0 + y1) / 2, (dy / len) * width, (-dx / len) * width, dx, dy, o);
    }
    // a rounded limb from a to b, shaded across its width
    function bone(L, a, b, w, palette, alpha) {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-6;
      const ux = dx / len, uy = dy / len;
      let px = uy, py = -ux;
      if (px - py * 0.6 < 0) { px = -px; py = -py; }     // keep the lit side up and to the left
      const k = w / 0.5;
      const o = { pal: palette, alpha };
      emitAff(L, C.LIMB_CAP, a[0], a[1], px * k, py * k, ux * k, uy * k, o);
      emitAff(L, C.LIMB_CAP, b[0], b[1], px * k, py * k, ux * k, uy * k, o);
      emitAff(L, C.LIMB, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, px * k, py * k, dx, dy, o);
    }
    function shadow(x, y, w, h, a) {
      if (a > 0.004) emitAff(layers.back, C.SHADOW, x, y, w, 0, 0, h, { pal: PAL.ink, alpha: a, mode: 2 });
    }
    // two-bone reach from a toward b; the joint goes to the side `side` prefers
    function reach(a, b, l1, l2, side) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1e-5, l1 + l2 - 1e-5);
      const base = Math.atan2(dy, dx);
      const k = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
      const j1 = [a[0] + Math.cos(base + k) * l1, a[1] + Math.sin(base + k) * l1];
      const j2 = [a[0] + Math.cos(base - k) * l1, a[1] + Math.sin(base - k) * l1];
      const joint = side(j1) > side(j2) ? j1 : j2;
      const ex = b[0] - joint[0], ey = b[1] - joint[1], el = Math.hypot(ex, ey) || 1;
      return [joint, [joint[0] + ex / el * l2, joint[1] + ey / el * l2]];
    }

    // ---------------------------------------------------- birds in flight
    // Wing pose through one beat (ph 0 = top of the stroke) for a blend of
    // flapping, gliding, wings closed (bounding) and the flare before landing.
    function wingPose(ph, m, deep) {
      const w = ph < 0.45 ? ph / 0.45 * 0.5 : 0.5 + (ph - 0.45) / 0.55 * 0.5;   // quick downstroke
      const c = Math.cos(w * 2 * Math.PI);
      const up = w > 0.5 ? Math.sin((w - 0.5) * 2 * Math.PI) : 0;
      const fold = up * up * (deep ? 0.55 : 1);
      const A = deep ? 0.62 : 0.9;
      const P = { a1: 0, a2: 0, s1: 0, s2: 0, l1: 0, l2: 0 };
      const add = (k, a1, a2, s1, s2, l1, l2) => {
        if (k <= 0) return;
        P.a1 += k * a1; P.a2 += k * a2; P.s1 += k * s1; P.s2 += k * s2; P.l1 += k * l1; P.l2 += k * l2;
      };
      add(m.flap, 0.18 + A * c, 0.18 + A * c + 0.3 * Math.cos(w * 2 * Math.PI - 1.0) - 0.5 * fold,
        0.08 + 0.5 * fold, 0.2 + 1.1 * fold, 1 - 0.22 * fold, 1 - 0.45 * fold);
      add(m.glide, 0.12, 0.05, 0.1, 0.3, 1, 1);
      add(m.fold, 0.1, -0.05, 1.4, 2.6, 0.45, 0.35);
      add(m.flare, 1.0 + 0.2 * Math.sin(ph * 6.28), 1.2 + 0.25 * Math.sin(ph * 6.28 - 0.6), -0.3, -0.12, 1, 0.96);
      return P;
    }

    // A bird in flight: a body sprite plus two jointed wings posed in 3D and
    // projected for a viewer looking up at it a little (elev).
    function flyer(L, o) {
      const s = o.size, dir = o.dir < 0 ? -1 : 1, rig = RIG[o.kind || 'song'];
      const yaw = o.yaw || 0, pitch = o.pitch || 0, e = o.elev == null ? 0.2 : o.elev;
      const ce = Math.cos(e), se = Math.sin(e);
      const Hh = [dir * Math.cos(yaw), 0, -Math.sin(yaw)];
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const H = [Hh[0] * cp, sp, Hh[2] * cp];
      const U = [-Hh[0] * sp, cp, -Hh[2] * sp];
      const Lt = [-Hh[2], 0, Hh[0]];
      const pr = (v) => [v[0], v[1] * ce + v[2] * se];
      const v3 = (a, ka, b, kb, c, kc) => [a[0] * ka + b[0] * kb + c[0] * kc, a[1] * ka + b[1] * kb + c[1] * kc, a[2] * ka + b[2] * kb + c[2] * kc];
      const P = wingPose(o.phase, o.mode, o.kind === 'goose');
      const sh = v3(H, rig.shF * s, U, rig.shU * s, Lt, 0);
      const hs = pr(H);
      const alpha = o.alpha == null ? 1 : o.alpha;
      const wings = [];
      for (const side of [1, -1]) {
        const d1 = v3(U, Math.sin(P.a1), Lt, side * Math.cos(P.a1), H, 0);
        const w1 = v3(d1, Math.cos(P.s1), H, -Math.sin(P.s1), Lt, 0);
        const d2 = v3(U, Math.sin(P.a2), Lt, side * Math.cos(P.a2), H, 0);
        const w2 = v3(d2, Math.cos(P.s2), H, -Math.sin(P.s2), Lt, 0);
        const E = v3(sh, 1, w1, rig.l1 * P.l1 * s, H, 0);
        const T = v3(E, 1, w2, rig.l2 * P.l2 * s, H, 0);
        wings.push({ E, T, z: E[2] + T[2] });
      }
      wings.sort((a, b) => a.z - b.z);
      const shp = pr(sh);
      const segment = (cell, a, b, chord, palette) => {
        const A = pr(a), B = pr(b);
        const Yx = B[0] - A[0], Yy = B[1] - A[1];
        const Xx = hs[0] * chord, Xy = hs[1] * chord;
        emitAff(L, cell, o.x + A[0] + Yx * 0.5 - Xx * 0.33, o.y + A[1] + Yy * 0.5 - Xy * 0.33, Xx, Xy, Yx, Yy, { pal: palette, alpha });
      };
      const wing = (w, palette) => {
        segment(C.WING_IN, sh, w.E, rig.c1 * s, palette);
        segment(C.WING_OUT, w.E, w.T, rig.c2 * s, palette);
      };
      wing(wings[0], darker(o.pal));
      // body: forward along the heading, up kept up
      const hl = Math.hypot(hs[0], hs[1]) || 1;
      let ux = -hs[1] / hl, uy = hs[0] / hl;
      if (ux * pr(U)[0] + uy * pr(U)[1] < 0) { ux = -ux; uy = -uy; }
      emitAff(L, o.body, o.x, o.y, hs[0] * s, hs[1] * s, ux * s, uy * s, { pal: o.pal, alpha });
      void shp;
      wing(wings[1], o.pal);
    }

    const resolve = (p) => (typeof p === 'function' ? p() : p);
    const bez3 = (a, b, c, d, u) => {
      const v = 1 - u;
      return [v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0],
        v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1]];
    };

    // fly a path: { A, c1, c2, B (points or functions), t0, dur, land, seed }
    // Songbirds launch with a burst of beats, then bound (beats and short
    // closed-wing dips), glide in and flare to land.
    function flight(L, f, t, palette, size, o = {}) {
      const u = clamp((t - f.t0) / f.dur, 0, 1);
      const s = u * u * (3 - 2 * u) * (f.land ? 0.55 : 0.35) + u * (f.land ? 0.45 : 0.65);
      const A = resolve(f.A), B = resolve(f.B);
      const c1 = [A[0] + f.c1[0], A[1] + f.c1[1]], c2 = [B[0] + f.c2[0], B[1] + f.c2[1]];
      const p = bez3(A, c1, c2, B, s), q = bez3(A, c1, c2, B, Math.min(1, s + 0.01));
      let vx = q[0] - p[0], vy = q[1] - p[1];
      if (Math.abs(vx) + Math.abs(vy) < 1e-7) { vx = B[0] - A[0]; vy = 0; }
      const kind = o.kind || 'song';
      const take = 1 - smooth(0, 0.22, u);
      const flare = f.land ? smooth(0.8, 0.97, u) : 0;
      const glide = f.land ? smooth(0.62, 0.8, u) * (1 - flare) : 0;
      let fold = 0;
      if (kind === 'song') {
        const cyc = fract(t * 2.1 + (f.seed || 0));
        fold = smooth(0.62, 0.7, cyc) * (1 - smooth(0.9, 0.98, cyc)) * (1 - take) * (1 - glide - flare);
      }
      const flap = Math.max(0, 1 - fold - glide - flare);
      const dir = vx >= 0 ? 1 : -1;
      const pitch = clamp(Math.atan2(vy, Math.abs(vx)) * 0.7, -0.55, 0.6) + flare * 0.55;
      const freq = kind === 'goose' ? 2.6 : 8.5;
      flyer(L, {
        x: p[0], y: p[1] - fold * size * 0.05, dir, pitch, size, pal: palette, kind,
        body: o.body == null ? C.FLYBODY : o.body, phase: fract(t * freq + (f.seed || 0) * 3.7),
        mode: { flap, glide, fold, flare }, elev: o.elev, alpha: o.alpha,
      });
      return u;
    }

    // Startled: off in a random direction, roughly away from the hand that shook the tree
    function escapeFrom(home, now, fromX, size) {
      const away = Math.sign(home[0] - fromX) || (Math.random() < 0.5 ? -1 : 1);
      const side = Math.random() < 0.78 ? away : -away;
      const ang = rr(0.25, 1.15), dist = rr(0.75, 1.3);
      return {
        A: home, B: [home[0] + side * Math.cos(ang) * dist, home[1] + Math.sin(ang) * dist],
        c1: [side * rr(0.01, 0.05), rr(0.04, 0.12)], c2: [-side * rr(0.1, 0.35), rr(-0.25, 0.1)],
        t0: now + rr(0, 0.3), dur: rr(1.0, 1.7), land: false, seed: Math.random(), size,
      };
    }
    // coming back in from somewhere off to one side, to land on `to`
    function arriveAt(to, now, size) {
      const T = resolve(to);
      const side = Math.random() < 0.5 ? -1 : 1;
      const ang = rr(0.2, 0.8), dist = rr(0.7, 1.1);
      return {
        A: [T[0] + side * Math.cos(ang) * dist, T[1] + Math.sin(ang) * dist], B: to,
        c1: [-side * rr(0.1, 0.3), rr(-0.15, 0.05)], c2: [side * rr(0.03, 0.12), rr(0.04, 0.12)],
        t0: now, dur: rr(1.5, 2.3), land: true, seed: Math.random(), size,
      };
    }
    // a short hop from perch to perch
    function hop(from, to, now) {
      const A = resolve(from), B = resolve(to);
      const d = Math.hypot(B[0] - A[0], B[1] - A[1]);
      return {
        A: from, B: to, c1: [(B[0] - A[0]) * 0.2, 0.03 + d * 0.25], c2: [-(B[0] - A[0]) * 0.15, 0.02 + d * 0.2],
        t0: now, dur: clamp(0.5 + d * 1.6, 0.6, 1.8), land: true, seed: Math.random(),
      };
    }

    // ------------------------------------------------------------ update
    // env: { P, age, S, autumn, fall, winter, snow, melt, thaw, bloom, shed, spring, dusk, viewH, cam,
    //        time, dt, windAmp, treeH, scrollVel, paper, TL, windAt(x, y, twig), air(x, y) }
    function update(env) {
      for (const k in layers) layers[k].n = 0;
      const t = env.time, P = env.P;
      const rawDt = clamp(t - lastT, 0, 0.5), dt = Math.min(rawDt, 0.05);
      lastT = t;
      const events = [];
      const back = layers.back, front = layers.front, glowL = layers.glow;
      const treeH = Math.max(env.treeH, 0.02);
      const twigOf = (tb) => smooth(0.45, 0.9, tb == null ? 0.6 : tb);
      const tp = (x, y, tb) => {      // rest position on the tree -> world, with sway
        const sx = x * env.S, sy = y * env.S, w = env.windAt(sx, sy, twigOf(tb));
        return [sx + w[0], sy + w[1]];
      };
      const snowCover = smooth(0.25, 0.6, env.snow) * (1 - smooth(0.3, 0.9, env.thaw));
      const zoomedOut = smooth(0.22, 0.5, env.viewH);
      const night = 1 - 0.55 * env.dusk;
      // scrolling hurries anything still in the air down and on its way
      const hurry = 1 + Math.min(7, (env.scrollVel || 0) * 90);
      const groundBend = (x, y) => {
        const fr = Math.pow(0.5 + 0.5 * Math.sin(t * 0.37 - x * 1.3 / Math.max(treeH, 0.05)), 8);
        let b = -(0.5 * Math.sin(t * 1.3 + x * 2.2) + 0.22 * Math.sin(t * 2.9 + x * 5.3) + 0.8 * fr) * 0.12 * env.windAmp / 0.0105;
        b -= (env.air(x, y + 0.012)[0] / treeH) * 0.35;
        return clamp(b, -1.1, 1.1);
      };
      if (startle && t - startle.t > 12) startle = null;
      const fresh = startle && !startle.used ? startle : null;
      if (fresh) startle.used = true;

      // -- wildflowers: they open, set seed and die back; new ones come up --
      if (env.age > 0.2 && zoomedOut > 0.01) {
        const fp = [hex('#4c6b3c'), hex('#fbfaf3'), hex('#e4bf3e'), hex('#2a2a20')];
        const wp = [hex('#7d6b47'), hex('#d6ccae'), hex('#a3894a'), hex('#2a2a20')];
        for (const f of flowers) {
          let amt = smooth(f.birth, f.birth + 0.035, env.age);
          let wilt = f.death < 9 ? smooth(f.death, f.death + 0.03, env.age) : 0;
          if (env.age >= 1) wilt = Math.max(wilt, smooth(0.05 + 0.45 * f.k, 0.3 + 0.45 * f.k, env.autumn));
          if (f.spring && env.bloom > 0) {
            const sp = smooth(0.15 + 0.5 * f.k, 0.4 + 0.5 * f.k, env.bloom);
            if (sp > 0) { amt = sp; wilt = 0; }
          }
          const vis = amt * (1 - smooth(0.6, 1, wilt)) * (1 - snowCover) * zoomedOut;
          if (vis < 0.01) continue;
          const droop = wilt * (f.k < 0.5 ? -1 : 1) * 1.15;
          at(front, f.cell, f.x, f.y, 0.5, 0.985, f.lean + groundBend(f.x, f.y) * 0.55 + droop,
            f.size * (0.35 + 0.65 * amt) * (1 - 0.3 * wilt),
            { pal: wilt > 0 ? mixPal(fp, wp, wilt) : fp, sy: 0.55 + 0.45 * amt, alpha: Math.min(1, vis * 1.6) });
        }
      }

      // -- autumn mushrooms ---------------------------------------------------
      const mush = smooth(0.05, 0.3, env.autumn) * (1 - smooth(0, 0.3, env.snow)) * zoomedOut;
      if (mush > 0.01) {
        for (const [x, y, s, fl] of [[0.085, -0.014, 0.042, 1], [-0.25, -0.032, 0.034, -1], [0.36, -0.055, 0.03, 1]]) {
          at(front, C.MUSHROOMS, x, y, 0.5, 0.985, 0, s * mush, { pal: PAL.mushroom, flip: fl });
        }
      }

      // -- footprints and a snowman ----------------------------------------
      const smX = 0.42, smY = -0.045;
      const printsA = smooth(0.55, 0.8, env.snow) * (1 - smooth(0.1, 0.5, env.thaw));
      if (printsA > 0.01) {
        const x0 = env.cam.cx - env.cam.halfW - 0.05;
        for (let i = 0; i < 18; i++) {
          const u = i / 17;
          if (ramp(env.snow, 0.55 + u * 0.2, 0.6 + u * 0.2) <= 0) continue;
          const x = lerp(x0, smX - 0.09, u), y = smY - 0.022 + Math.sin(u * 7) * 0.008;
          at(front, C.PRINTS, x, y, 0.5, 0.5, -Math.PI / 2 + 0.25, 0.04, { pal: PAL.snow, sy: 0.42, alpha: printsA * 0.9 });
        }
      }
      const kb = [smooth(0.35, 0.55, env.snow), smooth(0.55, 0.7, env.snow), smooth(0.68, 0.82, env.snow)];
      const kd = smooth(0.8, 0.95, env.snow);
      if (kb[0] > 0.01) {
        const shrink = 1 - 0.55 * smooth(0, 0.9, env.thaw);
        const fade = 1 - smooth(0.72, 0.98, env.thaw);
        const lean = 0.22 * smooth(0.25, 0.65, env.thaw);
        const r0 = 0.043 * kb[0] * shrink, r1 = 0.032 * kb[1] * shrink, r2 = 0.023 * kb[2] * shrink;
        shadow(smX + 0.012, smY - 0.002, r0 * 3.2, r0 * 0.5, 0.45 * fade);
        const c0 = [smX, smY + r0 * 0.85];
        const c1 = [smX + lean * r0, c0[1] + r0 * 0.78 + r1 * 0.8];
        let c2 = [smX + lean * (r0 + r1 * 1.6), c1[1] + r1 * 0.75 + r2 * 0.85];
        const fall = smooth(0.45, 0.7, env.thaw);
        c2 = [c2[0] + fall * 0.05, lerp(c2[1], smY + r2 * 0.8, fall)];
        const ball = (c, r, a) => { if (r > 0.0005) at(front, C.SNOWBALL, c[0], c[1], 0.5, 0.5, 0, (2 * r) / 0.875, { pal: PAL.snow, alpha: a, grain: 0.6 }); };
        ball(c0, r0, fade); ball(c1, r1, fade);
        if (kd > 0.01) {
          for (const s of [-1, 1]) {
            at(front, C.TWIG, c1[0] + s * r1 * 0.85, c1[1] + r1 * 0.2, 16 / 256, 200 / 256, s < 0 ? -0.3 : 0.3, 0.065 * kd,
              { pal: PAL.ink, flip: s < 0 ? -1 : 1, alpha: fade * (1 - fall) });
          }
          for (let b = 0; b < 3; b++) at(front, C.DOT, c1[0] + 0.002, c1[1] + r1 * (0.5 - b * 0.42), 0.5, 0.5, 0, 0.007 * kd, { pal: PAL.ink, alpha: fade });
          line(front, c1[0] - r1 * 0.9, c1[1] + r1 * 0.85, c1[0] + r1 * 0.9, c1[1] + r1 * 0.85, 0.011 * kd, { pal: PAL.scarf, alpha: fade });
          line(front, c1[0] + r1 * 0.5, c1[1] + r1 * 0.85, c1[0] + r1 * 0.75 + 0.004 * Math.sin(t * 2.1), c1[1] + r1 * 0.85 - 0.04 * kd, 0.009 * kd, { pal: PAL.scarf, alpha: fade });
        }
        ball(c2, r2, fade);
        if (kd > 0.01) {
          for (const s of [-1, 1]) at(front, C.DOT, c2[0] + s * r2 * 0.32 + 0.003, c2[1] + r2 * 0.25, 0.5, 0.5, 0, 0.007 * kd, { pal: PAL.ink, alpha: fade });
          at(front, C.CARROT, c2[0] + r2 * 0.25, c2[1], 30 / 256, 0.5, -0.12 - fall * 1.2, 0.04 * kd, { pal: PAL.carrot, alpha: fade });
        }
      }

      // -- a bench under the tree, and later someone who once swung here -------
      const benchA = smooth(0.8, 0.86, env.age) * zoomedOut;
      if (benchA > 0.01) drawBench(env, t, benchA, snowCover, shadow);

      // -- rope swing on the low limb -------------------------------------
      const sw = sites.swing;
      const hung = smooth(0.7, 0.76, env.age) * zoomedOut;
      if (sw && hung > 0.01) drawSwing(env, t, dt, tp, sw, hung, snowCover, events);

      // -- nest, chicks and a busy parent -----------------------------------
      const ns = sites.nest;
      const built = smooth(0.72, 0.78, env.age);
      if (ns && built > 0.01) {
        const [nx, ny] = tp(ns.x, ns.y, ns.tb);
        const nsz = 0.095 * built;
        const chicks = smooth(env.TL.kid[0] - 0.005, env.TL.kid[0] + 0.005, P) * (1 - smooth(env.TL.kid[1] - 0.008, env.TL.kid[1], P));
        const fed = chicks > 0.01 && parent.state === 'feed';
        if (chicks > 0.01) {
          for (let i = 0; i < 3; i++) {
            const bob = Math.sin(t * 6 + i * 2) * 0.0012 + (fed ? 0.0045 : 0);
            const open = fed && Math.sin(t * 9 + i * 1.7) > -0.2;
            at(front, open ? C.CHICK_OPEN : C.CHICK, nx + (i - 1) * 0.018, ny + nsz * 0.36 + bob, 0.5, 0.75,
              (i - 1) * 0.15 + (fed ? 0.2 * Math.sin(t * 5 + i) : 0), 0.042 * chicks, { pal: PAL.chick, flip: i === 0 ? -1 : 1 });
          }
        }
        at(front, C.NEST, nx, ny, 0.5, 186 / 256, 0, nsz, { pal: PAL.nest });
        if (snowCover > 0.01) at(front, C.NEST_SNOW, nx, ny, 0.5, 186 / 256, 0, nsz, { pal: PAL.snow, alpha: snowCover * (1 - smooth(0.2, 0.7, env.melt)), grain: 0.5 });
        if (chicks > 0.01) parentBird(front, t, nx, ny, nsz, chicks, fresh);
        else parent.state = 'away';
      }

      // -- butterflies (summer days, and a few in spring) -------------------
      const bf = Math.max(smooth(0.5, 0.65, env.age) * (1 - smooth(env.TL.kid[1] - 0.01, env.TL.kid[1] + 0.005, P)),
        0.6 * smooth(0.3, 0.7, env.bloom)) * zoomedOut;
      if (bf > 0.01) {
        butterflies.forEach((b, i) => {
          if (i / butterflies.length > bf) return;
          // a wandering, fluttering flight: slow drift plus quick jinks
          const x = b.cx + b.ax * Math.sin(t * b.w1 + b.p1) + 0.05 * Math.sin(t * 1.7 + b.p2) + 0.012 * Math.sin(t * 4.1 + b.p1 * 3);
          const y = b.cy + b.ay * Math.sin(t * b.w2 + b.p2) + 0.014 * Math.abs(Math.sin(t * 3.3 + b.p1)) + 0.008 * Math.sin(t * 6.1);
          const vx = b.ax * b.w1 * Math.cos(t * b.w1 + b.p1) + 0.085 * Math.cos(t * 1.7 + b.p2);
          const flapPh = Math.sin(t * b.flap + b.p1 + Math.sin(t * 2.3) * 1.5);
          const open = 0.12 + 0.88 * Math.abs(flapPh);
          emit(front, C.BUTTERFLY, x, y, (vx >= 0 ? -0.35 : 0.35) + 0.15 * flapPh, b.size, { pal: b.pal, aspect: open });
        });
      }

      // -- squirrel in autumn: up the trunk, out on the limb, a snack, back ---
      const sq = smooth(env.TL.autumn[0] + 0.008, env.TL.autumn[0] + 0.016, P) * (1 - smooth(env.TL.fall[1] - 0.012, env.TL.fall[1], P));
      if (sq > 0.01 && sites.limb.length > 2) squirrel(front, t, tp, sq);

      // -- geese heading south ------------------------------------------------
      const flockOn = smooth(env.TL.autumn[0] + 0.008, env.TL.autumn[0] + 0.016, P) * (1 - smooth(env.TL.fall[1] - 0.025, env.TL.fall[1] - 0.012, P));
      if (flockOn > 0.01) {
        flockClock += rawDt;
        const pass = Math.floor((flockClock + 16) / 17.5), u = ((flockClock + 16) % 17.5) / 13;
        if (u < 1) { geese(back, env, t, pass, u, flockOn); if (u > 0.08 && u < 0.92) events.push('geese'); }
      } else if (P < env.TL.autumn[0]) flockClock = 0;

      // -- the cardinal on a snowy branch ----------------------------------
      const rp = sites.redPerch;
      const arrive = smooth(0.35, 0.6, env.snow), leave = smooth(0.08, 0.4, env.melt);
      if (rp && arrive > 0.001 && leave < 0.999) {
        const perch = () => {
          const [px0, py0] = tp(rp.x, rp.y, rp.tb);
          const up = perchUp(rp), lift = rp.r * env.S + 0.006 * env.snow;
          return [px0 + up[0] * lift, py0 + up[1] * lift];
        };
        const P0 = perch();
        const sz = 0.07;
        if (arrive < 1) {
          const f = { A: [P0[0] + 0.75, P0[1] + 0.42], B: perch, c1: [-0.15, 0.08], c2: [0.12, 0.1], t0: 0, dur: 1, land: true, seed: 0.3 };
          const u = arrive;
          if (u < 0.97) flightAt(front, f, u, t, PAL.cardinal, sz, C.FLYBODY_CREST);
          else at(front, C.CARDINAL, P0[0], P0[1], 124 / 256, 214 / 256, 0, sz, { pal: PAL.cardinal, flip: -1 });
          cardinal.state = 'perch'; cardinal.path = null;
        } else if (leave > 0) {
          const f = { A: perch, B: [P0[0] - 0.85, P0[1] + 0.55], c1: [-0.03, 0.08], c2: [0.25, -0.1], t0: 0, dur: 1, land: false, seed: 0.6 };
          flightAt(front, f, leave, t, PAL.cardinal, sz, C.FLYBODY_CREST);
          cardinal.state = 'perch'; cardinal.path = null;
        } else {
          if (fresh && cardinal.state === 'perch') {
            cardinal.state = 'flee'; cardinal.path = escapeFrom(P0, t, fresh.x, sz);
            cardinal.back = cardinal.path.t0 + cardinal.path.dur + rr(1.5, 4);
          }
          if (cardinal.state === 'flee') {
            if (t < cardinal.path.t0) perched(front, P0, t, PAL.cardinal, sz, C.CARDINAL, C.CARDINAL_PECK, 7, true);
            else if (t < cardinal.path.t0 + cardinal.path.dur) flight(front, cardinal.path, t, PAL.cardinal, sz, { body: C.FLYBODY_CREST });
            else if (t >= cardinal.back) { cardinal.state = 'return'; cardinal.path = arriveAt(perch, t, sz); }
          }
          if (cardinal.state === 'return') {
            const u = flight(front, cardinal.path, t, PAL.cardinal, sz, { body: C.FLYBODY_CREST });
            if (u >= 1) cardinal.state = 'perch';
          }
          if (cardinal.state === 'perch') perched(front, P0, t, PAL.cardinal, sz, C.CARDINAL, C.CARDINAL_PECK, 7, false);
        }
      } else { cardinal.state = 'perch'; cardinal.path = null; }

      // -- birds back with the blossom ----------------------------------------
      const bb = smooth(0.25, 0.55, env.bloom);
      if (bb > 0.01 && springPerches.length > 4) {
        springBirds.forEach((b, i) => {
          if (i / springBirds.length > bb) { b.state = 'away'; return; }
          springBird(front, b, i, t, tp, fresh);
        });
        if (bb > 0.5) events.push('birds');
      } else for (const b of springBirds) { b.state = 'away'; b.until = t + rr(0.3, 2); }

      // -- bees around the blossom --------------------------------------------
      const bz = smooth(0.4, 0.7, env.bloom) * (1 - smooth(0.6, 1, env.shed));
      if (bz > 0.01 && twigs.length) {
        bees.forEach((b, i) => {
          if (i / bees.length > bz) return;
          const tt = t + b.off, k = Math.floor(tt / b.seg), u = (tt % b.seg) / b.seg;
          const pA = twigs[Math.floor(hash(k + b.k) * twigs.length)], pB = twigs[Math.floor(hash(k + 1 + b.k) * twigs.length)];
          const A = tp(pA[0], pA[1], 0.9), B = tp(pB[0], pB[1], 0.9);
          const m = smooth(0.85, 1, u);
          const x = lerp(A[0], B[0], m) + 0.018 * Math.sin(tt * 3.1 + i) + 0.006 * Math.sin(tt * 19 + i);
          const y = lerp(A[1], B[1], m) + 0.012 * Math.sin(tt * 2.3 + i * 2) + 0.005 * Math.sin(tt * 23);
          const vx = Math.cos(tt * 3.1 + i) + (B[0] - A[0]) * 4 * (m > 0 && m < 1 ? 1 : 0);
          emit(front, C.BEE, x, y, 0, 0.014, { pal: PAL.bee, flip: vx >= 0 ? 1 : -1, sy: 0.92 + 0.08 * Math.sin(tt * 60) });
        });
      }

      // -- fireflies: a few, low in the grass under the crown --------------------
      if (env.dusk > 0.01) {
        const dark = smooth(0.4, 1, env.dusk);
        for (const f of fireflies) {
          const c = (t + f.off) % f.period;                    // seconds into its cycle
          const flash = smooth(0, 0.15, c) * (1 - smooth(0.3, 0.75, c));
          if (flash * dark < 0.01) continue;
          const x = f.x + f.ax * Math.sin(t * f.f1 + f.p1) + 0.012 * Math.sin(t * 0.83 + f.p2 * 2);
          const y = f.y + f.ay * Math.sin(t * f.f2 + f.p2) + 0.01 * Math.sin(Math.PI * Math.min(c / 0.75, 1));   // climbs as it flashes
          const b = flash * dark;
          emit(glowL, C.GLOW, x, y, 0, 0.05 * f.size, { pal: PAL.glow, alpha: b * 0.38, mode: 1 });
          emit(glowL, C.GLOW, x, y, 0, 0.011 * f.size, { pal: PAL.glow, alpha: Math.min(1, b * 1.2), mode: 1 });
        }
        if (dark > 0.5) events.push('crickets');
      }

      // -- loose things in the air: shaken off, or blown off by the cursor ------
      const kind = looseKind(env, snowCover);
      if (kind && crownSpots.length && dt > 0) {
        for (let i = 0; i < 5; i++) {
          const sp0 = crownSpots[Math.floor(Math.random() * crownSpots.length)];
          const sx = sp0[0] * env.S, sy = sp0[1] * env.S;
          const a = env.air(sx, sy), speed = Math.hypot(a[0], a[1]) / treeH;
          if (speed < 0.45) continue;
          const rate = kind === 'petals' ? 26 : kind === 'snow' ? 12 : env.autumn > 0.4 ? 22 : 2.5;
          if (Math.random() < (speed - 0.45) * rate * dt) spawn(kind, sx, sy, a[0] * 0.5, a[1] * 0.3, env);
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!stepParticle(p, dt, env, hurry)) { particles.splice(i, 1); continue; }
        drawParticle(front, p, night);
      }

      return { layers, events };
    }

    // -------------------------------------------------------- the swing
    function drawSwing(env, t, dt, tp, sw, hung, snowCover, events) {
      const front = layers.front, P = env.P;
      const [hx, hy0] = tp(sw.x, sw.y, sw.tb);
      const hy = hy0 - sw.r * env.S;
      const Lr = 0.222 * hung;
      const kid = smooth(env.TL.kid[0], env.TL.kid[0] + 0.008, P) * (1 - smooth(env.TL.kid[1] - 0.008, env.TL.kid[1], P));
      const s = swingSt;
      const G = 1.05, L = Math.max(Lr, 0.05), w0 = Math.sqrt(G / L);
      if (dt > 0) {
        // the limb it hangs from sways; the swing feels that as a moving pivot
        if (s.px == null) { s.px = hx; s.py = hy; }
        let pvx = (hx - s.px) / dt, pvy = (hy - s.py) / dt;
        let pax = clamp((pvx - s.pvx) / dt, -3, 3), pay = clamp((pvy - s.pvy) / dt, -3, 3);
        if (Math.hypot(hx - s.px, hy - s.py) > 0.01) { pax = pay = pvx = pvy = 0; }
        s.px = hx; s.py = hy; s.pvx = pvx; s.pvy = pvy;
        const target = 0.4 * kid;
        const amb = (Math.sin(t * 0.73 - 0.3) * 0.55 + Math.sin(t * 1.61 - 0.7) * 0.3) * env.windAmp * 5;
        const drag = lerp(0.55, 0.12, kid);
        const n = 4, h = dt / n;
        for (let i = 0; i < n; i++) {
          const sn = Math.sin(s.th), cs = Math.cos(s.th);
          const air = env.air(hx + L * sn, hy - L * cs);
          const vx = L * s.w * cs, vy = L * s.w * sn;
          const ft = ((air[0] + amb - vx) * cs + (air[1] - vy) * sn) * drag;
          let acc = -(G / L) * sn - 0.05 * s.w + ft / L - (pax * cs + pay * sn) / L;
          if (kid > 0.01) {
            // pumping: legs and body move in time with the swing and feed it energy
            const amp = Math.acos(clamp(cs - (s.w * s.w) / (2 * w0 * w0), -1, 1));
            acc += 0.6 * kid * Math.sign(s.w || 1) * clamp((target - amp) * 4, -1, 1) * Math.abs(cs);
          }
          s.w += acc * h;
          s.th = clamp(s.th + s.w * h, -1.3, 1.3);
        }
        const sg = Math.sign(s.w);
        const amp = Math.acos(clamp(Math.cos(s.th) - (s.w * s.w) / (2 * w0 * w0), -1, 1));
        if (sg !== s.lastSign && s.lastSign !== 0 && amp > 0.12) events.push('creak');
        s.lastSign = sg;
      }
      const sn = Math.sin(s.th), cs = Math.cos(s.th);
      const sx = hx + Lr * sn, sy = hy - Lr * cs;
      const amp = Math.acos(clamp(cs - (s.w * s.w) / (2 * w0 * w0), -1, 1));
      const farD = [0.0018, 0.0011];
      const ropeFar = { pal: darker(PAL.rope, 0.8), alpha: 0.95 };
      // the shadow sweeps over the grass with the swing
      const seatH = Math.max(0.01, sy + 0.012);
      shadow(sx + seatH * 0.35, -0.01, 0.026 + 0.03 * kid, 0.0055, (0.28 + 0.2 * kid) * hung / (1 + seatH * 12) * (1 - 0.6 * env.dusk));
      line(front, hx + farD[0], hy + farD[1], sx + farD[0], sy + farD[1], 0.0016, ropeFar);
      const girl = kid > 0.01 ? girlPose(sx, sy, s.th, s.w, w0, amp, t, dt) : null;
      if (girl) girlFar(front, girl, kid, farD);
      at(front, C.SEAT, sx, sy, 0.5, 0.5, s.th, 0.028, { pal: PAL.wood });
      if (snowCover > 0.01) {
        const k = snowCover * (1 - env.melt);
        at(front, C.SNOWCAP, sx, sy + 0.002, 0.5, 150 / 256, s.th, 0.026, { pal: PAL.snow, sy: 0.7, alpha: k, grain: 0.5 });
      }
      if (girl) girlNear(front, girl, kid);
      line(front, hx, hy, sx, sy, 0.0019, { pal: PAL.rope });
      if (girl) girlHands(front, girl, kid);
    }

    // Where every joint of the girl is this frame. She faces left, away from
    // the trunk, and pumps: leaning back with her legs out as she swings
    // forward, sitting up with them tucked under on the way back.
    function girlPose(sx, sy, th, w, w0, amp, t, dt) {
      const G = GIRL, facing = -1;
      const sn = Math.sin(th), cs = Math.cos(th);
      const u = [-sn, cs], f = [facing * cs, facing * sn];
      const vec = (a) => [f[0] * Math.cos(a) + u[0] * Math.sin(a), f[1] * Math.cos(a) + u[1] * Math.sin(a)];
      const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
      const vF = (w * facing) / (Math.max(amp, 0.12) * w0);
      const ext = smooth(-0.35, 0.45, vF);
      const lean = lerp(-0.16, 0.5, ext);
      const hip = add(add([sx, sy], u, 0.0045 * GK), f, -0.0028 * GK);
      const tor = vec(Math.PI / 2 + lean);
      const sh = add(hip, tor, G.torso);
      const neck = add(add(sh, tor, 0.0022 * GK), f, 0.0012 * GK);
      const headRot = Math.atan2(tor[1], tor[0]) - Math.PI / 2 - facing * lean * 0.55;
      const thighA = lerp(0.03, 0.34, ext), kneeA = thighA - lerp(1.7, 0.2, ext);
      const knee = add(hip, vec(thighA), G.thigh);
      const ankle = add(knee, vec(kneeA), G.shin);
      const footRot = Math.atan2(vec(kneeA)[1], vec(kneeA)[0]) + Math.PI / 2 * -facing;
      const grip = add([sx, sy], u, 0.038 * GK);
      const shJ = add(sh, tor, -0.0028 * GK);
      const below = (j) => -(j[0] * u[0] + j[1] * u[1]) - 0.4 * (j[0] * f[0] + j[1] * f[1]);
      const [elbow, hand] = reach(shJ, grip, G.upper, G.fore, below);
      // ponytail: three loose points swinging under gravity and the swing's motion
      const hs = GIRL.head * 256 / 58;
      const anchor = cellPoint(neck[0], neck[1], 122 / 256, 206 / 256, headRot, hs, facing, 70 / 256, 104 / 256);
      let hr = swingSt.hair;
      if (!hr || Math.hypot(hr.p[0][0] - anchor[0], hr.p[0][1] - anchor[1]) > 0.03) {
        hr = swingSt.hair = { p: [0, 1, 2, 3].map((k) => [anchor[0] + 0.001 * k, anchor[1] - 0.0055 * GK * k]), q: null };
        hr.q = hr.p.map((p) => p.slice());
      }
      if (dt > 0) {
        const n = 3, h = dt / n, seg = 0.0056 * GK;
        for (let k = 0; k < n; k++) {
          hr.p[0] = anchor.slice();
          for (let i = 1; i < 4; i++) {
            const p = hr.p[i], q = hr.q[i];
            const vx = (p[0] - q[0]) * 0.985, vy = (p[1] - q[1]) * 0.985;
            hr.q[i] = p.slice();
            p[0] += vx; p[1] += vy - 1.05 * h * h;
          }
          for (let it = 0; it < 2; it++) {
            for (let i = 1; i < 4; i++) {
              const a = hr.p[i - 1], b = hr.p[i];
              const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1e-6;
              b[0] = a[0] + dx / d * seg; b[1] = a[1] + dy / d * seg;
            }
          }
        }
      }
      return { facing, f, u, hip, sh, neck, headRot, knee, ankle, footRot, shJ, elbow, hand, ext, hair: hr.p, vF, t };
    }
    function girlFar(L, g, a, d) {
      const off = (p) => [p[0] + d[0], p[1] + d[1]];
      const skin = darker(PAL.girlSkin, 0.78);
      bone(L, off(g.shJ), off(g.elbow), GIRL.armW, skin, a);
      bone(L, off(g.elbow), off(g.hand), GIRL.armW * 0.92, skin, a);
      bone(L, off(g.hip), off(g.knee), GIRL.legW, skin, a);
      bone(L, off(g.knee), off(g.ankle), GIRL.legW * 0.85, skin, a);
      at(L, C.SHOE, g.ankle[0] + d[0], g.ankle[1] + d[1], 110 / 256, 96 / 256, g.footRot, 0.012 * GK, { pal: darker(PAL.shoe, 0.8), flip: g.facing, alpha: a });
      // the ponytail hangs behind her
      for (let i = 0; i < 3; i++) {
        const p = g.hair[i], q = g.hair[i + 1];
        const wv = lerp(0.0062, 0.0032, i / 2) * GK;
        const dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy) || 1e-6;
        let px = dy / l, py = -dx / l; if (px < 0) { px = -px; py = -py; }
        const k = wv / 0.34;
        emitAff(L, C.HAIRLOCK, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, px * k, py * k, dx * 1.25, dy * 1.25, { pal: PAL.hair, alpha: a });
      }
    }
    function girlNear(L, g, a) {
      const hs = GIRL.head * 256 / 58, ts = GIRL.torso * 256 / 170;
      const torRot = Math.atan2(g.sh[1] - g.hip[1], g.sh[0] - g.hip[0]) - Math.PI / 2;
      at(L, C.TORSO_GIRL, g.hip[0], g.hip[1], 126 / 256, 214 / 256, torRot, ts, { pal: PAL.girlDress, flip: g.facing, alpha: a });
      bone(L, g.hip, g.knee, GIRL.legW, PAL.girlSkin, a);
      bone(L, g.knee, g.ankle, GIRL.legW * 0.85, PAL.girlSkin, a);
      at(L, C.SHOE, g.ankle[0], g.ankle[1], 110 / 256, 96 / 256, g.footRot, 0.012 * GK, { pal: PAL.shoe, flip: g.facing, alpha: a });
      // the skirt lies over her lap; the hem lifts in the rush of air
      const kx = g.knee[0] - g.hip[0], ky = g.knee[1] - g.hip[1], kl = Math.hypot(kx, ky) || 1e-6;
      const sc = kl * 256 / 150;
      const thighRot = Math.atan2(ky * g.facing, kx * g.facing);
      const lift = 1 - 0.22 * clamp(g.vF, -1, 1) + 0.05 * Math.sin(g.t * 11);
      at(L, C.SKIRT_GIRL, g.hip[0], g.hip[1], 52 / 256, 96 / 256, thighRot, sc, { pal: PAL.girlDress, flip: g.facing, alpha: a, sy: lift });
      at(L, C.HEAD_GIRL, g.neck[0], g.neck[1], 122 / 256, 206 / 256, g.headRot, hs, { pal: PAL.girlSkin, flip: g.facing, alpha: a });
    }
    function girlHands(L, g, a) {
      bone(L, g.shJ, g.elbow, GIRL.armW, PAL.girlSkin, a);
      bone(L, g.elbow, g.hand, GIRL.armW * 0.92, PAL.girlSkin, a);
      emitAff(L, C.LIMB_CAP, g.hand[0], g.hand[1], 0.0056 * GK / 0.5, 0, 0, 0.0056 * GK / 0.5, { pal: PAL.girlSkin, alpha: a });
    }

    // -------------------------------------------------------- the bench
    // Layers, back to front: the far end and the slats, her body, the near
    // end frame and slat ends, then her near arm resting on the armrest.
    function drawBench(env, t, benchA, snowCover, shadowFn) {
      const front = layers.front;
      const { x: bx, y: by, size } = BENCH;
      const cpt = (u, v) => [bx + (u - 184) / 256 * size, by - (v - 244) / 256 * size];
      const sc = cpt(132, 244);
      shadowFn(sc[0] + 0.004, sc[1] - 0.001, 0.07, 0.013, 0.5 * benchA * (1 - 0.6 * env.dusk));
      at(front, C.BENCH, bx, by, 184 / 256, 244 / 256, 0, size, { pal: PAL.bench, alpha: benchA });
      const elderA = smooth(0.12, 0.32, env.bloom) * benchA;
      const arm = elderA > 0.01 ? elder(front, t, cpt, elderA, env) : null;
      at(front, C.BENCH_NEAR, bx, by, 184 / 256, 244 / 256, 0, size, { pal: PAL.bench, alpha: benchA });
      if (arm) arm();
      if (snowCover > 0.01) {
        const k = snowCover * benchA * (1 - smooth(0.1, 0.6, env.melt));
        for (const [u0, v0, u1, v1, th] of [[70, 142, 148, 142, 0.009], [100, 159, 178, 159, 0.012], [96, 121, 172, 117, 0.007], [78, 84, 94, 82, 0.006]]) {
          const p = cpt(u0, v0), q = cpt(u1, v1), dx = q[0] - p[0], dy = q[1] - p[1];
          emitAff(front, C.SNOWCAP, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + th * 0.25, dx * 1.08, dy * 1.08, 0, th * 2.2, { pal: PAL.snow, alpha: k, grain: 0.5 });
        }
      }
    }

    // Seated well back on the seat, a little stooped, breathing. She watches
    // the swing, now and then looks up into the blossom, and lifts her hand
    // from the armrest to catch a petal. Returns a function that draws the
    // near arm, which goes over the bench's near end.
    function elder(L, t, cpt, a, env) {
      const D = OLD, facing = 1;
      const hip = cpt(121, 155);
      const ground = cpt(0, 241)[1];
      const breath = Math.sin(t * 2 * Math.PI / 4.4);
      const stoop = 0.17 + 0.015 * breath;
      const tor = [Math.sin(stoop) * facing, Math.cos(stoop)];
      const tl = D.torso * (1 + 0.012 * breath);
      const sh = [hip[0] + tor[0] * tl, hip[1] + tor[1] * tl];
      const lt = (t + 3) % 15;
      const up = smooth(2.5, 4.5, lt) * (1 - smooth(8.5, 10.5, lt));
      const headRot = facing * (-0.12 + 0.5 * up + 0.03 * Math.sin(t * 0.8)) - stoop * facing * 0.4;
      const neck = [sh[0] + tor[0] * 0.002 * OK + facing * 0.0028 * OK, sh[1] + tor[1] * 0.002 * OK];
      const knee = [hip[0] + facing * D.thigh, hip[1] - 0.001 * OK];
      const ankle = [knee[0] + facing * 0.005 * OK, ground + 0.0035 * OK];
      const shJ = [sh[0] - facing * 0.002 * OK, sh[1] - 0.0035 * OK];
      // far hand on the cane, planted in front of her feet
      const caneTop = [knee[0] + facing * 0.009 * OK, knee[1] + 0.012 * OK];
      const caneFoot = [knee[0] + facing * 0.017 * OK, ground];
      const elbowSide = (j) => -j[1] - facing * j[0] * 0.3;
      const farArm = reach([shJ[0] - 0.0015, shJ[1] + 0.001], caneTop, D.upper, D.fore, elbowSide);
      // near hand: on the armrest, or lifted, palm up, when petals are falling
      const rest = cpt(156, 113);
      const ct = (t + 6) % 16;
      const raise = smooth(1, 2.3, ct) * (1 - smooth(5.6, 7, ct)) * smooth(0.05, 0.3, env.shed);
      const lift = [sh[0] + facing * 0.024 * OK, sh[1] - 0.002 * OK];
      const nearArm = reach(shJ, [lerp(rest[0], lift[0], raise), lerp(rest[1], lift[1], raise)], D.upper, D.fore, elbowSide);
      const skinF = darker(PAL.oldSkin, 0.8), cardF = darker(PAL.cardigan, 0.8);
      // behind: far arm, cane, far leg
      bone(L, [shJ[0] - 0.0015, shJ[1] + 0.001], farArm[0], D.armW, cardF, a);
      bone(L, farArm[0], farArm[1], D.armW * 0.9, cardF, a);
      line(L, caneTop[0], caneTop[1] + 0.002, caneFoot[0], caneFoot[1], 0.0026, { pal: PAL.wood, alpha: a });
      emitAff(L, C.LIMB_CAP, farArm[1][0], farArm[1][1], 0.011 * OK, 0, 0, 0.011 * OK, { pal: skinF, alpha: a });
      const fo = [-0.0018 * OK, 0.001 * OK];
      bone(L, [knee[0] + fo[0], knee[1] + fo[1]], [ankle[0] + fo[0] - 0.002, ankle[1]], D.legW * 0.85, darker(PAL.stocking, 0.8), a);
      at(L, C.SHOE, ankle[0] + fo[0] - 0.002, ankle[1], 110 / 256, 96 / 256, 0, 0.014 * OK, { pal: darker(PAL.shoe, 0.8), flip: facing, alpha: a });
      // body
      const ts = tl * 256 / 170;
      at(L, C.TORSO_OLD, hip[0], hip[1], 126 / 256, 214 / 256, Math.atan2(tor[1], tor[0]) - Math.PI / 2, ts, { pal: PAL.cardigan, flip: facing, alpha: a });
      bone(L, knee, ankle, D.legW * 0.85, PAL.stocking, a);
      at(L, C.SHOE, ankle[0], ankle[1], 110 / 256, 96 / 256, 0, 0.014 * OK, { pal: PAL.shoe, flip: facing, alpha: a });
      const kl = Math.hypot(knee[0] - hip[0], knee[1] - hip[1]);
      at(L, C.SKIRT_OLD, hip[0], hip[1], 52 / 256, 96 / 256, Math.atan2(knee[1] - hip[1], (knee[0] - hip[0]) * facing) * facing, kl * 256 / 150, { pal: PAL.oldSkirt, flip: facing, alpha: a });
      at(L, C.HEAD_OLD, neck[0], neck[1], 122 / 256, 206 / 256, headRot, D.head * 256 / 58, { pal: PAL.oldSkin, flip: facing, alpha: a });
      return () => {
        bone(L, shJ, nearArm[0], D.armW, PAL.cardigan, a);
        bone(L, nearArm[0], nearArm[1], D.armW * 0.9, PAL.cardigan, a);
        emitAff(L, C.LIMB_CAP, nearArm[1][0], nearArm[1][1], 0.011 * OK, 0, 0, 0.0095 * OK, { pal: PAL.oldSkin, alpha: a });
        if (raise > 0.8) {
          const k = smooth(0.8, 1, raise);
          at(L, C.PETAL, nearArm[1][0] + 0.001, nearArm[1][1] + 0.003, 0.5, 0.5, 0.6 + 0.1 * Math.sin(t * 2), 0.012,
            { pal: [hex('#e3a2b4'), hex('#fcf1f3'), hex('#ad3459'), hex('#d2a940')], alpha: a * k, sy: 0.5 });
        }
      };
    }

    // -------------------------------------------------------- birds
    // perched: looks about, pecks, now and then hops round to face the other way
    function perched(L, p, t, palette, size, cell, peckCell, salt, alarmed) {
      const seg = Math.floor(t / 2.4 + salt), u = (t / 2.4 + salt) % 1;
      const peck = !alarmed && hash(seg * 3.1 + salt) < 0.35 && u > 0.3 && u < 0.7;
      const flip = hash(Math.floor(t / 5.3 + salt) * 7.7) < 0.5 ? 1 : -1;
      const hopU = (t / 5.3 + salt) % 1;
      const hopY = hopU < 0.05 ? Math.sin((hopU / 0.05) * Math.PI) * size * 0.08 : 0;
      at(L, peck ? peckCell : cell, p[0], p[1] + hopY, 124 / 256, 214 / 256, alarmed ? 0.12 * flip : 0, size, { pal: palette, flip });
    }
    // a flight driven by a 0..1 parameter rather than the clock (scroll-timed arrivals)
    function flightAt(L, f, u, t, palette, size, body) {
      const g = { ...f, t0: t - u * 1, dur: 1 };
      flight(L, g, t, palette, size, { body });
    }

    function parentBird(L, t, nx, ny, nsz, alpha, fresh) {
      const pb = parent, sz = 0.06;
      const rimFor = (side) => () => [nx + 0.036 * side, ny + nsz * 0.42];
      if (pb.state === 'away' && t >= pb.until) {
        pb.side = Math.random() < 0.5 ? -1 : 1;
        pb.rim = rimFor(pb.side);
        pb.path = arriveAt(pb.rim, t, sz);
        pb.state = 'in';
      }
      if (fresh && (pb.state === 'feed' || pb.state === 'in')) {
        const here = pb.state === 'feed' ? resolve(pb.rim) : bez3Point(pb.path, t);
        pb.path = escapeFrom(here, t, fresh.x, sz);
        pb.state = 'out';
      }
      if (pb.state === 'in') {
        const u = flight(L, pb.path, t, PAL.robin, sz, { alpha });
        if (u >= 1) { pb.state = 'feed'; pb.until = t + rr(2.2, 3.6); }
      } else if (pb.state === 'feed') {
        const p = resolve(pb.rim);
        const peck = Math.sin(t * 7) > 0.2;
        at(L, peck ? C.BIRD_PECK : C.BIRD, p[0], p[1], 124 / 256, 214 / 256, 0, sz, { pal: PAL.robin, flip: pb.side > 0 ? -1 : 1, alpha });
        if (t >= pb.until) {
          const from = resolve(pb.rim);
          pb.path = escapeFrom(from, t, from[0] + pb.side * 0.2, sz);
          pb.path.t0 = t; pb.path.dur = rr(1.4, 2.0);
          pb.state = 'out';
        }
      } else if (pb.state === 'out') {
        if (t < pb.path.t0) {
          const p = resolve(pb.rim);
          at(L, C.BIRD, p[0], p[1], 124 / 256, 214 / 256, 0, sz, { pal: PAL.robin, flip: pb.side > 0 ? -1 : 1, alpha });
        } else {
          const u = flight(L, pb.path, t, PAL.robin, sz, { alpha });
          if (u >= 1) { pb.state = 'away'; pb.until = t + rr(1.5, 4.5); }
        }
      }
    }
    function bez3Point(f, t) {
      const u = clamp((t - f.t0) / f.dur, 0, 1);
      const A = resolve(f.A), B = resolve(f.B);
      return bez3(A, [A[0] + f.c1[0], A[1] + f.c1[1]], [B[0] + f.c2[0], B[1] + f.c2[1]], B, u);
    }

    function springBird(L, b, i, t, tp, fresh) {
      const perchPos = (k) => () => {
        const p = springPerches[k];
        const [x, y] = tp(p.x, p.y, p.tb), up = perchUp(p);
        return [x + up[0] * (p.r + 0.003), y + up[1] * (p.r + 0.003)];
      };
      const pickPerch = (near) => {
        if (near != null && Math.random() < 0.75) {
          const here = springPerches[near];
          let best = -1, bd = 1e9;
          for (let k = 0; k < 12; k++) {
            const c = Math.floor(Math.random() * springPerches.length);
            const d = Math.abs(Math.hypot(springPerches[c].x - here.x, springPerches[c].y - here.y) - 0.15);
            if (c !== near && d < bd) { bd = d; best = c; }
          }
          if (best >= 0) return best;
        }
        return Math.floor(Math.random() * springPerches.length);
      };
      if (fresh && (b.state === 'perch' || b.state === 'hop')) {
        const here = b.state === 'perch' ? perchPos(b.perch)() : bez3Point(b.path, t);
        b.path = escapeFrom(here, t, fresh.x, b.size);
        b.state = 'flee';
      }
      switch (b.state) {
        case 'away':
          if (t >= b.until) {
            b.perch = pickPerch(null);
            b.path = arriveAt(perchPos(b.perch), t, b.size);
            b.state = 'hop';
          }
          break;
        case 'perch': {
          perched(L, perchPos(b.perch)(), t, b.pal, b.size, C.BIRD, C.BIRD_PECK, i * 3.3, false);
          if (t >= b.until) {
            if (Math.random() < 0.85) {
              const next = pickPerch(b.perch);
              b.path = hop(perchPos(b.perch), perchPos(next), t);
              b.perch = next;
              b.state = 'hop';
            } else {
              const here = perchPos(b.perch)();
              b.path = escapeFrom(here, t, here[0] + (Math.random() - 0.5), b.size);
              b.path.t0 = t;
              b.state = 'flee';
            }
          }
          break;
        }
        case 'hop': {
          const u = flight(L, b.path, t, b.pal, b.size);
          if (u >= 1) { b.state = 'perch'; b.until = t + rr(1.8, 5.5); }
          break;
        }
        case 'flee': {
          if (t < b.path.t0) perched(L, resolve(b.path.A), t, b.pal, b.size, C.BIRD, C.BIRD, i * 3.3, true);
          else {
            const u = flight(L, b.path, t, b.pal, b.size);
            if (u >= 1) { b.state = 'away'; b.until = t + rr(1.5, 5); }
          }
          break;
        }
        default: break;
      }
    }

    // A skein of geese crossing the sky in a loose V, seen from below and a
    // little to the side as they head south and away: the near arm of the V
    // sits higher and larger, the far arm lower, smaller and paler.
    function geese(L, env, t, pass, u, on) {
      const cam = env.cam, viewH = cam.halfH * 2;
      const groups = [
        { n: 9 + Math.floor(hash(pass * 3.1) * 6), alt: 0.6 + 0.22 * hash(pass * 5.7), scale: 0.95 + 0.25 * hash(pass * 2.3), lag: 0, haze: 0.16 },
      ];
      if (hash(pass * 8.9) < 0.7) groups.push({ n: 5 + Math.floor(hash(pass * 4.4) * 4), alt: 0.5 + 0.3 * hash(pass * 6.1), scale: 0.62, lag: 0.12 + 0.1 * hash(pass * 1.9), haze: 0.4 });
      for (const g of groups) {
        const uu = u - g.lag;
        if (uu <= 0 || uu >= 1.25) continue;
        const size = 0.034 * (viewH / 1.5) * g.scale;
        const sp = size * 1.15;
        const span = cam.halfW * 2 + 0.6 + g.n * sp;
        const lx = cam.cx + cam.halfW + 0.15 - uu * span / 1.05;
        const ly = cam.cy + cam.halfH * g.alt + 0.02 * Math.sin(uu * 3 + pass) - uu * 0.03;
        for (let m = 0; m < g.n; m++) {
          const r = Math.ceil(m / 2), side = m === 0 ? 0 : (m % 2 ? 1 : -1);
          const jx = sp * 0.16 * Math.sin(t * 0.7 + m * 1.9 + pass), jy = sp * 0.12 * Math.sin(t * 0.9 + m * 2.7);
          const ds = 1 + side * r * 0.04;
          const x = lx + r * sp * 0.95 + side * r * sp * 0.22 + jx;
          const y = ly + side * r * sp * 0.36 + r * sp * 0.05 + jy;
          const pal = mixPal(PAL.goose, [env.paper, env.paper, env.paper, env.paper], clamp(g.haze + (1 - ds) * 1.5, 0, 0.75));
          // a wave of wingbeats runs back along each arm; now and then one glides
          const ph = fract(t * 2.5 * (1 + 0.04 * hash(m + pass)) - r * 0.09 + hash(m * 7.1 + pass) * 0.3);
          const gl = smooth(0.8, 0.86, fract(t * 0.11 + hash(m * 3.3 + pass))) * (1 - smooth(0.94, 1, fract(t * 0.11 + hash(m * 3.3 + pass))));
          const fade = on * smooth(0, 0.04, uu) * (1 - smooth(1.15, 1.25, uu));
          flyer(L, {
            x, y, dir: -1, yaw: 0.28, pitch: 0.03 * Math.sin(t * 1.3 + m), size: size * ds, pal, kind: 'goose', body: C.GOOSE,
            phase: ph, mode: { flap: 1 - gl, glide: gl, fold: 0, flare: 0 }, elev: 0.42, alpha: fade,
          });
        }
      }
    }

    // up the trunk, out along the limb, a snack, and back — in bounds
    function squirrel(L, t, tp, alpha) {
      const T = 15, u = t % T;
      const trunk = sites.trunk, limb = sites.limb;
      const climbTo = Math.min(sites.limbAttach, trunk.length - 1);
      const trunkAt = (f) => {
        const idx = f * climbTo, i = Math.min(climbTo - 1, Math.floor(idx)), k = idx - i;
        const a = trunk[i], b = trunk[i + 1];
        const [x, y] = tp(lerp(a.x, b.x, k), lerp(a.y, b.y, k), 0);
        return [x + lerp(a.r, b.r, k) * 0.55, y];
      };
      const limbAt = (f) => {
        const idx = f * (limb.length - 1), i = Math.min(limb.length - 2, Math.floor(idx)), k = idx - i;
        const a = limb[i], b = limb[i + 1];
        const [x, y] = tp(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.tb, b.tb, k));
        const r = lerp(a.r, b.r, k), ang = Math.atan2(b.y - a.y, b.x - a.x);
        return [x - Math.sin(ang) * r, y + Math.cos(ang) * r, ang];
      };
      const size = 0.062, pal = PAL.squirrel, pv = 206 / 256;
      // bounding gait: stretched in the air, gathered on landing
      const hopPh = fract(t * 4.2);
      const run = hopPh < 0.5 ? C.SQ_RUN_A : C.SQ_RUN_B;
      const lift = Math.sin(hopPh * Math.PI) * 0.0045;
      const onGround = (x) => { shadow(x, -0.012, 0.03, 0.005, 0.35 * alpha); };
      if (u < 2) {
        const f = u / 2, base = trunkAt(0), x = lerp(0.95, base[0] + 0.02, f);
        onGround(x);
        at(L, run, x, -0.012 + lift, 0.5, pv, 0, size, { pal, flip: -1, alpha });
      } else if (u < 4) {
        const [x, y] = trunkAt(smooth(0, 1, (u - 2) / 2));
        at(L, run, x + lift, y, 0.5, pv, Math.PI / 2, size, { pal, alpha });
      } else if (u < 5.6) {
        const [x, y, a] = limbAt(smooth(0, 1, (u - 4) / 1.6) * 0.92);
        at(L, run, x - Math.sin(a) * lift, y + Math.cos(a) * lift, 0.5, pv, a, size, { pal, alpha });
      } else if (u < 10) {
        const [x, y] = limbAt(0.92);
        const nib = Math.sin(t * 9) * 0.03 * (Math.sin(t * 0.9) > -0.3 ? 1 : 0);
        at(L, C.SQ_SIT, x, y, 0.5, pv, nib, size, { pal, alpha });
      } else if (u < 11.6) {
        const [x, y, a] = limbAt((1 - smooth(0, 1, (u - 10) / 1.6)) * 0.92);
        at(L, run, x - Math.sin(a) * lift, y + Math.cos(a) * lift, 0.5, pv, a, size, { pal, flip: -1, alpha });
      } else if (u < 13.2) {
        const [x, y] = trunkAt(1 - smooth(0, 1, (u - 11.6) / 1.6));
        at(L, run, x + lift, y, 0.5, pv, -Math.PI / 2, size, { pal, alpha });
      } else {
        const f = (u - 13.2) / 1.8, base = trunkAt(0), x = lerp(base[0] - 0.02, -1.0, f);
        onGround(x);
        at(L, run, x, -0.012 + lift, 0.5, pv, 0, size, { pal, flip: -1, alpha });
      }
    }

    // -------------------------------------------------------- loose things
    function looseKind(env, snowCover) {
      if (env.bloom > 0.3 && env.shed < 0.95) return 'petals';
      if (snowCover * (1 - smooth(0.2, 0.6, env.melt)) > 0.3) return 'snow';
      if (env.age > 0.5 && env.fall < 0.85 && env.bloom <= 0) return 'leaves';
      return null;
    }
    const PETAL_PAL = [hex('#e3a2b4'), hex('#fcf1f3'), hex('#ad3459'), hex('#d2a940')];
    function leafPal(env) {
      const aut = smooth(0.3, 0.8, env.autumn);
      const hue = Math.random();
      const warm = hue < 0.5 ? mixc(hex('#c4a04a'), hex('#b48b40'), hue * 2) : mixc(hex('#b48b40'), hex('#9a5533'), hue * 2 - 1);
      return [mixc(hex('#2c4a32'), warm, aut), mixc(hex('#8fb08f'), hex('#ecd29a'), aut), hex('#000000'), hex('#000000')];
    }
    function spawn(kind, x, y, vx, vy, env) {
      if (particles.length > 300) particles.splice(0, 1);
      const leafy = kind === 'leaves', snowy = kind === 'snow';
      particles.push({
        kind, cell: snowy ? C.PUFF : kind === 'petals' ? C.PETAL : C.LEAF,
        pal: snowy ? PAL.snow : kind === 'petals' ? PETAL_PAL : leafPal(env),
        x, y, vx, vy, ph: rr(0, 6.28), w: leafy ? rr(2.2, 3.4) : rr(2.8, 4.4),
        amp: leafy ? rr(0.05, 0.11) : rr(0.03, 0.07), vt: leafy ? rr(0.07, 0.11) : rr(0.04, 0.065),
        rot0: rr(0, 6.28), spin: rr(-1, 1) * (leafy ? 1.2 : 2.5), roll: rr(0, 6.28), rollV: rr(2, 6) * (Math.random() < 0.5 ? -1 : 1),
        size: snowy ? rr(0.02, 0.04) : kind === 'petals' ? rr(0.02, 0.028) : 0.03 * Math.max(env.S, 0.4),
        ground: rr(-0.075, 0.012), age: 0, landed: 0, life: rr(1.8, 3.4), a: 1,
      });
    }
    // falling-leaf flight: the leaf rocks like a pendulum, gliding sideways
    // and sinking fastest at the ends of each swing; moving air carries it
    function stepParticle(p, dt, env, hurry) {
      const T = dt * hurry;
      p.age += T;
      if (!p.landed) {
        const a = env.air(p.x, p.y);
        const drift = env.windAmp * 2.5 * (Math.sin(env.time * 0.7 + p.ph) * 0.6 + 0.5) + (hurry - 1) * 0.04;
        if (p.kind === 'snow' || p.kind === 'powder') {
          const heavy = p.kind === 'snow';
          p.vy = Math.max(p.vy - (heavy ? 1.0 : 0.25) * T, heavy ? -0.55 : -0.06);
          p.vx += (a[0] * 0.5 + drift - p.vx) * (1 - Math.exp(-T * (heavy ? 1.2 : 3)));
          if (heavy) {
            p.size *= 1 + 0.5 * T;
            p.a = Math.max(0, p.a - T * 0.55);
            if (Math.random() < T * 18) particles.push({ kind: 'powder', cell: C.DOT, pal: PAL.snow, x: p.x + rr(-1, 1) * p.size * 0.3, y: p.y, vx: p.vx * 0.5, vy: p.vy * 0.2, size: rr(0.003, 0.006), ground: p.ground, age: 0, landed: 0, life: 0.5, a: 0.9, rot0: 0, spin: 0, ph: 0, roll: 0, rollV: 0 });
          } else p.a = Math.max(0, p.a - T * 0.4);
          if (p.a <= 0) return false;
        } else {
          p.ph += p.w * T;
          const sw = Math.sin(p.ph);
          const tx = p.amp * Math.cos(p.ph) + a[0] * 0.8 + drift;
          const ty = -p.vt * (0.5 + 0.9 * sw * sw) * (p.age < 0.4 ? p.age / 0.4 : 1) + a[1] * 0.6;
          p.vx += (tx - p.vx) * (1 - Math.exp(-T * 4));
          p.vy += (ty - p.vy) * (1 - Math.exp(-T * 3));
          p.roll += p.rollV * T;
        }
        p.x += p.vx * T; p.y += p.vy * T;
        if (p.y <= p.ground) { p.y = p.ground; p.landed = 1e-4; }
      } else {
        p.landed += T;
        if (p.kind === 'snow' || p.kind === 'powder') return p.landed < 0.25;
      }
      return !(p.landed && p.landed > p.life);
    }
    function drawParticle(L, p, night) {
      if (p.kind === 'snow' || p.kind === 'powder') {
        const a = p.a * (p.landed ? 1 - p.landed / 0.25 : 1);
        emit(L, p.cell, p.x, p.y, 0, p.size, { pal: p.pal, alpha: a, grain: 0.4 });
        return;
      }
      const fadeOut = p.landed ? 1 - smooth(p.life * 0.55, p.life, p.landed) : 1;
      const rock = Math.sin(p.ph) * 0.6;
      const rot = p.rot0 + rock + p.spin * Math.min(p.age, 6);
      const cr = Math.cos(p.roll);
      const underside = cr < 0;
      const pl = underside ? [p.pal[1], p.pal[1], p.pal[2], p.pal[3]].map((c, i) => (i === 0 ? mixc(p.pal[0], p.pal[1], 0.45) : c)) : p.pal;
      emit(L, p.cell, p.x, p.y, p.landed ? p.rot0 : rot, p.size, {
        pal: pl, alpha: fadeOut, sy: p.landed ? 0.42 : 1,
        aspect: p.landed ? 1 : 0.18 + 0.82 * Math.abs(cr), flip: cr < 0 ? -1 : 1,
      });
      void night;
    }

    // A click shakes the tree: whatever it is holding comes loose, and every
    // bird in it takes off, each its own way.
    function shake(env) {
      startle = { t: env.time, x: env.clickX == null ? 0 : env.clickX, y: env.clickY || 0, used: false };
      const snowCover = smooth(0.25, 0.6, env.snow) * (1 - smooth(0.3, 0.9, env.thaw));
      const kind = looseKind(env, snowCover);
      if (!kind || !crownSpots.length) return kind;
      const count = kind === 'petals' ? 44 : kind === 'snow' ? 16 : Math.round(lerp(6, 26, smooth(0.3, 0.8, env.autumn)));
      const dir = Math.sign(-(env.clickX || 0)) || 1;
      for (let i = 0; i < count; i++) {
        const sp = crownSpots[Math.floor(Math.random() * crownSpots.length)];
        spawn(kind, sp[0] * env.S, sp[1] * env.S, dir * rr(0.02, 0.12), rr(-0.02, 0.05), env);
        const p = particles[particles.length - 1];
        p.age = -rr(0, 0.25);
      }
      return kind;
    }

    // for poking at things while developing
    function debug(k, v) { if (k === 'flock') flockClock = v; if (k === 'startle') startle = { t: lastT, x: v || 0, y: 0, used: false }; }

    return { update, shake, debug, layers, MAX, FLOATS };
  }

  global.TreeActors = { buildAtlas, create, CELLS: C, COLS, ROWS, FLOATS };
})(typeof window !== 'undefined' ? window : globalThis);
