/*
 * tree.js — deterministic procedural tree.
 *
 * Builds the full-grown structure once (branch polylines, pipe-model radii,
 * growth timing, leaves) and packs it into GPU-ready typed arrays. Every
 * stage of the lifecycle is then just a function of `age` evaluated in the
 * shaders, so scrubbing back and forth is free.
 *
 * World units: ground at y = 0, mature crown top at y ≈ 1.
 * Angles: 0 = straight up, positive = clockwise (towards +x).
 */
(function (global) {
  'use strict';

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

  const CROWN = { cx: 0.0, cy: 0.6, rx: 0.7, ry: 0.46 };
  const STEP = [0.005, 0.0055, 0.006, 0.007, 0.008, 0.009]; // polyline sampling distance per depth
  const R_TIP = 0.00085;      // radius of a growing tip / finest twig
  const TRUNK_R = 0.046;      // target final trunk radius (before flare)
  const MAX_DEPTH = 5;
  const MIN_SPAWN_LEN = 0.028;

  // Indexed by branch depth (0 = trunk, 1 = main limbs, ...).
  const P = {
    latSpacing: [0, 0.07, 0.046, 0.033, 0.026, 0.02],
    latRatio:   [0, 0.62, 0.62, 0.64, 0.66, 0.70, 0.70],
    tipRatio:   [0, 0.58, 0.62, 0.64, 0.66, 0.70, 0.70],
    latSpread:  [0, 0.72, 0.78, 0.82, 0.88, 0.92, 0.95],
    forkSpread: [0, 0.34, 0.38, 0.42, 0.48, 0.52, 0.55],
    wigAmp:     [0.9, 2.6, 3.4, 4.2, 5.0, 5.5, 6.0],   // curvature std (rad / unit length)
    wigLen:     [0.14, 0.12, 0.08, 0.05, 0.035, 0.025, 0.02], // curvature correlation length
    tropism:    [6.0, 2.2, 2.6, 3.2, 3.8, 4.0, 4.0],   // pull towards target angle per unit length
    tropKeep:   [0, 0.5, 0.62, 0.72, 0.80, 0.85, 0.9], // target = start angle * keep (bends upward)
  };

  function generate(seed) {
    const R = mulberry32(seed);
    const rnd = (a, b) => a + (b - a) * R();
    const gauss = () => {
      let u = 0;
      while (u === 0) u = R();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R());
    };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const env = (x, y) => {
      const dx = (x - CROWN.cx) / CROWN.rx, dy = (y - CROWN.cy) / CROWN.ry;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const branches = [];

    function grow(o) {
      const d = o.depth;
      const b = {
        id: branches.length, depth: d, parent: o.parent, attachIdx: o.attachIdx, t0: o.t0,
        x: [o.x], y: [o.y], a: [o.a], children: [], rand: R(),
      };
      branches.push(b);
      const n = Math.max(3, Math.round(o.len / STEP[d]));
      const step = o.len / n;
      const damp = Math.exp(-step / P.wigLen[d]);
      const kick = P.wigAmp[d] * Math.sqrt(1 - damp * damp);
      const lim = 1 + o.slack;
      let x = o.x, y = o.y, a = o.a, k = gauss() * P.wigAmp[d] * 0.5;
      for (let i = 1; i <= n; i++) {
        k = k * damp + gauss() * kick;
        a += k * step;
        a += (o.target - a) * Math.min(1, P.tropism[d] * step);
        x += Math.sin(a) * step;
        y += Math.cos(a) * step;
        b.x.push(x); b.y.push(y); b.a.push(a);
        if (d > 0 && i > 2 && env(x, y) > lim) break;
      }
      b.step = step;
      b.len = (b.x.length - 1) * step;
      if (o.parent) o.parent.children.push(b);
      return b;
    }

    function child(parent, idx, a, len) {
      const d = parent.depth + 1;
      const x = parent.x[idx], y = parent.y[idx];
      if (parent.depth > 0 && env(x, y) > 1.04) return null;
      const b = grow({
        x, y, a, len, depth: d, parent, attachIdx: idx,
        t0: parent.t0 + idx * parent.step + rnd(0.012, 0.035),
        target: a * P.tropKeep[d], slack: rnd(-0.02, 0.07),
      });
      spawn(b);
      return b;
    }

    function spawn(b) {
      const d = b.depth;
      if (d >= MAX_DEPTH || b.len < MIN_SPAWN_LEN) return;
      const n = b.x.length, L = b.len;

      // lateral shoots
      let s = L * rnd(0.16, 0.3);
      let side = R() < 0.5 ? -1 : 1;
      while (s < L * 0.86) {
        const idx = Math.min(n - 2, Math.round(s / b.step));
        const ca = clamp(b.a[idx] + side * P.latSpread[d] * rnd(0.7, 1.2), -1.95, 1.95);
        const len = L * P.latRatio[d] * (1 - 0.4 * (s / L)) * rnd(0.75, 1.15);
        child(b, idx, ca, len);
        s += P.latSpacing[d] * rnd(0.75, 1.3);
        side = R() < 0.8 ? -side : side;
      }

      // terminal fork
      const ea = b.a[n - 1], f = P.forkSpread[d], tl = L * P.tipRatio[d];
      const r = R();
      if (d <= 2 && r < 0.2) {
        child(b, n - 1, ea - f * rnd(0.8, 1.2), tl * rnd(0.8, 1.05));
        child(b, n - 1, ea + rnd(-0.15, 0.15), tl * rnd(0.9, 1.15));
        child(b, n - 1, ea + f * rnd(0.8, 1.2), tl * rnd(0.8, 1.05));
      } else if (r < 0.9) {
        const sd = R() < 0.5 ? -1 : 1;
        child(b, n - 1, ea + sd * f * rnd(0.2, 0.6), tl * rnd(0.95, 1.15));
        child(b, n - 1, ea - sd * f * rnd(0.8, 1.3), tl * rnd(0.7, 0.95));
      } else {
        child(b, n - 1, ea + gauss() * 0.15, tl * rnd(1.0, 1.2));
      }
    }

    // ---- trunk and main limbs -------------------------------------------
    const trunk = grow({
      x: 0, y: 0, a: rnd(-0.04, 0.04), len: 0.25, depth: 0, parent: null,
      attachIdx: 0, t0: 0, target: 0, slack: 0,
    });
    const tn = trunk.x.length;
    const limbs = [
      { s: 0.70, a: -1.05, len: 0.50 },
      { s: 0.84, a: 0.98, len: 0.46 },
      { s: 1.0, a: -0.48, len: 0.56 },
      { s: 1.0, a: 0.06, len: 0.64 },
      { s: 1.0, a: 0.60, len: 0.54 },
    ];
    for (const l of limbs) {
      const idx = Math.min(tn - 1, Math.round(l.s * (tn - 1)));
      child(trunk, idx, l.a + rnd(-0.08, 0.08), l.len * rnd(0.92, 1.06));
    }

    // ---- timing: growth front arrival, normalised to [0, 1] --------------
    let T = 0;
    for (const b of branches) T = Math.max(T, b.t0 + b.len);
    const warp = (t) => Math.pow(t / T, 0.92);
    for (const b of branches) {
      b.tb = b.x.map((_, i) => warp(b.t0 + i * b.step));
    }

    // ---- radii: pipe model (r^2 conserved across junctions) --------------
    for (let i = branches.length - 1; i >= 0; i--) {
      const b = branches[i];
      const n = b.x.length;
      const r2 = new Float64Array(n).fill(R_TIP * R_TIP);
      for (const c of b.children) {
        const rb = c.r[0] * c.r[0];
        for (let k = 0; k <= Math.min(c.attachIdx, n - 1); k++) r2[k] += rb;
      }
      b.r = Array.from(r2, Math.sqrt);
    }
    // remap so the trunk lands on TRUNK_R while twigs stay at R_TIP
    const gam = Math.log(TRUNK_R / R_TIP) / Math.log(trunk.r[0] / R_TIP);
    for (const b of branches) {
      b.r = b.r.map((r) => R_TIP * Math.pow(r / R_TIP, gam));
      // short smoothing pass to soften the steps at each junction
      const sm = b.r.slice();
      for (let k = 1; k < sm.length - 1; k++) sm[k] = (b.r[k - 1] + 2 * b.r[k] + b.r[k + 1]) / 4;
      b.r = sm;
    }
    // root flare
    for (let k = 0; k < trunk.r.length; k++) {
      const s = k * trunk.step;
      trunk.r[k] *= 1 + 0.75 * Math.exp(-s / 0.022) + 0.12 * Math.exp(-s / 0.08);
    }

    // ---- leaves ---------------------------------------------------------
    const leaves = [];
    const tbl = Array.from({ length: 1024 }, R);
    const hn = (i, j) => tbl[((i * 73856093) ^ (j * 19349663)) & 1023];
    const vnoise = (x, y) => {
      const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const a = hn(i, j) + (hn(i + 1, j) - hn(i, j)) * ux;
      const b = hn(i, j + 1) + (hn(i + 1, j + 1) - hn(i, j + 1)) * ux;
      return a + (b - a) * uy;
    };
    const LIGHT = norm3([-0.5, 0.62, 0.6]);
    function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

    function addLeaf(b, s, rel, kind, size, clusterShade) {
      const idx = Math.min(b.x.length - 1, Math.max(0, Math.round(s / b.step)));
      const x = b.x[idx], y = b.y[idx];
      let ang = b.a[idx] + rel;
      ang = clamp(ang, -2.3, 2.3);
      const tb = b.tb[idx];
      const birth = tb + rnd(0.004, 0.02);
      let shed = 99;
      if (kind === 0) {
        shed = birth + rnd(0.09, 0.17);
        if (shed > 0.97) { shed = 99; kind = 1; }
      }
      const ex = (x - CROWN.cx) / CROWN.rx, ey = (y - CROWN.cy) / CROWN.ry;
      const rr = Math.min(1, Math.hypot(ex, ey));
      const zmax = Math.sqrt(Math.max(0.04, 1 - rr * rr));
      const z = (R() * 2 - 1) * zmax;
      const nn = norm3([ex, ey, z + 0.0001]);
      const nd = nn[0] * LIGHT[0] + nn[1] * LIGHT[1] + nn[2] * LIGHT[2];
      // clumpy light: big soft masses of light and shadow, darker deep inside
      const clump = vnoise(x * 13 + 3.1, y * 13) * 0.6 + vnoise(x * 30, y * 30 + 7.7) * 0.4;
      const shade = clamp(0.46 + 0.36 * nd + 0.12 * z + (clump - 0.5) * 0.65 + clusterShade
        - (1 - rr) * 0.1 + rnd(-0.07, 0.07), 0, 1);
      const fallT = clamp(R() * 0.86 + (1 - rr) * 0.03 + (y > 0.8 ? -0.03 : 0), 0, 0.9);
      const landX = clamp(x * 0.8 + rnd(-0.12, 0.32), -0.85, 1.0);
      const landY = -z * 0.04 + rnd(-0.008, 0.008) - 0.004;
      const landA = (R() < 0.5 ? -1 : 1) * rnd(1.1, 1.9);
      const autOff = clamp(fallT * 0.55 + rnd(0, 0.3), 0, 0.62);
      leaves.push([x, y, ang, size, birth, shed, fallT, shade, z, R(), Math.floor(R() * 5), landX, landY, landA, kind, autOff]);
    }

    for (const b of branches) {
      const cs = rnd(-0.08, 0.08);
      if (b.children.length === 0) {
        let s = b.len * rnd(0.12, 0.3), side = R() < 0.5 ? -1 : 1;
        while (s < b.len - 0.004) {
          addLeaf(b, s, side * rnd(0.55, 1.05), 1, rnd(0.022, 0.034), cs);
          s += rnd(0.011, 0.017);
          side = -side;
        }
        const m = 2 + (R() < 0.6 ? 1 : 0) + (R() < 0.3 ? 1 : 0);
        for (let j = 0; j < m; j++) {
          const u = m === 1 ? 0 : j / (m - 1) * 2 - 1;
          addLeaf(b, b.len, u * 0.62 + rnd(-0.12, 0.12), 1, rnd(0.024, 0.036), cs);
        }
      } else {
        // temporary leaves on young growth, shed as the wood matures
        let s = b.depth === 0 ? 0.06 : rnd(0.01, 0.03), side = R() < 0.5 ? -1 : 1;
        const sp = b.depth === 0 ? 0.022 : 0.03;
        while (s < b.len) {
          addLeaf(b, s, side * rnd(0.6, 1.0), 0, rnd(0.032, 0.048), cs);
          s += sp * rnd(0.8, 1.2);
          side = -side;
        }
      }
    }

    // cotyledons (seed leaves) low on the stem
    const cotS = 0.05;
    for (const sd of [-1, 1]) {
      const idx = Math.round(cotS / trunk.step);
      const tb = trunk.tb[idx];
      leaves.push([trunk.x[idx], trunk.y[idx], sd * 1.2, 0.016, tb + 0.002, 0.12, 0, 0.75, 0.6 + sd * 0.1, R(), 5, 0, 0, 0, 2, 0]);
    }
    // seed coat halves
    for (const sd of [-1, 1]) {
      leaves.push([0, -0.0012, sd, 0.016, -1, 99, 0, 0.5, 5, R(), sd < 0 ? 6 : 7, 0, 0, 0, 3, 0]);
    }

    leaves.sort((p, q) => p[8] - q[8]);
    let split = leaves.findIndex((l) => l[8] >= 0);
    if (split < 0) split = leaves.length;
    const leafData = new Float32Array(leaves.length * 16);
    leaves.forEach((l, i) => leafData.set(l, i * 16));

    // ---- cherry blossom --------------------------------------------------
    // Clusters sit on spurs along the finer wood (they open before the new
    // leaves). Petals for the shower each start from a random cluster.
    const blossoms = [];
    function addBlossom(b, s, rel, size) {
      const idx = Math.min(b.x.length - 1, Math.max(0, Math.round(s / b.step)));
      const x = b.x[idx], y = b.y[idx];
      const ex = (x - CROWN.cx) / CROWN.rx, ey = (y - CROWN.cy) / CROWN.ry;
      const rr = Math.min(1, Math.hypot(ex, ey));
      const z = (R() * 2 - 1) * Math.sqrt(Math.max(0.04, 1 - rr * rr));
      const nn = norm3([ex, ey, z + 0.0001]);
      const nd = nn[0] * LIGHT[0] + nn[1] * LIGHT[1] + nn[2] * LIGHT[2];
      const clump = vnoise(x * 11 + 9.1, y * 11);
      const shade = clamp(0.52 + 0.3 * nd + 0.12 * z + (clump - 0.5) * 0.4 + rnd(-0.08, 0.08), 0, 1);
      const bloomT = clamp(rnd(0, 0.5) + (1 - rr) * 0.08 - (y > 0.75 ? 0.04 : 0), 0, 0.62);
      const v = R();
      blossoms.push([x, y, clamp(b.a[idx] + rel, -2.4, 2.4), size,
        bloomT, rnd(0, 1.35), shade, z, R(), v < 0.45 ? 0 : v < 0.8 ? 1 : 2, 0, 0]);
    }
    for (const b of branches) {
      if (b.depth < 3) continue;
      let s = b.len * rnd(0.1, 0.3), side = R() < 0.5 ? -1 : 1;
      while (s < b.len) {
        addBlossom(b, s, side * rnd(0.35, 1.25), rnd(0.022, 0.032));
        s += rnd(0.016, 0.028);
        side = -side;
      }
      if (b.children.length === 0) addBlossom(b, b.len, rnd(-0.5, 0.5), rnd(0.024, 0.034));
    }
    blossoms.sort((p, q2) => p[7] - q2[7]);
    let blossomSplit = blossoms.findIndex((l) => l[7] >= 0);
    if (blossomSplit < 0) blossomSplit = blossoms.length;
    const blossomData = new Float32Array(blossoms.length * 12);
    blossoms.forEach((l, i) => blossomData.set(l, i * 12));

    // petals: x0, y0, size, rand | period, phase, drift, swirl | landY, spin, gate, shade
    const PETALS = 3200;
    const petals = [];
    for (let i = 0; i < PETALS; i++) {
      const bl = blossoms[Math.floor(R() * blossoms.length)];
      petals.push([bl[0] + rnd(-0.006, 0.006), bl[1] + rnd(-0.006, 0.006), rnd(0.016, 0.026), R(),
        rnd(10, 17), R(), rnd(-0.12, 0.55), rnd(0.012, 0.05),
        rnd(-0.045, 0.045), rnd(-1.6, 1.6), R(), rnd(0.4, 1)]);
    }
    petals.sort((p, q2) => q2[8] - p[8]);   // far side of the ground first
    let petalSplit = petals.findIndex((l) => l[8] <= 0);
    if (petalSplit < 0) petalSplit = petals.length;
    const petalData = new Float32Array(petals.length * 12);
    petals.forEach((l, i) => petalData.set(l, i * 12));

    // ---- branch mesh ----------------------------------------------------
    let segCount = 0;
    for (const b of branches) segCount += b.x.length - 1 + 1; // segments + end cap
    const FL = 20;
    const vdata = new Float32Array(segCount * 4 * FL);
    const idata = new Uint32Array(segCount * 6);
    let v = 0, q = 0;
    const maxDepth = MAX_DEPTH;
    function quad(verts) {
      const base = v;
      for (const vv of verts) { vdata.set(vv, v * FL); v++; }
      idata.set([base, base + 1, base + 2, base + 2, base + 1, base + 3], q);
      q += 6;
    }
    for (const b of branches) {
      const n = b.x.length;
      const nx = (i) => Math.cos(b.a[i]), ny = (i) => -Math.sin(b.a[i]);
      const dn = b.depth / maxDepth;
      for (let i = 0; i < n - 1; i++) {
        const common = [b.x[i], b.y[i], b.x[i + 1], b.y[i + 1], nx(i), ny(i), nx(i + 1), ny(i + 1),
          i * b.step, (i + 1) * b.step, b.r[i], b.r[i + 1]];
        const t = [b.tb[i], b.tb[i + 1]];
        quad([
          [...common, ...t, 0, -1, 0, dn, b.rand, 0],
          [...common, ...t, 0, 1, 0, dn, b.rand, 0],
          [...common, ...t, 1, -1, 0, dn, b.rand, 0],
          [...common, ...t, 1, 1, 0, dn, b.rand, 0],
        ]);
      }
      // round cap at the branch end (hides fork corners, rounds tips)
      const e = n - 1;
      const tx = Math.sin(b.a[e]), ty = Math.cos(b.a[e]);
      const capCommon = [b.x[e], b.y[e], b.x[e], b.y[e], nx(e), ny(e), tx, ty, e * b.step, e * b.step, b.r[e], b.r[e], b.tb[e], b.tb[e]];
      quad([
        [...capCommon, -1, -1, 1, dn, b.rand, 0],
        [...capCommon, 1, -1, 1, dn, b.rand, 0],
        [...capCommon, -1, 1, 1, dn, b.rand, 0],
        [...capCommon, 1, 1, 1, dn, b.rand, 0],
      ]);
    }

    // ---- sites for the creatures and people that use the tree ----------
    // (deterministic picks from the finished structure; no RNG draws here)
    const pt = (b, i) => ({ x: b.x[i], y: b.y[i], a: b.a[i], r: b.r[i], tb: b.tb[i] });
    const horiz = (a) => Math.abs(Math.sin(a));          // 1 = horizontal wood
    const low = [];                                       // wood in the bottom of the crown
    for (const b of branches) {
      if (b === trunk) continue;
      for (let i = 0; i < b.x.length; i += 2) if (b.y[i] < 0.5) low.push(b.x[i], b.y[i]);
    }
    const clearBelow = (x, y, w) => {                     // open air under a point?
      let hits = 0;
      for (let k = 0; k < low.length; k += 2) {
        if (Math.abs(low[k] - x) < w && low[k + 1] < y - 0.03 && low[k + 1] > 0.02) hits++;
      }
      return hits;
    };

    // swing: a low, near-horizontal, sturdy stretch of a main limb
    let swing = null, best = -1e9;
    for (const b of branches) {
      if (b.depth < 1 || b.depth > 2) continue;
      for (let i = 2; i < b.x.length - 2; i += 2) {
        const x = b.x[i], y = b.y[i];
        if (y < 0.24 || y > 0.46 || Math.abs(x) < 0.2 || Math.abs(x) > 0.55) continue;
        if (horiz(b.a[i]) < 0.6 || b.r[i] < 0.006) continue;
        const score = horiz(b.a[i]) * 2 + b.r[i] * 40 - Math.abs(y - 0.33) * 4 - clearBelow(x, y, 0.06) * 0.5;
        if (score > best) { best = score; swing = { ...pt(b, i), branch: b.id }; }
      }
    }

    // nest: an upward-opening fork in the lower front of the crown
    let nest = null; best = -1e9;
    for (const b of branches) {
      if (b.depth < 2 || b.depth > 3 || !b.parent) continue;
      const x = b.x[0], y = b.y[0];
      if (y < 0.42 || y > 0.66 || Math.abs(x) < 0.06 || Math.abs(x) > 0.38) continue;
      const pa = b.parent.a[Math.min(b.attachIdx, b.parent.a.length - 1)];
      if (Math.abs(pa) > 0.9 || Math.abs(b.a[0]) > 1.1) continue;
      const score = b.parent.r[Math.min(b.attachIdx, b.parent.r.length - 1)] * 60 - Math.abs(y - 0.52) * 3
        - Math.abs(Math.abs(x) - 0.2) * 2 + (swing && Math.sign(x) !== Math.sign(swing.x) ? 0.6 : 0);
      if (score > best) { best = score; nest = { x, y, r: b.parent.r[Math.min(b.attachIdx, b.parent.r.length - 1)], tb: b.tb[0] }; }
    }

    // perches: near-horizontal wood across the crown (birds, the winter red bird)
    const perches = [];
    for (const b of branches) {
      if (b.depth < 2 || b.depth > 4) continue;
      for (let i = 3; i < b.x.length - 2; i += 5) {
        if (horiz(b.a[i]) < 0.75 || b.r[i] < 0.0018) continue;
        if (b.y[i] < 0.34 || b.y[i] > 0.98) continue;
        perches.push(pt(b, i));
      }
    }
    let redPerch = null; best = -1e9;
    for (const p of perches) {
      if (p.y > 0.62 || Math.abs(p.x) < 0.12 || Math.abs(p.x) > 0.5) continue;
      if (swing && Math.hypot(p.x - swing.x, p.y - swing.y) < 0.15) continue;
      if (nest && Math.hypot(p.x - nest.x, p.y - nest.y) < 0.16) continue;
      const score = horiz(p.a) * 2 + p.r * 120 - Math.abs(p.y - 0.48) * 3;
      if (score > best) { best = score; redPerch = p; }
    }

    // squirrel: up the trunk and out along the low limb on the other side
    const trunkPath = trunk.x.map((x, i) => ({ x, y: trunk.y[i], r: trunk.r[i], tb: trunk.tb[i] }));
    const lowLimbs = trunk.children.filter((c) => c.attachIdx < trunk.x.length - 1);
    const sqLimb = lowLimbs.find((c) => swing && Math.sign(c.x[c.x.length - 1]) !== Math.sign(swing.x)) || lowLimbs[0];
    const limbPath = [];
    if (sqLimb) {
      for (let i = 0; i < sqLimb.x.length; i++) {
        limbPath.push(pt(sqLimb, i));
        if (i > 6 && Math.hypot(sqLimb.x[i] - sqLimb.x[0], sqLimb.y[i] - sqLimb.y[0]) > 0.2) break;
      }
    }
    const sites = { swing, nest, perches, redPerch, trunk: trunkPath, limb: limbPath, limbAttach: sqLimb ? sqLimb.attachIdx : 0 };

    // ---- extents vs age (for the camera) ---------------------------------
    const pts = [];
    for (const b of branches) for (let i = 0; i < b.x.length; i += 2) pts.push([b.tb[i], b.x[i], b.y[i]]);
    pts.sort((p, q2) => p[0] - q2[0]);
    const N_EXT = 128;
    const ext = new Float32Array((N_EXT + 1) * 3); // minX, maxX, maxY (unscaled)
    let minX = 0, maxX = 0, maxY = 0, pi = 0;
    for (let k = 0; k <= N_EXT; k++) {
      const age = k / N_EXT;
      while (pi < pts.length && pts[pi][0] <= age) {
        minX = Math.min(minX, pts[pi][1]); maxX = Math.max(maxX, pts[pi][1]); maxY = Math.max(maxY, pts[pi][2]);
        pi++;
      }
      ext[k * 3] = minX; ext[k * 3 + 1] = maxX; ext[k * 3 + 2] = maxY;
    }

    return {
      branchCount: branches.length,
      twigCount: branches.filter((b) => b.children.length === 0).length,
      trunkRadius: trunk.r[Math.round(0.1 / trunk.step)],
      vdata, idata, vertexCount: v, indexCount: q, floatsPerVertex: FL,
      leafData, leafCount: leaves.length, leafSplit: split,
      blossomData, blossomCount: blossoms.length, blossomSplit,
      petalData, petalCount: petals.length, petalSplit,
      ext, nExt: N_EXT, crown: CROWN, rTip: R_TIP, sites,
    };
  }

  global.TreeGen = { generate, CROWN };
})(typeof window !== 'undefined' ? window : globalThis);
