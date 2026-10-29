/*
 * air.js — the air around the tree, simulated on a coarse grid.
 *
 * A moving cursor drags the air under it; that air keeps drifting the way it
 * was pushed and slowly calms. Only the light stuff answers it: leaves and
 * thin twigs are damped springs driven by the moving air, so they bend with
 * a push, overshoot and settle, while the trunk and limbs stay put. A click
 * doesn't push at all — it rustles: every twig shivers in its own direction
 * for a moment and the leaves rattle. Everything is measured in tree heights
 * so the field stays attached to the tree while the camera zooms.
 *
 * The shaders read two small float textures from here, plus `rustle`:
 *   texD: twig sway (xy), in tree heights
 *   texU: air velocity (xy), air speed (z) and twig speed (w), per second
 */
(function (global) {
  'use strict';

  const NX = 48, NY = 30;
  const X0 = -1.6, Y0 = -0.25, W = 3.2, H = 1.7;      // grid extent, in tree heights
  const DX = W / NX, DY = H / NY;
  const W2 = 7.5, Z2 = 0.17, K2 = 0.6;                 // twigs: light and quick
  const LIM = 0.035;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function create() {
    const N = NX * NY;
    const ux = new Float32Array(N), uy = new Float32Array(N);
    const tx = new Float32Array(N), ty = new Float32Array(N);
    const dx = new Float32Array(N), dy = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
    const jitter = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const f = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      jitter[i] = 0.65 + 0.7 * (f < 0 ? f + 1 : f);
    }
    const texD = new Float32Array(N * 4), texU = new Float32Array(N * 4);
    let energy = 0, rustle = 0, quiet = true;

    // bilinear sample of a grid array at tree-height coordinates (texel centres)
    function sample(a, gx, gy) {
      let fx = (gx - X0) / DX - 0.5, fy = (gy - Y0) / DY - 0.5;
      fx = clamp(fx, 0, NX - 1.001); fy = clamp(fy, 0, NY - 1.001);
      const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
      const k = j * NX + i;
      return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + NX] * (1 - u) + a[k + NX + 1] * u) * v;
    }

    // cur: { x, y, vx, vy } in tree heights (and per second), or null
    function step(dt, cur) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.05);
      rustle *= Math.exp(-dt * 1.9);
      if (rustle < 1e-3) rustle = 0;

      // 1. the cursor drags the air under it along
      if (cur) {
        const sp = Math.hypot(cur.vx, cur.vy);
        if (sp > 0.02) {
          const lim = 2.6, s = sp > lim ? lim / sp : 1;
          const cvx = cur.vx * s, cvy = cur.vy * s;
          const r = 0.1, r2 = r * r;
          const k = 1 - Math.exp(-dt * 16);
          const i0 = Math.max(0, Math.floor((cur.x - 3 * r - X0) / DX)), i1 = Math.min(NX - 1, Math.ceil((cur.x + 3 * r - X0) / DX));
          const j0 = Math.max(0, Math.floor((cur.y - 3 * r - Y0) / DY)), j1 = Math.min(NY - 1, Math.ceil((cur.y + 3 * r - Y0) / DY));
          for (let j = j0; j <= j1; j++) {
            const cy = Y0 + (j + 0.5) * DY - cur.y;
            for (let i = i0; i <= i1; i++) {
              const cx = X0 + (i + 0.5) * DX - cur.x;
              const w = Math.exp(-(cx * cx + cy * cy) / r2) * k;
              if (w < 1e-3) continue;
              const q = j * NX + i;
              ux[q] += (cvx - ux[q]) * w;
              uy[q] += (cvy * 0.6 - uy[q]) * w;
            }
          }
          quiet = false;
        }
      }

      // 2. the air carries on the way it was moving, and calms
      if (!quiet) {
        const decay = Math.exp(-dt * 1.25);
        for (let j = 0; j < NY; j++) {
          for (let i = 0; i < NX; i++) {
            const q = j * NX + i;
            const sx = X0 + (i + 0.5) * DX - ux[q] * dt * 0.6;
            const sy = Y0 + (j + 0.5) * DY - uy[q] * dt * 0.6;
            tx[q] = sample(ux, sx, sy) * decay;
            ty[q] = sample(uy, sx, sy) * decay;
          }
        }
        for (let i = 0; i < N; i++) { ux[i] = tx[i]; uy[i] = ty[i]; }
        for (let i = 0; i < NX; i++) { ux[i] = uy[i] = ux[N - 1 - i] = uy[N - 1 - i] = 0; }
        for (let j = 0; j < NY; j++) { const a = j * NX, b = a + NX - 1; ux[a] = uy[a] = ux[b] = uy[b] = 0; }
      }

      // 3. twigs: springs driven by the air (semi-implicit Euler, sub-stepped)
      const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
      const c2 = 2 * Z2 * W2, k2 = W2 * W2;
      let e = rustle;
      for (let q = 0; q < N; q++) {
        let ax = dx[q], ay = dy[q], bx = vx[q], by = vy[q];
        const fx = K2 * ux[q] * jitter[q], fy = K2 * uy[q] * 0.5 * jitter[q];
        for (let s = 0; s < n; s++) {
          bx += (fx - k2 * ax - c2 * bx) * h; ax += bx * h;
          by += (fy - k2 * ay - c2 * by) * h; ay += by * h;
        }
        dx[q] = ax; dy[q] = ay; vx[q] = bx; vy[q] = by;
        const sp = Math.hypot(ux[q], uy[q]), ts = Math.hypot(bx, by);
        e = Math.max(e, sp, ts * 3);
        const o = q * 4;
        texD[o] = LIM * Math.tanh(ax / LIM);
        texD[o + 1] = LIM * Math.tanh(ay / LIM);
        texU[o] = ux[q]; texU[o + 1] = uy[q]; texU[o + 2] = sp; texU[o + 3] = ts;
      }
      energy = e;
      if (e < 2e-4 && !cur) quiet = true;
    }

    // A click: no push, just a rustle — each patch of twigs is knocked a
    // different way and the whole crown shivers for a moment.
    function shake(s) {
      rustle = Math.min(1.4, rustle + s);
      for (let q = 0; q < N; q++) {
        const a = Math.random() * Math.PI * 2, m = 0.1 * s * jitter[q];
        vx[q] += Math.cos(a) * m;
        vy[q] += Math.sin(a) * m * 0.6;
      }
      quiet = false;
    }

    // twig sway at a point (tree heights in, tree heights out)
    function swayAt(gx, gy) {
      return [LIM * Math.tanh(sample(dx, gx, gy) / LIM), LIM * Math.tanh(sample(dy, gx, gy) / LIM)];
    }
    function airAt(gx, gy) { return [sample(ux, gx, gy), sample(uy, gx, gy)]; }

    return {
      step, shake, swayAt, airAt, texD, texU, NX, NY,
      map: [X0, Y0, 1 / W, 1 / H],
      get energy() { return energy; },
      get rustle() { return rustle; },
    };
  }

  global.TreeAir = { create };
})(typeof window !== 'undefined' ? window : globalThis);
