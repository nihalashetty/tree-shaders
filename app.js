/*
 * app.js — WebGL2 renderer + scroll-driven lifecycle for the tree.
 *
 * Scroll position → smoothed progress P → lifecycle state (age, seasons)
 * → uniforms. All geometry is static; the shaders evaluate growth, sway,
 * colour and falling from those uniforms, so every frame is just a few
 * draw calls.
 */
(function () {
  'use strict';

  const SEED = 1234;

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ramp = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
  const smooth = (a, b, x) => { const t = ramp(x, a, b); return t * t * (3 - 2 * t); };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mixc = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

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

  const COLORS = {
    paper: hex('#f2f1ec'),
    paperAutumn: hex('#f4eee2'),
    paperWinter: hex('#eceff0'),
    ink: hex('#15321f'),
    barkLight: hex('#7d947f'),
    leafDark: hex('#0e2716'),
    leafLight: hex('#6f9576'),
    leafYoung: hex('#8db274'),
    olive: hex('#86864a'),
    gold: hex('#c4a04a'),
    ochre: hex('#b48b40'),
    rust: hex('#9a5533'),
    dead: hex('#7d6549'),
    seed: hex('#3a3220'),
    paperBloom: hex('#f5efee'),
    paperSnow: hex('#dde2e7'),
    snow: hex('#fafbfd'),
    snowShade: hex('#a9b5c2'),
    flakeRim: hex('#9eabb8'),
    petal: hex('#e3a2b4'),
    petalLight: hex('#fcf1f3'),
    bud: hex('#c25478'),
    accent: hex('#ad3459'),
    stamen: hex('#d2a940'),
    grass_fresh: hex('#6a9150'),
    grass_deep: hex('#3d5f37'),
    grass_straw: hex('#b49a5c'),
    grass_dead: hex('#857257'),
    grass_shoot: hex('#86b25e'),
  };

  // Scroll progress windows for each part of the lifecycle.
  const TL = {
    germ: [0.019, 0.057],
    grow: [0.057, 0.406],
    kid: [0.335, 0.405],       // summer days: a child on the swing, chicks in the nest
    dusk: [0.412, 0.426, 0.443, 0.458],   // midsummer night: in, hold, out
    autumn: [0.481, 0.561],
    fall: [0.514, 0.651],
    winter: [0.637, 0.689],    // bare wood; the leaf litter decays
    snowfall: [0.665, 0.774],  // flakes in the air
    snow: [0.684, 0.759],      // snow settles on branches and ground
    melt: [0.785, 0.823],      // branches shed their snow (twigs first)
    thaw: [0.797, 0.844],      // ground snow shrinks to patches and goes
    bloom: [0.83, 0.906],      // buds swell and open
    shower: 0.908,             // petals start to drift from here on
    shed: [0.92, 0.993],       // clusters thin out as they lose their petals
    spring: [0.934, 0.996],    // new leaves unfold
  };

  // ----------------------------------------------------------------- canvas
  const canvas = document.getElementById('scene');
  const gl = canvas.getContext('webgl2', {
    antialias: true, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, powerPreference: 'high-performance',
  });
  if (!gl) {
    document.documentElement.classList.add('no-webgl');
    return;
  }

  const tree = TreeGen.generate(SEED);

  // ---------------------------------------------------------------- shaders
  const COMMON = `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  // Jittered stipple dots: two offset sub-grids so no lattice shows through.
  float dotCell(vec2 q, float dens, float cellPx, float salt) {
    vec2 c = floor(q), f = fract(q);
    vec2 h = hash22(c + salt);
    vec2 ctr = 0.24 + 0.52 * hash22(c * 1.37 + salt + 19.19);
    float present = step(h.x, dens * 1.15);
    float rad = mix(0.15, 0.25, h.y) * (0.75 + 0.55 * dens);
    float aa = 0.8 / cellPx;
    return present * (1.0 - smoothstep(rad - aa, rad + aa, length(f - ctr)));
  }
  float dotLayer(vec2 q, float dens, float cellPx) {
    return max(dotCell(q, dens, cellPx, 0.0), dotCell(q + vec2(0.5, 0.37), dens, cellPx, 7.3));
  }
  // Stipple anchored in world space but with a constant on-screen dot size:
  // two power-of-two layers crossfaded by zoom level.
  float stipple(vec2 w, float ppw, float dens, float cellPx) {
    float lv = log2(cellPx / ppw);
    float l0 = floor(lv), f = lv - l0;
    float c0 = exp2(l0), c1 = c0 * 2.0;
    float a = dotLayer(w / c0, dens, ppw * c0);
    float b = dotLayer(w / c1 + 3.7, dens, ppw * c1);
    return mix(a, b, smoothstep(0.0, 1.0, f));
  }`;

  // Sway: a steady breeze (with a gust front rolling across now and then),
  // plus the air simulated in air.js. The cursor's air and a click's rustle
  // reach only the light outer wood and the leaves (twig weight), never the
  // trunk and limbs.
  const WIND = `
  uniform float u_time, u_windAmp, u_treeH, u_rustle;
  uniform sampler2D u_airD, u_airU;
  uniform vec4 u_airMap;     // tree-height coords -> uv: origin, 1/size
  vec2 airUV(vec2 p) { return (p / max(u_treeH, 0.02) - u_airMap.xy) * u_airMap.zw; }
  vec4 airU(vec2 p) { return textureLod(u_airU, airUV(p), 0.0); }
  // how much a point on the wood is a light, outer twig (continuous along the wood)
  float twigOf(float tb) { return smoothstep(0.45, 0.9, tb); }
  vec2 windAt(vec2 p, float twig) {
    float h = clamp(p.y / max(u_treeH, 0.02), 0.0, 1.6);
    float k = h * h * u_treeH;
    float t = u_time;
    float front = pow(0.5 + 0.5 * sin(t * 0.37 - p.x * 1.3 / max(u_treeH, 0.05)), 8.0);
    float w = sin(t * 0.73 + p.x * 1.4) * 0.55
            + sin(t * 1.61 + p.x * 3.3 + p.y * 1.9) * 0.3
            + sin(t * 3.1 + p.x * 7.0 - p.y * 5.0) * 0.15 * h
            + front * (0.6 + 0.4 * sin(t * 4.3 + p.y * 9.0) * twig);
    vec2 d = vec2(w, -0.2 * abs(w) * h) * k * u_windAmp;
    float hk = twig * smoothstep(0.08, 0.45, h);
    if (hk > 0.0) {
      vec4 a = textureLod(u_airD, airUV(p), 0.0);
      // a shake: every patch of twigs shivers on its own phase
      vec2 q = p / max(u_treeH, 0.05);
      float ph1 = 3.0 * sin(q.x * 37.0 + 1.3 * sin(q.y * 29.0)) + 2.0 * sin(q.y * 41.0 - q.x * 13.0);
      float ph2 = 3.0 * sin(q.y * 33.0 + 1.1 * sin(q.x * 31.0)) + 2.0 * sin(q.x * 43.0 + q.y * 17.0);
      vec2 shiver = vec2(sin(t * 21.0 + ph1), 0.7 * sin(t * 17.0 + ph2)) * u_rustle * 0.009;
      d += (a.xy + shiver) * hk * u_treeH;
    }
    return d;
  }
  vec2 windAt(vec2 p) { return windAt(p, 1.0); }`;

  const BG_VS = `#version 300 es
  out vec2 v_ndc;
  void main() {
    vec2 p = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
    v_ndc = p;
    gl_Position = vec4(p, 0.0, 1.0);
  }`;

  const BG_FS = `#version 300 es
  precision highp float;
  in vec2 v_ndc;
  uniform vec4 u_cam;        // cx, cy, halfW, halfH
  uniform vec2 u_res;
  uniform vec3 u_paper, u_ink;
  uniform vec4 u_ground;     // cx, rx, ry, strength
  uniform vec3 u_soil;       // trunk radius, soil amount, cell px
  uniform vec2 u_snowG;      // settled amount, thaw
  uniform vec3 u_snowCol, u_snowShade;
  out vec4 o;
  ${COMMON}
  void main() {
    vec2 w = u_cam.xy + v_ndc * u_cam.zw;
    float ppw = u_res.y / (2.0 * u_cam.w);
    vec3 col = u_paper;

    // paper: fine grain + soft mottling + vignette
    col += (hash12(gl_FragCoord.xy) - 0.5) * 0.022;
    col *= 1.0 - 0.03 * vnoise(gl_FragCoord.xy / 260.0);
    vec2 uv = gl_FragCoord.xy / u_res;
    col *= mix(0.9, 1.0, smoothstep(1.05, 0.25, length((uv - 0.5) * vec2(1.25, 1.0))));

    // ground: stippled shadow ellipse, contact shadow, horizon band, soil
    float ex = (w.x - u_ground.x) / u_ground.y;
    float ey = (w.y + u_ground.z * 0.25) / u_ground.z;
    float shadow = pow(clamp(1.0 - (ex * ex + ey * ey), 0.0, 1.0), 1.25) * u_ground.w;
    float rt = u_soil.x;
    float contact = exp(-(w.x * w.x) / (rt * rt * 7.0) - (w.y * w.y) / (rt * rt * 0.8)) * 0.85;
    float viewH = 2.0 * u_cam.w;
    float bandW = max(u_ground.y * 2.0, u_cam.z * 0.4);
    float band = exp(-pow(w.y / (viewH * 0.004), 2.0)) * exp(-pow((w.x - u_ground.x) / bandW, 2.0)) * 0.24;
    float soil = w.y < 0.0 ? u_soil.y * 0.075 * exp(w.y / (viewH * 0.05)) * (0.5 + 0.5 * vnoise(w * 900.0)) : 0.0;

    // snow blanket: settles in patches, thaws in patches
    float snow = 0.0, drift = 0.0, fleck = 0.0;
    if (u_snowG.x > 0.0 && w.y < 0.03) {
      float hz = 0.011 + 0.007 * vnoise(vec2(w.x * 6.0, 1.3)) + 0.003 * vnoise(vec2(w.x * 25.0, 7.1));
      float below = (hz - w.y) * ppw;                                   // px under the snow line
      float field = clamp(below + 0.5, 0.0, 1.0);
      float n1 = vnoise(w * 11.0) * 0.65 + vnoise(w * 37.0) * 0.35;
      float t1 = u_snowG.x * 1.2 - 0.1 - n1;
      float n2 = vnoise(w * 16.0 + 17.0) * 0.6 + vnoise(w * 48.0 + 3.0) * 0.4;
      float t2 = n2 - (u_snowG.y * 1.2 - 0.1);
      float c1 = clamp(t1 / max(fwidth(t1), 1e-5) + 0.5, 0.0, 1.0);
      float c2 = clamp(t2 / max(fwidth(t2), 1e-5) + 0.5, 0.0, 1.0);
      snow = field * c1 * c2;
      // ink gathers along the edges of the drifts and the snow line
      float edge = 1.0 - smoothstep(0.0, 0.035, abs(t1));
      float line = 1.0 - smoothstep(0.0, 2.5, abs(below));
      drift = field * edge * step(0.02, u_snowG.x) * c2 + line * c1 * c2 * step(0.0, below + 3.0);
      // slushy white flecks left behind around the thawing patches
      fleck = field * c1 * (1.0 - c2) * (1.0 - smoothstep(0.0, 0.14, -t2)) * (1.0 - u_snowG.y * 0.6);
    }
    float dens = clamp(shadow * (1.0 - 0.5 * snow) + contact + band * (1.0 - snow) + soil + drift * 0.42, 0.0, 0.95);
    float dots = dens > 0.002 ? stipple(w, ppw, dens, u_soil.z) : 0.0;
    col = mix(col, u_snowCol, snow);
    col = mix(col, u_snowShade, snow * shadow * 0.3);
    if (fleck > 0.0) col = mix(col, u_snowCol, stipple(w + 7.3, ppw, fleck * 0.85, u_soil.z * 1.3));
    col = mix(col, mix(u_ink, u_snowShade * 0.8, snow), dots * 0.92);
    o = vec4(col, 1.0);
  }`;

  const BRANCH_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec4 a_p;   // p0.xy, p1.xy
  layout(location = 1) in vec4 a_n;   // n0.xy, n1.xy   (caps: n.xy, t.xy)
  layout(location = 2) in vec4 a_sr;  // s0, s1, r0, r1 (final radii)
  layout(location = 3) in vec4 a_t;   // tb0, tb1, end, side   (caps: tb, tb, u, v)
  layout(location = 4) in vec4 a_x;   // kind (0 seg, 1 cap), depth, rand, -
  uniform vec4 u_cam;
  uniform float u_age, u_S, u_ppw, u_rTip, u_snow;
  ${WIND}
  out vec2 v_uv, v_n, v_t, v_bark;
  out float v_alpha, v_aw, v_r, v_ext;
  flat out float v_cap;
  void main() {
    bool cap = a_x.x > 0.5;
    float tb0 = a_t.x, tb1 = a_t.y;
    vec2 c, n, t, corner;
    float rf, tb, s;
    if (cap) {
      c = a_p.xy; n = a_n.xy; t = a_n.zw; rf = a_sr.z; tb = tb0; s = a_sr.x;
      corner = a_t.zw;
    } else {
      float g = clamp((u_age - tb0) / max(tb1 - tb0, 1e-6), 0.0, 1.0);
      float k = a_t.z * g;
      c = mix(a_p.xy, a_p.zw, k);
      n = normalize(mix(a_n.xy, a_n.zw, k));
      t = vec2(-n.y, n.x);
      rf = mix(a_sr.z, a_sr.w, k);
      tb = mix(tb0, tb1, k);
      s = mix(a_sr.x, a_sr.y, k);
      corner = vec2(a_t.w, 0.0);
    }
    float alive = step(tb0, u_age);
    // secondary growth: wood thickens from tip radius to its final radius
    float h = clamp((u_age - tb) / max(1.0 - tb, 0.04), 0.0, 1.0);
    float tip = smoothstep(0.0, 0.012, u_age - tb);   // pointed growing tip
    float r = mix(u_rTip * mix(0.3, 1.0, tip), rf, pow(h, 1.6));
    // keep sub-pixel twigs from shimmering: hold a minimum width, fade instead
    float minR = 0.6 / u_ppw;
    v_alpha = alive * clamp(r / minR, 0.0, 1.0);
    r = max(r, minR) * alive;

    // snow rests on the upper side: push that edge outward to make room for it
    float topSign = n.y >= 0.0 ? 1.0 : -1.0;
    float ext = cap ? 0.0 : u_snow * max(min(0.0095, 0.0026 + 0.5 * r), 1.4 / u_ppw) * smoothstep(0.15, 0.6, abs(n.y)) * alive;
    float across = corner.x * r + (corner.x * topSign > 0.0 ? ext : 0.0);

    vec2 cs = c * u_S;
    vec2 pos = cs + windAt(cs, twigOf(tb)) + n * across + t * corner.y * r;
    gl_Position = vec4((pos - u_cam.xy) / u_cam.zw, 0.0, 1.0);
    v_uv = corner;
    v_n = n;
    v_t = t;
    v_bark = vec2(across, s * u_S + corner.y * r);
    v_aw = across;
    v_r = r;
    v_ext = ext;
    v_cap = cap ? 1.0 : 0.0;
  }`;

  const BRANCH_FS = `#version 300 es
  precision highp float;
  in vec2 v_uv, v_n, v_t, v_bark;
  in float v_alpha, v_aw, v_r, v_ext;
  flat in float v_cap;
  uniform vec3 u_ink, u_barkLight, u_snowCol, u_snowShade;
  uniform float u_ppw, u_cellPx, u_snow, u_melt;
  out vec4 o;
  ${COMMON}
  void main() {
    float px = 1.0 / u_ppw;
    float across = v_aw / max(v_r, 1e-7);
    // thaw: thin wood and random stretches lose their snow first
    float keep = 1.0;
    if (u_snow > 0.0 && u_melt > 0.0) {
      float mn = vnoise(vec2(v_bark.y * 55.0, v_r * 900.0)) * 0.75 + min(v_r * 18.0, 0.35);
      keep = 1.0 - smoothstep(mn - 0.12, mn + 0.12, u_melt * 1.35);
    }

    if (v_cap < 0.5 && abs(across) > 1.0) {
      // the snow cap above the wood: lumpy, with an inked top edge
      float over = abs(v_aw) - v_r;
      float depth = v_ext * keep * (0.55 + 0.45 * vnoise(vec2(v_bark.y * 160.0, 3.0)));
      float a = (1.0 - smoothstep(depth - px, depth, over)) * v_alpha;
      if (a < 0.003) discard;
      float rim = smoothstep(depth - 1.8 * px, depth - 0.3 * px, over);
      vec3 col = mix(u_snowCol, u_snowShade, 0.18 * (1.0 - over / max(depth, 1e-7)));
      col = mix(col, u_snowShade * 0.72, rim * 0.65);
      o = vec4(col * a, a);
      return;
    }

    vec2 uv = v_cap > 0.5 ? v_uv : vec2(clamp(across, -1.0, 1.0), 0.0);
    float d2 = dot(uv, uv);
    if (d2 > 1.0) discard;
    vec3 N = vec3(v_n * uv.x + v_t * uv.y, sqrt(1.0 - d2));
    vec3 L = normalize(vec3(-0.6, 0.45, 0.65));
    float lit = clamp(dot(N, L), 0.0, 1.0);
    // bark: long fissures and soft mottling modulate the stipple density
    float fiss = vnoise(vec2(v_bark.x * 320.0, v_bark.y * 45.0));
    float mott = vnoise(v_bark * vec2(60.0, 18.0));
    float dens = smoothstep(0.3, 1.0, lit) * 0.62 * (0.55 + 0.9 * fiss) * (0.7 + 0.6 * mott);
    float dots = stipple(v_bark, u_ppw, clamp(dens, 0.0, 0.85), u_cellPx);
    float rim = smoothstep(0.6, 1.0, abs(uv.x));
    vec3 col = mix(u_ink, u_barkLight, dots * (1.0 - rim * 0.8));

    // snow lying along the top of the wood itself
    float amt = u_snow * keep;
    float up = N.y;
    float thr = 1.0 - 0.7 * amt;
    if (amt > 0.01) {
      float onTop = smoothstep(thr, thr + 0.07, up);
      col = mix(col, mix(u_snowShade, u_snowCol, smoothstep(thr, 1.0, up)), onTop);
    }
    o = vec4(col * v_alpha, v_alpha);
  }`;

  const LEAF_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 a_q;   // corner: x in [-.5,.5], y in [0,1]
  layout(location = 1) in vec4 i_a;   // x, y, angle, size
  layout(location = 2) in vec4 i_b;   // birth, shed, fallT, shade
  layout(location = 3) in vec4 i_c;   // z, rand, variant, landX
  layout(location = 4) in vec4 i_d;   // landY, landAngle, kind, autumnOffset
  uniform vec4 u_cam;
  uniform float u_age, u_S, u_autumn, u_fall, u_winter, u_spring, u_mode, u_seedSink;
  uniform vec3 u_seedDrop;   // the falling seed: offset xy, spin
  uniform vec3 u_leafDark, u_leafLight, u_leafYoung, u_olive, u_gold, u_ochre, u_rust, u_dead, u_paper, u_seed;
  ${WIND}
  out vec2 v_uv;
  out vec3 v_col, v_colL;
  out float v_a;

  const float ASPECT = 0.625;
  const float FALL_DUR = 0.1;
  const float PI = 3.14159265;

  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main() {
    vec2 anchor = i_a.xy;
    float ang = i_a.z, size = i_a.w;
    float birth = i_b.x, shed = i_b.y, fallT = i_b.z, shade = i_b.w;
    float rnd = i_c.y, variant = i_c.z;
    vec2 land = vec2(i_c.w, i_d.x);
    float landA = i_d.y, kind = i_d.z, autOff = i_d.w;

    float scale = 1.0, alpha = 1.0, a = 0.0, underside = 0.0;
    vec2 pos = anchor, squash = vec2(1.0);
    vec3 green = mix(u_leafDark, u_leafLight, smoothstep(0.08, 0.95, shade));
    vec3 col = green;
    float flutter = sin(u_time * (2.2 + rnd * 2.6) + rnd * 40.0) * 6.0 * u_windAmp;

    if (kind > 2.5) {
      // seed coat halves: swell, rock, split open, wither
      if (u_mode > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      float side = ang;
      float gt = clamp((u_age + 0.1) / 0.1, 0.0, 1.0);
      float wob = sin(gt * 22.0) * 0.06 * smoothstep(0.15, 0.45, gt) * (1.0 - smoothstep(0.6, 0.85, gt));
      a = wob + side * (0.06 * smoothstep(0.55, 0.95, gt)
                      + 0.5 * smoothstep(0.0, 0.05, u_age)
                      + 0.35 * smoothstep(0.04, 0.12, u_age));
      scale = (1.0 + 0.08 * smoothstep(0.0, 0.5, gt)) * (1.0 - 0.3 * smoothstep(0.05, 0.16, u_age));
      alpha = 1.0 - smoothstep(0.08, 0.17, u_age);
      pos = anchor + vec2(side * 0.0016 * smoothstep(0.0, 0.1, u_age), -0.0015 * smoothstep(0.03, 0.15, u_age) - u_seedSink);
      vec2 sc = anchor + vec2(0.0, 0.005);
      pos = sc + rot(u_seedDrop.z) * (pos - sc) + u_seedDrop.xy;
      a += u_seedDrop.z;
      col = u_seed;
    } else if (u_mode > 0.5) {
      // spring: fresh buds open where last year's leaves were
      if (kind < 0.5 || kind > 1.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      if (fract(rnd * 5.3) > 0.55) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      float g = smoothstep(rnd * 0.55, rnd * 0.55 + 0.45, u_spring);
      scale = g * mix(0.3, 0.5, fract(rnd * 13.7));
      vec2 base = anchor * u_S;
      pos = base + windAt(base, twigOf(birth));
      a = ang * mix(0.25, 0.75, g) + flutter;
      col = mix(u_leafYoung, u_leafLight, 0.25 + 0.3 * shade);
    } else {
      // grow in
      float g = clamp((u_age - birth) / 0.035, 0.0, 1.0);
      float gs = g * g * (3.0 - 2.0 * g);
      float shedK = smoothstep(shed, shed + 0.03, u_age);
      scale = gs * (1.0 + 0.1 * sin(PI * g)) * (1.0 - 0.6 * shedK);
      alpha = 1.0 - shedK;
      float unfold = kind > 1.5 ? gs : mix(0.25, 1.0, gs);
      vec2 base = anchor * u_S;
      pos = base + windAt(base, twigOf(birth));
      a = ang * unfold + flutter;
      // moving air: leaves flutter hard and flip their pale undersides up
      vec4 au = airU(base);
      float gusty = clamp(au.z * 0.8 + au.w * 6.0 + u_rustle * 1.1, 0.0, 1.6);
      if (gusty > 0.02) {
        a += sin(u_time * (9.0 + rnd * 8.0) + rnd * 37.0) * 0.32 * gusty;
        float turn = smoothstep(0.12, 1.0, gusty) * (0.5 + 0.5 * sin(u_time * (5.0 + rnd * 4.0) + rnd * 53.0));
        float ct = cos(turn * 2.7);
        squash.x = ct;
        underside = smoothstep(0.1, -0.5, ct);
      }

      // colour: fresh → deep green → olive → ochre / rust
      float young = 1.0 - smoothstep(0.0, 0.12, u_age - birth);
      col = mix(green, u_leafYoung, young * 0.55);
      float auK = smoothstep(autOff, autOff + 0.38, u_autumn);
      float hue = fract(rnd * 7.31);
      vec3 warm = hue < 0.5 ? mix(u_gold, u_ochre, hue * 2.0) : mix(u_ochre, u_rust, hue * 2.0 - 1.0);
      warm *= mix(0.62, 1.08, shade);
      col = mix(col, u_olive * mix(0.7, 1.05, shade), smoothstep(0.0, 0.55, auK) * (1.0 - smoothstep(0.45, 1.0, auK)));
      col = mix(col, warm, smoothstep(0.45, 1.0, auK));
      col = mix(col, mix(col, u_paper, 0.5) * vec3(0.97, 1.0, 0.98), underside * 0.75);

      // fall: pendulum drift, tumbling, settle on the ground
      if (kind > 0.5 && kind < 1.5) {
        float f = clamp((u_fall - fallT) / FALL_DUR, 0.0, 1.0);
        if (f > 0.0) {
          float fy = f * f * (3.0 - 2.0 * f) * 0.55 + f * 0.45;
          vec2 p = vec2(mix(pos.x, land.x, f), mix(pos.y, land.y, fy));
          float bell = sin(PI * f);
          float sw = sin(f * (2.5 + rnd * 3.0) * 2.0 * PI + rnd * 20.0);
          p.x += sw * 0.05 * bell;
          p.y += (1.0 - abs(sw)) * -0.012 * bell;
          float settle = smoothstep(0.86, 1.0, f);
          a = mix(a + (rnd - 0.5) * 9.0 * f + sw * 0.8, landA, settle);
          float tumble = cos(f * floor(2.0 + rnd * 4.0) * PI);
          squash = vec2(sign(tumble) * mix(0.15, 1.0, abs(tumble)), mix(1.0, 0.42, settle));
          pos = p;
          col = mix(col, u_dead, 0.3 * f);
          // only some leaves stay visible on the ground; the rest sink into the litter
          float keep = step(fract(rnd * 3.17), 0.22);
          float landed = clamp((u_fall - fallT - FALL_DUR) / 0.07, 0.0, 1.0);
          alpha *= mix(1.0 - landed, 1.0, keep);
          col = mix(col, mix(col, u_dead, 0.5), landed);
          float decay = smoothstep(0.15 + rnd * 0.4, 0.55 + rnd * 0.45, u_winter);
          col = mix(col, mix(u_dead, u_paper, 0.45), decay);
          alpha *= 1.0 - decay;
        }
      }
    }

    if (scale * alpha < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

    vec2 local = vec2(a_q.x * ASPECT * squash.x, a_q.y) * size * scale;
    vec2 off = rot(a) * local;
    off.y *= squash.y;
    vec2 wp = pos + off;
    gl_Position = vec4((wp - u_cam.xy) / u_cam.zw, 0.0, 1.0);

    float cx = mod(variant, 4.0), cy = floor(variant / 4.0);
    v_uv = vec2((cx + a_q.x + 0.5) / 4.0, (cy + 1.0 - a_q.y) / 3.0);
    v_col = col;
    v_colL = mix(col, u_paper, 0.55);
    v_a = alpha;
  }`;

  const LEAF_FS = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  in vec3 v_col, v_colL;
  in float v_a;
  uniform sampler2D u_atlas;
  out vec4 o;
  void main() {
    vec4 t = texture(u_atlas, v_uv, -0.6);
    float a = t.a * v_a;
    if (a < 0.003) discard;
    vec3 c = t.r < 0.35 ? mix(v_col * 0.42, v_col, t.r / 0.35)
                        : mix(v_col, v_colL, (t.r - 0.35) / 0.65);
    o = vec4(c * a, a);
  }`;

  const BLOSSOM_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 a_q;
  layout(location = 1) in vec4 b_a;   // x, y, angle, size
  layout(location = 2) in vec4 b_b;   // bloomT, dropT, shade, z
  layout(location = 3) in vec4 b_c;   // rand, variant, -, -
  uniform vec4 u_cam;
  uniform float u_S, u_bloom, u_shed;
  uniform vec3 u_petal, u_petalLight, u_bud, u_accent;
  ${WIND}
  out vec2 v_uv;
  out vec3 v_col, v_colL, v_acc;
  out float v_a;
  const float ASPECT = 0.625;
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  void main() {
    float bloomT = b_b.x, dropT = b_b.y, shade = b_b.z, rnd = b_c.x;
    float g = smoothstep(bloomT, bloomT + 0.38, u_bloom);     // bud -> open flower
    float drop = smoothstep(dropT, dropT + 0.1, u_shed);       // petals gone
    float scale = smoothstep(0.0, 0.2, g) * mix(0.42, 1.0, smoothstep(0.1, 1.0, g)) * (1.0 - drop);
    if (scale < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec2 base = b_a.xy * u_S;
    vec2 pos = base + windAt(base, 0.9);
    float flutter = sin(u_time * (1.7 + rnd * 2.1) + rnd * 31.0) * 4.5 * u_windAmp;
    flutter += sin(u_time * (8.0 + rnd * 6.0) + rnd * 17.0) * 0.25 * clamp(airU(base).z * 0.8 + u_rustle, 0.0, 1.4);
    float a = b_a.z * mix(0.35, 1.0, g) + flutter;
    vec2 local = vec2(a_q.x * ASPECT, a_q.y) * b_a.w * scale;
    gl_Position = vec4((pos + rot(a) * local - u_cam.xy) / u_cam.zw, 0.0, 1.0);
    float cell = 8.0 + b_c.y;
    v_uv = vec2((mod(cell, 4.0) + a_q.x + 0.5) / 4.0, (floor(cell / 4.0) + 1.0 - a_q.y) / 3.0);
    float open = smoothstep(0.25, 1.0, g);
    v_col = mix(u_bud, u_petal, open) * mix(0.8, 1.06, shade);
    v_colL = mix(mix(u_bud, u_petalLight, 0.4), u_petalLight, open) * mix(0.9, 1.0, shade);
    v_acc = u_accent;
    v_a = 1.0 - drop * 0.4;
  }`;

  // Petals fly on wall-clock time so they never freeze mid-air; scroll only
  // sets how many are drifting (u_rate) and when the shower began (u_clock).
  const PETAL_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 a_q;
  layout(location = 1) in vec4 p_a;   // x0, y0, size, rand
  layout(location = 2) in vec4 p_b;   // period, phase, drift, swirl
  layout(location = 3) in vec4 p_c;   // landY, spin, gate, shade
  uniform vec4 u_cam;
  uniform float u_S, u_rate, u_clock, u_gust;
  uniform vec3 u_petal, u_petalLight, u_accent;
  ${WIND}
  out vec2 v_uv;
  out vec3 v_col, v_colL, v_acc;
  out float v_a;
  const float ASPECT = 0.625, FLY = 0.74, PI = 3.14159265;
  float h11(float n) { return fract(sin(n) * 43758.5453); }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  void main() {
    float T = p_b.x, rnd = p_a.w;
    float tc = u_time / T + p_b.y;
    float cyc = floor(tc), ph = fract(tc);
    float alpha = smoothstep(p_c.z * 0.94, p_c.z * 0.94 + 0.06, u_rate);   // shower density
    alpha *= 1.0 - smoothstep(u_clock - 0.8, u_clock, ph * T);        // only flights begun since the shower started
    alpha *= smoothstep(0.0, 0.025, ph) * (1.0 - smoothstep(0.9, 1.0, ph));
    if (alpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

    float j = h11(cyc * 12.9898 + rnd * 78.233);                      // per-flight variation
    vec2 b0 = p_a.xy * u_S;
    vec2 start = b0 + windAt(b0) + vec2((j - 0.5) * 0.04, (h11(j * 51.3) - 0.5) * 0.02);
    float fl = clamp(ph / FLY, 0.0, 1.0);
    float bell = sin(PI * fl);
    float freq = 3.0 + rnd * 4.0;
    float drift = p_b.z * (0.75 + 0.5 * j) * (1.0 + u_gust);
    vec2 pos;
    pos.x = start.x + drift * (fl * fl * 0.35 + fl * 0.65)
          + p_b.w * sin(fl * freq * 2.0 + rnd * 6.283) * smoothstep(0.0, 0.2, fl);
    pos.y = mix(start.y, p_c.x, fl * fl * 0.3 + fl * 0.7)
          + 0.008 * sin(fl * freq * 4.0 + j * 6.283) * bell;

    // spin + tumble in the air, lie flat once landed
    float settle = smoothstep(0.96, 1.0, fl);
    float a = rnd * 6.283 + p_c.y * fl * 2.0 * PI + 0.6 * sin(fl * freq * 2.0);
    float flip = cos(fl * (5.0 + rnd * 9.0) * PI * 0.5 + rnd * 3.0);
    vec2 sq = vec2(mix(sign(flip) * mix(0.18, 1.0, abs(flip)), 1.0, settle), mix(1.0, 0.45, settle));
    vec2 off = rot(a) * (vec2(a_q.x * ASPECT * sq.x, a_q.y - 0.5) * p_a.z);
    off.y *= sq.y;
    gl_Position = vec4((pos + off - u_cam.xy) / u_cam.zw, 0.0, 1.0);
    v_uv = vec2((3.0 + a_q.x + 0.5) / 4.0, (2.0 + 1.0 - a_q.y) / 3.0);
    v_col = u_petal * mix(0.8, 1.0, p_c.w);
    v_colL = mix(u_petal, u_petalLight, 0.55);
    v_acc = u_accent;
    v_a = alpha;
  }`;

  const FLOWER_FS = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  in vec3 v_col, v_colL, v_acc;
  in float v_a;
  uniform sampler2D u_atlas;
  uniform vec3 u_stamen;
  out vec4 o;
  void main() {
    vec4 t = texture(u_atlas, v_uv, -0.5);
    float a = t.a * v_a;
    if (a < 0.003) discard;
    vec3 c = t.r < 0.35 ? mix(v_col * 0.55, v_col, t.r / 0.35)
                        : mix(v_col, v_colL, (t.r - 0.35) / 0.65);
    c = mix(c, v_acc, clamp((t.g - t.r) * 1.6, 0.0, 1.0));      // deep-pink eye
    c = mix(c, u_stamen, clamp((t.b - t.r) * 1.6, 0.0, 1.0));   // anthers
    o = vec4(c * a, a);
  }`;

  // Flakes fall on wall-clock time like the petals. u_on is how long it has
  // been snowing and u_off how long since it stopped, so the first flakes
  // enter from the top and the last ones finish their fall.
  const SNOW_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 a_q;
  layout(location = 1) in vec4 s_a;   // x (0..1 across view), size, period, phase
  layout(location = 2) in vec4 s_b;   // drift, sway, sway freq, near (0..1)
  layout(location = 3) in vec4 s_c;   // landY, rand, gate, -
  uniform vec4 u_cam;
  uniform float u_time, u_on, u_off, u_rate, u_ppw;
  out vec2 v_q;
  out float v_a, v_soft;
  const float FLY = 0.94;
  void main() {
    float T = s_a.z;
    float ph = fract(u_time / T + s_a.w);
    float age = ph * T;
    float alpha = smoothstep(s_c.z * 0.95, s_c.z * 0.95 + 0.05, u_rate);
    alpha *= smoothstep(u_off, u_off + 0.6, age) * (1.0 - smoothstep(u_on - 0.6, u_on, age));
    alpha *= 1.0 - smoothstep(FLY, 1.0, ph);                       // melt into the drift
    if (alpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float near = s_b.w;
    float fl = clamp(ph / FLY, 0.0, 1.0);
    float top = u_cam.y + u_cam.w + 0.04;
    float bottom = mix(s_c.x, u_cam.y - u_cam.w - 0.04, step(0.5, near));
    float x0 = u_cam.x + (s_a.x - 0.5) * 2.3 * u_cam.z;
    vec2 pos = vec2(x0 + s_b.x * fl + s_b.y * sin(fl * s_b.z + s_c.y * 6.283), mix(top, bottom, fl));
    vec2 off = vec2(a_q.x, a_q.y - 0.5) * s_a.y;
    gl_Position = vec4((pos + off - u_cam.xy) / u_cam.zw, 0.0, 1.0);
    v_q = vec2(a_q.x, a_q.y - 0.5) * 2.0;
    v_a = alpha * mix(1.0, 0.55, near);
    v_soft = clamp(near * 0.9 + 1.5 / max(s_a.y * u_ppw, 1.0), 0.0, 1.0);
  }`;

  const SNOW_FS = `#version 300 es
  precision highp float;
  in vec2 v_q;
  in float v_a, v_soft;
  uniform vec3 u_flake, u_flakeRim;
  out vec4 o;
  void main() {
    float d = length(v_q);
    float a = (1.0 - smoothstep(1.0 - mix(0.15, 0.75, v_soft), 1.0, d)) * v_a;
    if (a < 0.003) discard;
    vec3 c = mix(u_flakeRim, u_flake, clamp(smoothstep(1.0, 0.5, d) + v_soft * 0.6, 0.0, 1.0));
    o = vec4(c * a, a);
  }`;

  // Characters around the tree (actors.js): CPU-placed instances from a
  // second atlas, same tone encoding as the leaves.
  const ACTOR_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 a_q;
  layout(location = 1) in vec4 i_a;   // x, y, X axis (full width)
  layout(location = 2) in vec4 i_b;   // cell, Y axis (full height), alpha
  layout(location = 3) in vec4 i_c;   // base rgb, mode (0 stippled, 1 flat glow, 2 ground shadow)
  layout(location = 4) in vec4 i_d;   // light rgb, grain strength
  layout(location = 5) in vec4 i_e;   // accent 1 rgb
  layout(location = 6) in vec4 i_f;   // accent 2 rgb
  uniform vec4 u_cam;
  uniform vec2 u_grid;
  out vec2 v_uv, v_lp, v_w;
  out vec3 v_base, v_light, v_acc1, v_acc2;
  out float v_a;
  flat out float v_mode, v_grain;
  void main() {
    vec2 X = i_a.zw, Y = i_b.yz;
    vec2 pos = i_a.xy + a_q.x * X + (a_q.y - 0.5) * Y;
    gl_Position = vec4((pos - u_cam.xy) / u_cam.zw, 0.0, 1.0);
    float cell = i_b.x;
    v_uv = (vec2(mod(cell, u_grid.x), floor(cell / u_grid.x)) + vec2(a_q.x + 0.5, 1.0 - a_q.y)) / u_grid;
    // stipple coordinates ride on the sprite, so its grain moves with it
    v_lp = vec2(a_q.x * length(X), (a_q.y - 0.5) * length(Y)) + vec2(cell * 0.173, cell * 0.311);
    v_w = pos;
    v_base = i_c.rgb; v_light = i_d.rgb; v_acc1 = i_e.rgb; v_acc2 = i_f.rgb;
    v_a = i_b.w;
    v_mode = i_c.w;
    v_grain = i_d.w;
  }`;

  const ACTOR_FS = `#version 300 es
  precision highp float;
  in vec2 v_uv, v_lp, v_w;
  in vec3 v_base, v_light, v_acc1, v_acc2;
  in float v_a;
  flat in float v_mode, v_grain;
  uniform sampler2D u_atlas;
  uniform float u_ppw, u_cellPx;
  uniform vec3 u_ink;
  out vec4 o;
  ${COMMON}
  void main() {
    vec4 t = texture(u_atlas, v_uv, -0.4);
    float a = t.a * v_a;
    if (a < 0.003) discard;
    if (v_mode > 1.5) {
      // a cast shadow, stippled like the ground under the tree
      float d = stipple(v_w, u_ppw, clamp(a * 0.9, 0.0, 0.9), u_cellPx);
      o = vec4(u_ink * d * 0.85, d * 0.85);
      return;
    }
    float tone = t.r;
    vec3 c = tone < 0.35 ? mix(v_base * 0.45, v_base, tone / 0.35)
                         : mix(v_base, v_light, (tone - 0.35) / 0.65);
    c = mix(c, v_acc1, clamp((t.g - t.r) * 1.6, 0.0, 1.0));
    c = mix(c, v_acc2, clamp((t.b - t.r) * 1.6, 0.0, 1.0));
    if (v_mode < 0.5 && v_grain > 0.0) {
      // engraving grain: ink dots gather in the shade, pale dots catch the light
      float dk = stipple(v_lp, u_ppw, clamp((0.36 - tone) * 1.5 + 0.08, 0.0, 0.7), u_cellPx);
      float lt = stipple(v_lp + 0.37, u_ppw, clamp((tone - 0.38) * 0.9 + 0.06, 0.0, 0.6), u_cellPx);
      c = mix(c, c * 0.5, dk * 0.6 * v_grain);
      c = mix(c, mix(c, vec3(1.0), 0.4), lt * 0.55 * v_grain);
      c *= 1.0 + (hash12(gl_FragCoord.xy) - 0.5) * 0.1 * v_grain;
    }
    o = vec4(c * a, a);
  }`;

  // Grass: a few thousand blades, each a curved strip bent by the breeze,
  // gust fronts and the moving air. Clumps come up and die off over the
  // decades; in the last year they yellow, fall over, are buried by snow,
  // and new shoots come up through the old thatch in spring.
  const GRASS_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 a_q;   // x across (-1..1), y along the blade (0..1)
  layout(location = 1) in vec4 g_a;   // x, ground y, height, width
  layout(location = 2) in vec4 g_b;   // lean, stiffness, hue, phase
  layout(location = 3) in vec4 g_c;   // birth, death (tree age), annual, seed head
  layout(location = 4) in vec4 g_d;   // spring shoot chance, droop side, rand, -
  uniform vec4 u_cam;
  uniform float u_ppw, u_age, u_autumn, u_fall, u_winter, u_newGrass, u_mode, u_show;
  uniform vec3 u_fresh, u_deep, u_straw, u_dead, u_shoot;
  ${WIND}
  out vec3 v_col;
  out float v_x, v_a, v_s, v_h;
  void main() {
    float x0 = g_a.x, y0 = g_a.y, h = g_a.z, wd = g_a.w;
    float lean = g_b.x, stiff = g_b.y, hue = g_b.z, ph = g_b.w;
    float birth = g_c.x, death = g_c.y, annual = g_c.z, head = g_c.w;
    float rnd = g_d.z;
    float grow, yellow = 0.0, droop = 0.0, alpha;
    vec3 col;
    if (u_mode < 0.5) {
      grow = smoothstep(birth, birth + 0.05, u_age);
      float die = smoothstep(death, death + 0.05, u_age);
      float aut = smoothstep(0.1 + 0.5 * hue, 0.5 + 0.5 * hue, u_autumn);
      float fallDie = annual * smoothstep(0.1 + 0.6 * rnd, 0.4 + 0.6 * rnd, u_fall);
      yellow = max(die, max(aut, u_winter));
      droop = max(die, max(fallDie, u_winter * 0.75));
      float old = smoothstep(0.3 + 0.4 * rnd, 0.7 + 0.3 * rnd, u_newGrass);
      alpha = grow * (1.0 - smoothstep(0.6, 1.0, die)) * (1.0 - smoothstep(0.7, 1.0, fallDie)) * (1.0 - old);
      col = mix(mix(u_deep, u_fresh, hue), u_straw * mix(0.85, 1.1, hue), yellow);
      col = mix(col, u_dead * mix(0.85, 1.1, hue), u_winter);
    } else {
      if (g_d.x > 0.75) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      grow = smoothstep(0.05 + 0.6 * rnd, 0.4 + 0.6 * rnd, u_newGrass);
      h *= mix(0.55, 0.95, hue);
      lean *= 0.6;
      head = 0.0;
      alpha = grow;
      col = mix(u_shoot, u_fresh, 0.35 * hue);
    }
    alpha *= u_show;
    if (alpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float H = h * grow * (1.0 - 0.3 * droop);

    // bending: breeze and travelling gusts, the cursor's air, a quick spring
    float fr = pow(0.5 + 0.5 * sin(u_time * 0.37 - x0 * 1.3 / max(u_treeH, 0.05)), 8.0);
    float wind = (0.5 * sin(u_time * 1.3 + x0 * 2.2 + ph * 0.25) + 0.22 * sin(u_time * 2.9 + x0 * 5.3 + ph) + 0.8 * fr)
               * 0.42 * u_windAmp / 0.0105;
    vec2 gp = vec2(x0, y0 + h * 0.5);
    vec4 au = textureLod(u_airU, airUV(gp), 0.0);
    vec4 ad = textureLod(u_airD, airUV(gp), 0.0);
    float B = clamp((wind + au.x * 0.9 + ad.x * 10.0) / stiff, -1.3, 1.3);
    B += droop * g_d.y * 1.55;

    float s = a_q.y;
    vec2 p = vec2(0.0);
    float ds = s / 4.0;
    for (int i = 0; i < 4; i++) {
      float sg = (float(i) + 0.5) * ds;
      float th = lean + B * sg * sg;
      p += vec2(sin(th), cos(th)) * ds;
    }
    float ths = lean + B * s * s;
    vec2 nrm = vec2(cos(ths), -sin(ths));
    float taper = head > 0.5 ? (s < 0.7 ? 0.5 : 0.5 + 1.5 * sin(3.14159 * (s - 0.7) / 0.3)) : pow(max(1.0 - s, 0.0), 0.75);
    float w = wd * taper;
    float minW = 0.8 / u_ppw;
    alpha *= clamp(w / minW, 0.0, 1.0);
    w = max(w, minW * step(s, 0.995));
    vec2 world = vec2(x0, y0) + p * H + nrm * a_q.x * w * 0.5;
    gl_Position = vec4((world - u_cam.xy) / u_cam.zw, 0.0, 1.0);
    if (head > 0.5 && s > 0.7) col = mix(col, u_straw * 1.15, 0.6);
    v_col = col;
    v_x = a_q.x;
    v_a = alpha;
    v_s = s;
    v_h = p.y * H;
  }`;

  const GRASS_FS = `#version 300 es
  precision highp float;
  in vec3 v_col;
  in float v_x, v_a, v_s, v_h;
  uniform vec3 u_ink;
  uniform float u_snowDepth;
  out vec4 o;
  ${COMMON}
  void main() {
    float e = abs(v_x);
    float aa = fwidth(v_x) * 1.3;
    float a = v_a * (1.0 - smoothstep(1.0 - aa, 1.0 + aa * 0.2, e));
    a *= smoothstep(u_snowDepth - 0.0007, u_snowDepth + 0.0007, v_h);     // buried in snow
    if (a < 0.003) discard;
    vec3 c = mix(u_ink, v_col, 0.3 + 0.7 * smoothstep(0.0, 0.6, v_s));    // shaded at the root
    c = mix(c, c * 0.6, smoothstep(0.4, 1.0, e));                          // inked edges
    c *= 0.92 + 0.16 * hash12(gl_FragCoord.xy);                            // grain
    o = vec4(c * a, a);
  }`;

  // Midsummer night: the whole picture is multiplied down to dusk, then a
  // moon and a few stars are added on top.
  const DUSK_FS = `#version 300 es
  precision highp float;
  uniform vec2 u_res;
  uniform float u_dusk;
  out vec4 o;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    vec3 sky = mix(vec3(0.62, 0.54, 0.52), vec3(0.24, 0.29, 0.41), smoothstep(0.05, 0.85, uv.y));
    o = vec4(mix(vec3(1.0), sky, u_dusk), 1.0);
  }`;

  const NIGHT_FS = `#version 300 es
  precision highp float;
  uniform vec2 u_res, u_moon;
  uniform float u_dusk, u_time, u_dpr;
  out vec4 o;
  ${COMMON}
  void main() {
    vec2 p = gl_FragCoord.xy;
    float d = length(p - u_moon) / u_res.y;
    float disc = smoothstep(0.043, 0.04, d);
    float shade = 0.82 + 0.18 * vnoise((p - u_moon) / (u_res.y * 0.012));
    float halo = exp(-d * 9.0) * 0.16 + exp(-d * 28.0) * 0.12;
    float cs = 44.0 * u_dpr;
    vec2 cid = floor(p / cs);
    vec2 h = hash22(cid);
    vec2 sp = (cid + 0.2 + 0.6 * h) * cs;
    float star = step(0.84, hash12(cid + 3.1)) * smoothstep(1.4 * u_dpr, 0.0, length(p - sp))
               * smoothstep(0.42, 0.8, p.y / u_res.y) * (0.55 + 0.45 * sin(u_time * (1.0 + h.x * 3.0) + h.y * 20.0));
    vec3 c = vec3(0.96, 0.93, 0.82) * (disc * 0.8 * shade + halo) + vec3(0.9, 0.93, 1.0) * star * 0.85;
    o = vec4(c * u_dusk, 1.0);
  }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(log, '\n', src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      throw new Error('Shader compile failed: ' + log);
    }
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const cache = {};
    return {
      p,
      u(name) {
        if (!(name in cache)) cache[name] = gl.getUniformLocation(p, name);
        return cache[name];
      },
    };
  }
  const bgProg = program(BG_VS, BG_FS);
  const branchProg = program(BRANCH_VS, BRANCH_FS);
  const leafProg = program(LEAF_VS, LEAF_FS);
  const blossomProg = program(BLOSSOM_VS, FLOWER_FS);
  const petalProg = program(PETAL_VS, FLOWER_FS);
  const snowProg = program(SNOW_VS, SNOW_FS);
  const actorProg = program(ACTOR_VS, ACTOR_FS);
  const grassProg = program(GRASS_VS, GRASS_FS);
  const duskProg = program(BG_VS, DUSK_FS);
  const nightProg = program(BG_VS, NIGHT_FS);

  // ---------------------------------------------------------------- buffers
  const emptyVAO = gl.createVertexArray();

  const branchVAO = gl.createVertexArray();
  gl.bindVertexArray(branchVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, tree.vdata, gl.STATIC_DRAW);
  const BSTRIDE = tree.floatsPerVertex * 4;
  for (let i = 0; i < 5; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, BSTRIDE, i * 16);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tree.idata, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const quadVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1]), gl.STATIC_DRAW);
  const quadIbo = gl.createBuffer();
  const instVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
  gl.bufferData(gl.ARRAY_BUFFER, tree.leafData, gl.STATIC_DRAW);

  // Two views into the same (z-sorted) instance buffer: behind and in front
  // of the branches.
  function leafVAO(firstInstance) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 64, firstInstance * 64 + i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return vao;
  }
  const leafBack = leafVAO(0);
  const leafFront = leafVAO(tree.leafSplit);

  // Blossoms and petals: 3 vec4 per instance, split behind / in front.
  function flowerVAOs(data, split) {
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return [0, split].map((first) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(1 + i);
        gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, first * 48 + i * 16);
        gl.vertexAttribDivisor(1 + i, 1);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIbo);
      gl.bindVertexArray(null);
      return vao;
    });
  }
  const [blossomBack, blossomFront] = flowerVAOs(tree.blossomData, tree.blossomSplit);
  const [petalBack, petalFront] = flowerVAOs(tree.petalData, tree.petalSplit);

  // Meadow: blades in clumps, far ones first (see GRASS_VS). Each clump has
  // a birth and a death in tree years; fewer last long in the crown's shade.
  const meadow = (() => {
    const R = mulberry32(SEED * 53 + 11);
    const rnd = (a, b) => a + (b - a) * R();
    const blades = [];
    for (let c = 0; c < 640; c++) {
      const cy = rnd(-0.095, 0.026);
      let cx = rnd(-1.95, 1.75);
      if (Math.abs(cx) < 0.1 && cy > -0.035) cx += 0.17 * (Math.sign(cx) || 1);
      const near = ramp(-cy, -0.026, 0.095);
      const shadeK = Math.exp(-(cx * cx) / 0.16);
      const birth = 0.1 + 0.86 * Math.pow(R(), 0.85);
      const death = birth + rnd(0.2, 1.0) * (1 - 0.5 * shadeK);
      const n = 4 + Math.floor(R() * 9);
      const tall = rnd(0.6, 1.25) * (1 - 0.25 * shadeK);
      const annual = R() < 0.4 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const dx = rnd(-0.013, 0.013);
        let h = rnd(0.013, 0.04) * tall * lerp(0.85, 1.45, near);
        const w = rnd(0.0022, 0.0036) * lerp(0.85, 1.3, near);
        const head = R() < 0.12 && h > 0.026 ? 1 : 0;
        if (head) h *= 1.3;
        blades.push([cx + dx, cy + rnd(-0.003, 0.003), h, w, dx * 14 + rnd(-0.25, 0.25), rnd(0.7, 1.5), R(), rnd(0, 6.28),
          birth + rnd(-0.01, 0.02), death + rnd(-0.02, 0.02), annual, head, R(), R() < 0.5 ? -1 : 1, R(), 0]);
      }
    }
    blades.sort((a, b) => b[1] - a[1]);
    let split = blades.findIndex((b) => b[1] < 0);
    if (split < 0) split = blades.length;
    const data = new Float32Array(blades.length * 16);
    blades.forEach((b, i) => data.set(b, i * 16));
    const geo = [], idx = [];
    for (let r = 0; r <= 6; r++) geo.push(-1, r / 6, 1, r / 6);
    for (let r = 0; r < 6; r++) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const gvbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, gvbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo), gl.STATIC_DRAW);
    const ivbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ivbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const gibo = gl.createBuffer();
    const vaos = [0, split].map((first, n) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gvbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, ivbo);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(1 + i);
        gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 64, first * 64 + i * 16);
        gl.vertexAttribDivisor(1 + i, 1);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gibo);
      if (n === 0) gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return vao;
    });
    return { count: blades.length, split, vaos, indexCount: idx.length };
  })();

  // Snowflakes, far ones first: x, size, period, phase | drift, sway, freq, near | landY, rand, gate, -
  const snow = (() => {
    const R = mulberry32(SEED * 31 + 7);
    const rnd = (a, b) => a + (b - a) * R();
    const flakes = [];
    for (let i = 0; i < 1700; i++) {
      const near = R() < 0.13 ? rnd(0.6, 1) : rnd(0, 0.35);
      const big = near > 0.5;
      flakes.push([R(), big ? rnd(0.014, 0.028) : rnd(0.0045, 0.011), big ? rnd(4.5, 7) : rnd(8, 14), R(),
        rnd(0.02, 0.16), rnd(0.008, 0.035) * (1 + near), rnd(4, 11), near,
        rnd(-0.07, 0.025), R(), R(), 0]);
    }
    flakes.sort((a, b) => a[7] - b[7]);
    const data = new Float32Array(flakes.length * 12);
    flakes.forEach((f, i) => data.set(f, i * 12));
    const split = flakes.findIndex((f) => f[7] > 0.5);
    return { count: flakes.length, split: split < 0 ? flakes.length : split, vaos: flowerVAOs(data, split < 0 ? flakes.length : split) };
  })();

  // ------------------------------------------------------------ leaf atlas
  // 4×3 cells: 0–4 pinnate leaves, 5 cotyledon, 6/7 seed-coat halves,
  // 8–10 cherry blossom clusters, 11 a loose petal.
  // The red channel is a tone the shader maps onto the leaf colour:
  // 0 = cast shadow, BASE = the leaf's own colour, 1 = highlight.
  const CW = 320, CH = 512;
  const BASE = 'rgb(90,90,90)';      // 0.35
  const EDGE = 'rgb(28,28,28)';

  function leafletPath(ctx, p, d, ll, lw, curl) {
    const px = -d[1], py = d[0];
    const at = (f, w) => [
      p[0] + d[0] * ll * f + px * (w + curl * ll * f * f),
      p[1] + d[1] * ll * f + py * (w + curl * ll * f * f),
    ];
    const tip = at(1, 0);
    const c1 = at(0.1, lw), c2 = at(0.68, lw * 0.9), c3 = at(0.68, -lw * 0.9), c4 = at(0.1, -lw);
    ctx.moveTo(p[0], p[1]);
    ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], tip[0], tip[1]);
    ctx.bezierCurveTo(c3[0], c3[1], c4[0], c4[1], p[0], p[1]);
    return at;
  }

  function drawCompoundLeaf(ctx, R, v) {
    const rnd = (a, b) => a + (b - a) * R();
    const pairs = [6, 7, 5, 8, 6][v];
    const bx = CW / 2, by = CH - 4, len = CH * 0.8;
    const bend = rnd(-0.1, 0.1) * CW;
    const P0 = [bx, by], P1 = [bx + bend, by - len * 0.5], P2 = [bx + bend * 0.5, by - len];
    const qp = (t) => [
      (1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0],
      (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1],
    ];
    const qd = (t) => {
      const dx = 2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]);
      const dy = 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
      const l = Math.hypot(dx, dy);
      return [dx / l, dy / l];
    };
    const rotv = (d, a) => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)];
    const petiole = 0.17;
    const items = [];
    for (let i = 0; i < pairs; i++) {
      const u = i / (pairs - 1);
      const t = petiole + (0.9 - petiole) * u;
      const p = qp(t), d = qd(t);
      const sf = 0.72 + 0.28 * Math.sin(Math.PI * (0.3 + 0.7 * u));
      const ll = CW * 0.4 * sf * rnd(0.9, 1.06);
      for (const side of [-1, 1]) {
        const dir = rotv(d, side * rnd(0.85, 1.1));
        const off = [p[0] + dir[0] * 4, p[1] + dir[1] * 4];
        items.push({ p: off, d: dir, ll, lw: ll * rnd(0.26, 0.31), curl: side * -0.1 });
      }
    }
    const tp = qp(0.92), td = qd(0.92);
    items.push({ p: tp, d: td, ll: Math.min(CW * 0.36, (tp[1] - 6)), lw: CW * 0.36 * 0.28, curl: 0 });

    // blades, with a soft cast shadow so overlapping leaves stay legible
    const blades = new Path2D();
    for (const it of items) leafletPath(blades, it.p, it.d, it.ll, it.lw, it.curl);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 7;
    ctx.shadowOffsetY = 9;
    ctx.fillStyle = BASE;
    ctx.fill(blades);
    ctx.restore();
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 5;
    ctx.stroke(blades);

    // light midribs and speckles, kept inside the ink
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (const it of items) {
      const px = -it.d[1], py = it.d[0];
      const at = (f, w) => [
        it.p[0] + it.d[0] * it.ll * f + px * (w + it.curl * it.ll * f * f),
        it.p[1] + it.d[1] * it.ll * f + py * (w + it.curl * it.ll * f * f),
      ];
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      const a0 = at(0.08, 0);
      ctx.moveTo(a0[0], a0[1]);
      for (let f = 0.2; f <= 0.86; f += 0.13) { const q = at(f, 0); ctx.lineTo(q[0], q[1]); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      const nd = 3 + Math.floor(R() * 5);
      for (let k = 0; k < nd; k++) {
        const q = at(rnd(0.2, 0.8), it.lw * rnd(0.2, 0.55) * (R() < 0.75 ? 1 : -1));
        ctx.beginPath();
        ctx.arc(q[0], q[1], rnd(1.6, 3.2), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // rachis + petiole
    ctx.strokeStyle = EDGE;
    ctx.lineCap = 'round';
    for (let k = 0; k < 12; k++) {
      const ta = (k / 12) * 0.92, tb = ((k + 1) / 12) * 0.92;
      const a = qp(ta), b = qp(tb);
      ctx.lineWidth = lerp(9, 3.5, ta);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }

  function drawCotyledon(ctx, R) {
    const rnd = (a, b) => a + (b - a) * R();
    const bx = CW / 2, by = CH - 4;
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - CH * 0.14); ctx.stroke();
    const blade = new Path2D();
    const at = leafletPath(blade, [bx, by - CH * 0.12], [0, -1], CH * 0.84, CW * 0.52, 0);
    ctx.fillStyle = BASE;
    ctx.fill(blade);
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 6;
    ctx.stroke(blade);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    const a0 = at(0.05, 0), a1 = at(0.8, 0);
    ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke();
    for (let k = 0; k < 420; k++) {
      const f = rnd(0.08, 0.9), w = rnd(-1, 1);
      const q = at(f, w * CW * 0.33 * Math.sin(Math.PI * Math.min(1, f * 1.1)));
      const light = (w < 0 ? 0.85 : 0.25) * (1 - Math.abs(w) * 0.5);
      if (R() > light) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(q[0], q[1], rnd(2, 4.5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawSeed(ctx, half) {
    const R = mulberry32(777);
    const rnd = (a, b) => a + (b - a) * R();
    const cx = CW / 2, bottom = CH - 6, h = CH * 0.6, w = CW * 0.82;
    ctx.save();
    ctx.beginPath();
    if (half < 0) ctx.rect(0, 0, cx, CH); else ctx.rect(cx, 0, CW - cx, CH);
    ctx.clip();
    // egg outline, wider near the base
    const egg = new Path2D();
    const N = 80;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const y = Math.cos(t);
      const x = Math.sin(t) * (1 - 0.18 * y);
      const px = cx + x * w / 2, py = bottom - h / 2 - y * h / 2;
      if (i === 0) egg.moveTo(px, py); else egg.lineTo(px, py);
    }
    ctx.fillStyle = 'rgb(60,60,60)';
    ctx.fill(egg);
    ctx.clip(egg);
    // stippled highlight on the upper left, darker rim
    for (let k = 0; k < 2600; k++) {
      const x = rnd(-1, 1), y = rnd(-1, 1);
      if (x * x + y * y > 1) continue;
      const l = Math.max(0, -x * 0.65 + y * 0.55 + 0.25) * (1 - (x * x + y * y) * 0.6);
      if (R() > l * 0.9) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(cx + x * w / 2, bottom - h / 2 - y * h / 2, rnd(1.6, 3.6), 0, Math.PI * 2);
      ctx.fill();
    }
    // seam
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, bottom - 4);
    ctx.bezierCurveTo(cx - 6, bottom - h * 0.35, cx + 6, bottom - h * 0.7, cx, bottom - h + 6);
    ctx.stroke();
    ctx.restore();
  }


  // ---- cherry blossom sprites ---------------------------------------------
  // Two extra channels ride on top of the tone in red: green above red marks
  // the deep-pink eye, blue above red marks the gold anthers.
  const tone = (t, a = 1) => { const v = Math.round(t * 255); return `rgba(${v},${v},${v},${a})`; };
  const eye = (t, a) => { const v = Math.round(t * 255); return `rgba(${v},255,${v},${a})`; };
  const anther = (t, a) => { const v = Math.round(t * 255); return `rgba(${v},${v},255,${a})`; };

  // Obovate petal with a notched tip, growing from (cx, cy) along angle a (0 = up).
  function petalPath(path, cx, cy, a, L, W) {
    const dx = Math.sin(a), dy = -Math.cos(a), px = Math.cos(a), py = Math.sin(a);
    const P = (u, v) => [cx + dx * u * L + px * v * W, cy + dy * u * L + py * v * W];
    const bez = (c1, c2, e) => path.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
    const s0 = P(0.06, 0);
    path.moveTo(s0[0], s0[1]);
    bez(P(0.25, -0.22), P(0.5, -0.58), P(0.86, -0.46));
    bez(P(1.0, -0.36), P(1.03, -0.12), P(0.91, 0));
    bez(P(1.03, 0.12), P(1.0, 0.36), P(0.86, 0.46));
    bez(P(0.5, 0.58), P(0.25, 0.22), s0);
  }

  function drawFlower(ctx, cx, cy, R, rot, sy, rng) {
    const rnd = (a, b) => a + (b - a) * rng();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, sy);
    ctx.rotate(rot);
    const petals = [];
    const all = new Path2D();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rnd(-0.1, 0.1);
      const L = R * rnd(0.92, 1.04);
      const p = new Path2D();
      petalPath(p, 0, 0, a, L, R * 0.95);
      petalPath(all, 0, 0, a, L, R * 0.95);
      petals.push({ p, a, L });
    }
    // soft cast shadow, then petals paling toward their tips
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 6;
    const g = ctx.createRadialGradient(0, 0, R * 0.05, 0, 0, R);
    g.addColorStop(0, tone(0.5));
    g.addColorStop(0.45, tone(0.68));
    g.addColorStop(1, tone(0.93));
    ctx.fillStyle = g;
    ctx.fill(all);
    ctx.restore();

    ctx.save();
    ctx.clip(all);
    ctx.strokeStyle = tone(0.55, 0.45);
    ctx.lineWidth = 1.6;
    for (const pt of petals) {
      for (let k = -1; k <= 1; k++) {
        const a = pt.a + k * 0.16;
        ctx.beginPath();
        ctx.moveTo(Math.sin(a) * R * 0.2, -Math.cos(a) * R * 0.2);
        ctx.lineTo(Math.sin(a) * pt.L * 0.78, -Math.cos(a) * pt.L * 0.78);
        ctx.stroke();
      }
    }
    const e = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.46);
    e.addColorStop(0, eye(0.3, 0.95));
    e.addColorStop(0.55, eye(0.45, 0.5));
    e.addColorStop(1, eye(0.6, 0));
    ctx.fillStyle = e;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();

    ctx.strokeStyle = tone(0.2);
    ctx.lineWidth = 2.6;
    for (const pt of petals) ctx.stroke(pt.p);

    // stamens: pale filaments tipped with gold anthers
    ctx.lineCap = 'round';
    const n = 16 + Math.floor(rng() * 8);
    for (let k = 0; k < n; k++) {
      const a = rnd(0, Math.PI * 2), l = R * rnd(0.3, 0.5);
      const ex = Math.sin(a) * l, ey = -Math.cos(a) * l;
      ctx.strokeStyle = tone(0.92, 0.9);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * R * 0.06, -Math.cos(a) * R * 0.06);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = anther(0.4, 1);
      ctx.beginPath(); ctx.arc(ex, ey, rnd(3, 4.6), 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = tone(0.85);
    ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawPedicel(ctx, x0, y0, x1, y1, bend) {
    ctx.strokeStyle = tone(0.16);
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2, x1, y1);
    ctx.stroke();
  }

  function drawBud(ctx, x, y, rx, ry, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const p = new Path2D();
    p.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = tone(0.45);
    ctx.fill(p);
    ctx.save();
    ctx.clip(p);
    const g = ctx.createLinearGradient(0, ry, 0, -ry);
    g.addColorStop(0, eye(0.3, 0.9));
    g.addColorStop(1, eye(0.5, 0.35));
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -ry, rx * 2, ry * 2);
    ctx.restore();
    ctx.strokeStyle = tone(0.2);
    ctx.lineWidth = 2.6;
    ctx.stroke(p);
    ctx.fillStyle = tone(0.16);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.quadraticCurveTo(s * rx * 0.9, ry * 0.9, s * rx * 0.7, ry * 0.35);
      ctx.quadraticCurveTo(s * rx * 0.3, ry * 0.75, 0, ry);
      ctx.fill();
    }
    ctx.restore();
  }

  // 2–3 flowers on pedicels from one spur at the bottom centre of the cell.
  function drawBlossomCluster(ctx, v, rng) {
    const rnd = (a, b) => a + (b - a) * rng();
    const bx = CW / 2, by = CH - 6;
    const layouts = [
      { flowers: [[160, 150, 80], [88, 318, 74], [232, 282, 78]], buds: [] },
      { flowers: [[226, 200, 76], [104, 262, 82]], buds: [[150, 96, 22, 36]] },
      { flowers: [[160, 300, 126]], buds: [] },
    ];
    const L = layouts[v];
    for (const f of L.flowers) drawPedicel(ctx, bx, by, f[0], f[1], rnd(-30, 30));
    for (const b of L.buds) drawPedicel(ctx, bx, by, b[0], b[1] + b[3], rnd(-20, 20));
    for (const b of L.buds) drawBud(ctx, b[0], b[1], b[2], b[3], rnd(-0.2, 0.2));
    for (const f of L.flowers) drawFlower(ctx, f[0], f[1], f[2], rnd(0, 1.3), rnd(0.78, 1), rng);
  }

  // A single loose petal, centred so it spins about its middle.
  function drawPetalSprite(ctx) {
    const base = CH / 2 + 215;
    const p = new Path2D();
    petalPath(p, CW / 2, base, 0, 430, 300);
    const g = ctx.createLinearGradient(0, base, 0, CH / 2 - 215);
    g.addColorStop(0, tone(0.45));
    g.addColorStop(0.5, tone(0.7));
    g.addColorStop(1, tone(0.9));
    ctx.fillStyle = g;
    ctx.fill(p);
    ctx.save();
    ctx.clip(p);
    const e = ctx.createRadialGradient(CW / 2, base, 0, CW / 2, base, 170);
    e.addColorStop(0, eye(0.45, 0.6));
    e.addColorStop(1, eye(0.7, 0));
    ctx.fillStyle = e;
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = tone(0.6, 0.45);
    ctx.lineWidth = 3;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(CW / 2, base - 15);
      ctx.quadraticCurveTo(CW / 2 + k * 30, CH / 2, CW / 2 + k * 55, CH / 2 - 150);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = tone(0.22);
    ctx.lineWidth = 6;
    ctx.stroke(p);
  }

  function buildAtlas() {
    const cv = document.createElement('canvas');
    cv.width = CW * 4;
    cv.height = CH * 3;
    const ctx = cv.getContext('2d');
    const R = mulberry32(SEED * 7 + 3);
    const cell = (i, fn) => {
      ctx.save();
      ctx.translate((i % 4) * CW, Math.floor(i / 4) * CH);
      ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();
      fn();
      ctx.restore();
    };
    for (let v = 0; v < 5; v++) cell(v, () => drawCompoundLeaf(ctx, R, v));
    cell(5, () => drawCotyledon(ctx, R));
    cell(6, () => drawSeed(ctx, -1));
    cell(7, () => drawSeed(ctx, 1));
    const BR = mulberry32(SEED * 13 + 5);
    for (let v = 0; v < 3; v++) cell(8 + v, () => drawBlossomCluster(ctx, v, BR));
    cell(11, () => drawPetalSprite(ctx));
    return cv;
  }

  const atlasCanvas = buildAtlas();

  // the cast (actors.js) and its atlas, on texture unit 1
  const cast = TreeActors.create(tree, SEED);
  const actorCanvas = TreeActors.buildAtlas(
    (ctx) => drawCompoundLeaf(ctx, mulberry32(99), 1),
    (ctx) => drawPetalSprite(ctx));
  const actorTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, actorTex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, actorCanvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);

  const actorVAOs = {};
  for (const name of ['back', 'front', 'glow']) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, cast.MAX * cast.FLOATS * 4, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 6; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, cast.FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIbo);
    gl.bindVertexArray(null);
    actorVAOs[name] = { vao, vbo };
  }

  // The air (air.js): the cursor pushes it around, a click shoves the tree.
  // Two small float textures carry it to the shaders on units 2 and 3.
  const air = TreeAir.create();
  function airTexture(unit) {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, air.NX, air.NY, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    return tex;
  }
  const airTexD = airTexture(2), airTexU = airTexture(3);
  function uploadAir() {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, airTexD);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, air.NX, air.NY, gl.RGBA, gl.FLOAT, air.texD);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, airTexU);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, air.NX, air.NY, gl.RGBA, gl.FLOAT, air.texU);
    gl.activeTexture(gl.TEXTURE0);
  }

  // pointer: screen position and the distance moved since the last frame
  const interact = { sx: -1, sy: -1, ax: 0, ay: 0, vx: 0, vy: 0, seen: 0 };
  let lastCam = null, lastTreeH = 0.05;
  // the same sway as the shaders' windAt(), for things that sit on the tree
  function windAtJS(x, y, time, windAmp, treeH, twig = 1) {
    const h = clamp(y / Math.max(treeH, 0.02), 0, 1.6), k = h * h * treeH;
    const front = Math.pow(0.5 + 0.5 * Math.sin(time * 0.37 - x * 1.3 / Math.max(treeH, 0.05)), 8);
    const w = Math.sin(time * 0.73 + x * 1.4) * 0.55 + Math.sin(time * 1.61 + x * 3.3 + y * 1.9) * 0.3
      + Math.sin(time * 3.1 + x * 7.0 - y * 5.0) * 0.15 * h + front * (0.6 + 0.4 * Math.sin(time * 4.3 + y * 9.0) * twig);
    let dx = w * k * windAmp, dy = -0.2 * Math.abs(w) * h * k * windAmp;
    const hk = twig * smooth(0.08, 0.45, h);
    if (hk > 0) {
      const a = air.swayAt(x / Math.max(treeH, 0.02), y / Math.max(treeH, 0.02));
      const qx = x / Math.max(treeH, 0.05), qy = y / Math.max(treeH, 0.05);
      const ph1 = 3 * Math.sin(qx * 37 + 1.3 * Math.sin(qy * 29)) + 2 * Math.sin(qy * 41 - qx * 13);
      const ph2 = 3 * Math.sin(qy * 33 + 1.1 * Math.sin(qx * 31)) + 2 * Math.sin(qx * 43 + qy * 17);
      const r = (reduceMotion ? 0.4 : 1) * air.rustle * 0.009;
      dx += (a[0] + Math.sin(time * 21 + ph1) * r) * hk * treeH;
      dy += (a[1] + 0.7 * Math.sin(time * 17 + ph2) * r) * hk * treeH;
    }
    return [dx, dy];
  }
  function airAtJS(x, y, treeH) {
    const a = air.airAt(x / Math.max(treeH, 0.02), y / Math.max(treeH, 0.02));
    return [a[0] * treeH, a[1] * treeH];
  }
  const atlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);

  // ------------------------------------------------------- lifecycle state
  let showerClock = 0;   // seconds since the petal shower began (rewinds on scroll-back)
  let snowOn = 0, snowOff = 0;   // seconds since it started / stopped snowing

  function stateAt(P) {
    let age;
    if (P < TL.germ[1]) age = lerp(-0.1, 0, ramp(P, TL.germ[0], TL.germ[1]));
    else age = Math.pow(ramp(P, TL.grow[0], TL.grow[1]), 1.12);
    const S = age <= 0 ? 0.15 : 0.15 + 0.85 * (1 - (1 - age) * (1 - age));
    return {
      P, age, S,
      autumn: ramp(P, TL.autumn[0], TL.autumn[1]),
      fall: ramp(P, TL.fall[0], TL.fall[1]),
      winter: ramp(P, TL.winter[0], TL.winter[1]),
      spring: ramp(P, TL.spring[0], TL.spring[1]),
      bloom: ramp(P, TL.bloom[0], TL.bloom[1]),
      shed: ramp(P, TL.shed[0], TL.shed[1]),
      rate: smooth(TL.shower, TL.shower + 0.03, P) * (1 - 0.5 * smooth(0.965, 1.0, P)),
      clock: showerClock,
      snow: smooth(TL.snow[0], TL.snow[1], P),
      melt: ramp(P, TL.melt[0], TL.melt[1]),
      thaw: ramp(P, TL.thaw[0], TL.thaw[1]),
      snowSky: smooth(TL.snowfall[0], TL.snowfall[0] + 0.035, P) * (1 - smooth(TL.melt[0], TL.thaw[1], P)),
      // only inside the snowy stretch: no stray flakes over the seed or the blossom
      dusk: smooth(TL.dusk[0], TL.dusk[1], P) * (1 - smooth(TL.dusk[2], TL.dusk[3], P)),
      snowRate: smooth(TL.snowfall[0] - 0.015, TL.snowfall[0], P) * (1 - smooth(TL.snowfall[1], TL.snowfall[1] + 0.035, P)),
      snowOn, snowOff,
      gust: 0,
      // new grass comes up through the old thatch once the snow has gone
      newGrass: ramp(P, TL.thaw[0] + 0.012, TL.spring[0] + 0.03),
      seedSink: 0.0012 * smooth(0.006, 0.019, P),
      seedDrop: [0, 0, 0],
    };
  }

  // The seed falls on its own a moment after the page opens: it drops,
  // bounces twice and rocks to rest (world units, seconds).
  let seedT0 = performance.now() / 1000 + 0.9;
  function seedDrop(T) {
    if (T >= 3) return [0, 0, 0];
    const g = 0.2, h0 = 0.034, tf = Math.sqrt(2 * h0 / g);
    if (T < 0) return [-0.004, 0.3, 1.9];
    if (T < tf) {
      const u = T / tf;
      return [-0.0045 * (1 - u), h0 - 0.5 * g * T * T, 2.2 * (1 - u) * (1 - u) + 0.3 * Math.sin(u * 5) * (1 - u)];
    }
    const t2 = T - tf, v1 = g * tf * 0.28, b1 = 2 * v1 / g, v2 = v1 * 0.3, b2 = 2 * v2 / g;
    let y = 0;
    if (t2 < b1) y = v1 * t2 - 0.5 * g * t2 * t2;
    else if (t2 - b1 < b2) { const t3 = t2 - b1; y = v2 * t3 - 0.5 * g * t3 * t3; }
    const x = 0.0008 * Math.sin(Math.min(t2 / 1.6, 1) * Math.PI);     // rolls a little and rocks back
    const r = 0.38 * Math.exp(-t2 * 2.6) * Math.sin(t2 * 11);
    return [x, y, r];
  }

  function extAt(age) {
    const f = clamp(age, 0, 1) * tree.nExt;
    const i = Math.min(tree.nExt - 1, Math.floor(f)), t = f - i;
    const e = tree.ext;
    return [0, 1, 2].map((k) => lerp(e[i * 3 + k], e[(i + 1) * 3 + k], t));
  }

  // Narrow / portrait screens stack the captions above the tree; the camera
  // keeps the crown below them.
  const stackedMQ = window.matchMedia('(max-width: 560px), (max-aspect-ratio: 23/20)');   // keep in sync with index.html
  let textBottomFrac = 0;
  function measureText() {
    textBottomFrac = 0;
    if (!stackedMQ.matches) return;
    let b = 0;
    for (const el of document.querySelectorAll('.hero, .chapter')) b = Math.max(b, el.offsetTop + el.offsetHeight);
    textBottomFrac = b / window.innerHeight;
  }

  function cameraFor(st, aspect) {
    const age = Math.max(0, st.age);
    const e = extAt(age);
    const pad = 0.035 * smooth(0, 0.05, age);
    const minX = e[0] * st.S - pad, maxX = e[1] * st.S + pad, maxY = e[2] * st.S + pad;
    const wide = !stackedMQ.matches;
    const frac = lerp(0.42, 0.74, smooth(0.0, 0.85, age));
    let viewH = Math.max(0.052, maxY / frac);
    viewH = Math.max(viewH, (maxX - minX) / ((wide ? 0.57 : 1.02) * aspect));
    viewH *= 1 - 0.035 * smooth(0.43, 1.0, st.P);
    let gFrac = lerp(0.36, 0.12, smooth(0.05, 0.5, viewH));
    if (!wide && textBottomFrac > 0) {
      const room = Math.max(0.2, 1 - textBottomFrac - 0.03 - gFrac);
      if (maxY / viewH > room) {
        viewH = maxY / room;
        gFrac = lerp(0.36, 0.12, smooth(0.05, 0.5, viewH));
      }
    }
    const halfH = viewH / 2, halfW = halfH * aspect;
    const treeCx = (minX + maxX) / 2 * smooth(0.0, 0.3, age);
    const cx = treeCx - (wide ? 0.145 : 0) * viewH * aspect;
    const cy = viewH * (0.5 - gFrac);
    return { cx, cy, halfW, halfH, viewH, minX, maxX, maxY };
  }

  // ------------------------------------------------------------ rendering
  let dpr = 1;
  let quality = 1;   // lowered automatically if frames run slow
  function resize() {
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2) * quality);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  const set3 = (prog, name, c) => gl.uniform3f(prog.u(name), c[0], c[1], c[2]);

  function render(st, time, windAmp) {
    resize();
    const W = canvas.width, H = canvas.height;
    const cam = cameraFor(st, W / H);
    const ppw = H / (2 * cam.halfH);
    const treeH = Math.max(0.02, cam.maxY);
    lastCam = cam;
    lastTreeH = treeH;
    const setWind = (prog) => {
      gl.uniform1i(prog.u('u_airD'), 2);
      gl.uniform1f(prog.u('u_rustle'), reduceMotion ? air.rustle * 0.4 : air.rustle);
      gl.uniform1i(prog.u('u_airU'), 3);
      gl.uniform4f(prog.u('u_airMap'), air.map[0], air.map[1], air.map[2], air.map[3]);
    };

    const autumnTint = smooth(0, 0.6, st.autumn) * (1 - smooth(0.2, 0.9, st.winter));
    const winterTint = smooth(0, 0.7, st.winter) * (1 - smooth(0, 1, st.bloom));
    let paper = mixc(COLORS.paper, COLORS.paperAutumn, autumnTint);
    paper = mixc(paper, COLORS.paperWinter, winterTint);
    paper = mixc(paper, COLORS.paperSnow, st.snowSky);
    paper = mixc(paper, COLORS.paperBloom, smooth(0, 1, st.bloom) * 0.8);

    // lay out the cast for this frame
    const act = cast.update({
      P: st.P, age: st.age, S: st.S, autumn: st.autumn, fall: st.fall, winter: st.winter, snow: st.snow,
      melt: st.melt, thaw: st.thaw, bloom: st.bloom, shed: st.shed, spring: st.spring, dusk: st.dusk, viewH: cam.viewH,
      cam, time, dt: st.dt || 0, windAmp, treeH, scrollVel: st.scrollVel || 0, paper, TL,
      windAt: (x, y, twig) => windAtJS(x, y, time, windAmp, treeH, twig),
      air: (x, y) => airAtJS(x, y, treeH),
    });
    st.actorEvents = act.events;
    const drawActors = (name, additive) => {
      const L = act.layers[name];
      if (!L.n) return;
      const v = actorVAOs[name];
      gl.useProgram(actorProg.p);
      gl.uniform4f(actorProg.u('u_cam'), cam.cx, cam.cy, cam.halfW, cam.halfH);
      gl.uniform2f(actorProg.u('u_grid'), TreeActors.COLS, TreeActors.ROWS);
      gl.uniform1i(actorProg.u('u_atlas'), 1);
      gl.uniform1f(actorProg.u('u_ppw'), ppw);
      gl.uniform1f(actorProg.u('u_cellPx'), 2.3 * dpr);
      set3(actorProg, 'u_ink', COLORS.ink);
      gl.bindBuffer(gl.ARRAY_BUFFER, v.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, L.data, 0, L.n * cast.FLOATS);
      if (additive) gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(v.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, L.n);
      if (additive) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    };

    gl.viewport(0, 0, W, H);

    // background + ground
    gl.disable(gl.BLEND);
    gl.useProgram(bgProg.p);
    gl.uniform4f(bgProg.u('u_cam'), cam.cx, cam.cy, cam.halfW, cam.halfH);
    gl.uniform2f(bgProg.u('u_res'), W, H);
    set3(bgProg, 'u_paper', paper);
    set3(bgProg, 'u_ink', COLORS.ink);
    const halfSpan = Math.max(0.012, (cam.maxX - cam.minX) / 2);
    const gcx = (cam.minX + cam.maxX) / 2 * 0.5 + 0.02 * smooth(0.2, 1, st.age);
    const grx = halfSpan * 0.92 + 0.008;
    gl.uniform4f(bgProg.u('u_ground'), gcx, grx, grx * 0.075 + 0.0015, lerp(0.5, 0.62, smooth(0, 1, st.age)));
    const trunkR = lerp(tree.rTip, tree.trunkRadius * 1.6, Math.pow(clamp(st.age, 0, 1), 1.6));
    const soil = 1 - smooth(0.06, 0.35, cam.viewH);
    gl.uniform3f(bgProg.u('u_soil'), Math.max(trunkR, 0.0015), soil, 2.4 * dpr);
    gl.uniform2f(bgProg.u('u_snowG'), st.snow, st.thaw);
    set3(bgProg, 'u_snowCol', COLORS.snow);
    set3(bgProg, 'u_snowShade', COLORS.snowShade);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // shadows on the ground, and far-off things behind the tree (geese)
    drawActors('back');

    // the meadow: blades behind the trunk now, the rest after the wood
    const grassShow = smooth(0.18, 0.4, cam.viewH);
    const drawGrass = (vao, first, count, mode) => {
      if (grassShow < 0.01 || count <= 0) return;
      gl.useProgram(grassProg.p);
      gl.uniform4f(grassProg.u('u_cam'), cam.cx, cam.cy, cam.halfW, cam.halfH);
      gl.uniform1f(grassProg.u('u_ppw'), ppw);
      gl.uniform1f(grassProg.u('u_time'), time);
      gl.uniform1f(grassProg.u('u_windAmp'), windAmp);
      gl.uniform1f(grassProg.u('u_treeH'), treeH);
      setWind(grassProg);
      gl.uniform1f(grassProg.u('u_age'), st.age);
      gl.uniform1f(grassProg.u('u_autumn'), st.autumn);
      gl.uniform1f(grassProg.u('u_fall'), st.fall);
      gl.uniform1f(grassProg.u('u_winter'), st.winter);
      gl.uniform1f(grassProg.u('u_newGrass'), st.newGrass);
      gl.uniform1f(grassProg.u('u_mode'), mode);
      gl.uniform1f(grassProg.u('u_show'), grassShow);
      gl.uniform1f(grassProg.u('u_snowDepth'), 0.013 * smooth(0.25, 0.6, st.snow) * (1 - smooth(0.2, 0.8, st.thaw)));
      for (const k of ['fresh', 'deep', 'straw', 'dead', 'shoot']) set3(grassProg, 'u_' + k, COLORS['grass_' + k]);
      set3(grassProg, 'u_ink', COLORS.ink);
      gl.bindVertexArray(vao);
      gl.drawElementsInstanced(gl.TRIANGLES, meadow.indexCount, gl.UNSIGNED_SHORT, 0, count);
      void first;
    };
    drawGrass(meadow.vaos[0], 0, meadow.split, 0);

    // leaves (shared uniforms)
    gl.useProgram(leafProg.p);
    gl.uniform4f(leafProg.u('u_cam'), cam.cx, cam.cy, cam.halfW, cam.halfH);
    gl.uniform1f(leafProg.u('u_age'), st.age);
    gl.uniform1f(leafProg.u('u_S'), st.S);
    gl.uniform1f(leafProg.u('u_autumn'), st.autumn);
    gl.uniform1f(leafProg.u('u_fall'), st.fall);
    gl.uniform1f(leafProg.u('u_winter'), st.winter);
    gl.uniform1f(leafProg.u('u_spring'), st.spring);
    gl.uniform1f(leafProg.u('u_time'), time);
    gl.uniform1f(leafProg.u('u_windAmp'), windAmp);
    gl.uniform1f(leafProg.u('u_treeH'), treeH);
    gl.uniform1f(leafProg.u('u_seedSink'), st.seedSink);
    gl.uniform3f(leafProg.u('u_seedDrop'), st.seedDrop[0], st.seedDrop[1], st.seedDrop[2]);
    setWind(leafProg);
    for (const k of ['leafDark', 'leafLight', 'leafYoung', 'olive', 'gold', 'ochre', 'rust', 'dead', 'seed']) {
      set3(leafProg, 'u_' + k, COLORS[k]);
    }
    set3(leafProg, 'u_paper', paper);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.uniform1i(leafProg.u('u_atlas'), 0);
    gl.uniform1f(leafProg.u('u_mode'), 0);
    gl.bindVertexArray(leafBack);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, tree.leafSplit);

    // cherry blossom and drifting petals (shared uniforms)
    const showBlossom = st.bloom > 0;
    const showPetals = st.rate > 0.001 && st.clock > 0;
    const useFlowers = (prog) => {
      gl.useProgram(prog.p);
      gl.uniform4f(prog.u('u_cam'), cam.cx, cam.cy, cam.halfW, cam.halfH);
      gl.uniform1f(prog.u('u_S'), st.S);
      gl.uniform1f(prog.u('u_time'), time);
      gl.uniform1f(prog.u('u_windAmp'), windAmp);
      gl.uniform1f(prog.u('u_treeH'), treeH);
      setWind(prog);
      gl.uniform1f(prog.u('u_bloom'), st.bloom);
      gl.uniform1f(prog.u('u_shed'), st.shed);
      gl.uniform1f(prog.u('u_rate'), st.rate);
      gl.uniform1f(prog.u('u_clock'), st.clock);
      gl.uniform1f(prog.u('u_gust'), Math.min(0.5, (st.gust || 0) * 0.6));
      for (const k of ['petal', 'petalLight', 'bud', 'accent', 'stamen']) set3(prog, 'u_' + k, COLORS[k]);
      gl.uniform1i(prog.u('u_atlas'), 0);
    };
    if (showBlossom) {
      useFlowers(blossomProg);
      gl.bindVertexArray(blossomBack);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, tree.blossomSplit);
    }
    if (showPetals) {
      useFlowers(petalProg);
      gl.bindVertexArray(petalBack);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, tree.petalSplit);
    }

    // distant snowflakes, behind the tree
    const showSnow = st.snowRate > 0.001 && st.snowOn > 0 && st.snowOff < 16;
    const useSnow = () => {
      gl.useProgram(snowProg.p);
      gl.uniform4f(snowProg.u('u_cam'), cam.cx, cam.cy, cam.halfW, cam.halfH);
      gl.uniform1f(snowProg.u('u_time'), time);
      gl.uniform1f(snowProg.u('u_on'), st.snowOn);
      gl.uniform1f(snowProg.u('u_off'), st.snowOff);
      gl.uniform1f(snowProg.u('u_rate'), st.snowRate);
      gl.uniform1f(snowProg.u('u_ppw'), ppw);
      set3(snowProg, 'u_flake', COLORS.snow);
      set3(snowProg, 'u_flakeRim', COLORS.flakeRim);
    };
    if (showSnow) {
      useSnow();
      gl.bindVertexArray(snow.vaos[0]);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, snow.split);
    }

    // branches
    gl.useProgram(branchProg.p);
    gl.uniform4f(branchProg.u('u_cam'), cam.cx, cam.cy, cam.halfW, cam.halfH);
    gl.uniform1f(branchProg.u('u_age'), st.age);
    gl.uniform1f(branchProg.u('u_S'), st.S);
    gl.uniform1f(branchProg.u('u_ppw'), ppw);
    gl.uniform1f(branchProg.u('u_rTip'), tree.rTip);
    gl.uniform1f(branchProg.u('u_time'), time);
    gl.uniform1f(branchProg.u('u_windAmp'), windAmp);
    gl.uniform1f(branchProg.u('u_treeH'), treeH);
    setWind(branchProg);
    gl.uniform1f(branchProg.u('u_cellPx'), 2.6 * dpr);
    gl.uniform1f(branchProg.u('u_snow'), st.snow);
    gl.uniform1f(branchProg.u('u_melt'), st.melt);
    set3(branchProg, 'u_snowCol', COLORS.snow);
    set3(branchProg, 'u_snowShade', COLORS.snowShade);
    set3(branchProg, 'u_ink', COLORS.ink);
    set3(branchProg, 'u_barkLight', mixc(COLORS.barkLight, paper, 0.15));
    if (st.age >= 0) {
      gl.bindVertexArray(branchVAO);
      gl.drawElements(gl.TRIANGLES, tree.indexCount, gl.UNSIGNED_INT, 0);
    }

    // the near half of the meadow, and new shoots coming up through it in spring
    drawGrass(meadow.vaos[1], meadow.split, meadow.count - meadow.split, 0);
    if (st.newGrass > 0) {
      drawGrass(meadow.vaos[0], 0, meadow.count, 1);
    }

    // leaves in front
    gl.useProgram(leafProg.p);
    gl.bindVertexArray(leafFront);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, tree.leafCount - tree.leafSplit);

    // new leaves unfold as the blossom goes over
    if (st.spring > 0) {
      gl.uniform1f(leafProg.u('u_mode'), 1);
      gl.bindVertexArray(leafBack);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, tree.leafCount);
    }

    if (showBlossom) {
      useFlowers(blossomProg);
      gl.bindVertexArray(blossomFront);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, tree.blossomCount - tree.blossomSplit);
    }
    if (showPetals) {
      useFlowers(petalProg);
      gl.bindVertexArray(petalFront);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, tree.petalCount - tree.petalSplit);
    }
    // the cast in front of the tree
    drawActors('front');

    // close, soft flakes drift in front of everything
    if (showSnow && snow.count > snow.split) {
      useSnow();
      gl.bindVertexArray(snow.vaos[1]);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, snow.count - snow.split);
    }

    // midsummer night: dim everything, then moon, stars and fireflies glow
    if (st.dusk > 0.001) {
      gl.bindVertexArray(emptyVAO);
      gl.useProgram(duskProg.p);
      gl.uniform2f(duskProg.u('u_res'), W, H);
      gl.uniform1f(duskProg.u('u_dusk'), st.dusk);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(nightProg.p);
      gl.uniform2f(nightProg.u('u_res'), W, H);
      const wide = !stackedMQ.matches;
      gl.uniform2f(nightProg.u('u_moon'), W * (wide ? 0.27 : 0.76), H * (wide ? 0.8 : 0.6));
      gl.uniform1f(nightProg.u('u_dusk'), st.dusk);
      gl.uniform1f(nightProg.u('u_time'), time);
      gl.uniform1f(nightProg.u('u_dpr'), dpr);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    drawActors('glow', true);
    gl.bindVertexArray(null);
  }

  // -------------------------------------------------------------------- UI
  const chapters = Array.from(document.querySelectorAll('.chapter')).map((el) => ({
    el, from: parseFloat(el.dataset.from), to: parseFloat(el.dataset.to),
  }));
  const hero = document.getElementById('hero');
  const cue = document.getElementById('cue');
  const ageEl = document.getElementById('age');
  const seasonEl = document.getElementById('season');
  const railFill = document.getElementById('rail-fill');
  const rail = document.querySelector('.rail');
  const railDots = chapters.map((c) => {
    const d = document.createElement('span');
    d.className = 'rail-dot';
    d.style.top = (c.from * 100).toFixed(1) + '%';
    rail.appendChild(d);
    return d;
  });

  const SEASONS = [
    [TL.dusk[0], 'Midsummer night'],
    [TL.dusk[3], 'Late summer'],
    [TL.autumn[0] + 0.03, 'Autumn'],
    [TL.winter[0] + 0.01, 'Winter'],
    [TL.snowfall[0] + 0.01, 'Deep winter'],
    [TL.melt[0], 'Thaw'],
    [TL.bloom[0], 'Spring'],
  ];

  let lastAge = '', lastSeason = '', lastNight = false;
  function updateUI(st) {
    const P = st.P;
    const heroOut = smooth(0.003, 0.02, P);
    hero.style.opacity = (1 - heroOut).toFixed(3);
    hero.style.transform = `translateY(${(-24 * heroOut).toFixed(1)}px)`;
    cue.style.opacity = (1 - smooth(0.0, 0.012, P)).toFixed(3);

    let active = -1;
    chapters.forEach((c, i) => {
      const fin = smooth(c.from, c.from + 0.014, P);
      const fout = i === chapters.length - 1 ? 1 : 1 - smooth(c.to - 0.014, c.to, P);
      const op = fin * fout;
      c.el.style.opacity = op.toFixed(3);
      c.el.style.transform = `translateY(${((1 - fin) * 18 - (1 - fout) * 18).toFixed(1)}px)`;
      c.el.style.visibility = op > 0.001 ? 'visible' : 'hidden';
      if (P >= c.from) active = i;
    });
    railDots.forEach((d, i) => d.classList.toggle('on', i <= active));
    railFill.style.transform = `scaleY(${P.toFixed(4)})`;

    let ageText;
    if (st.age < -0.099) ageText = 'Dormant';
    else if (st.age < 0) ageText = `Day ${Math.max(1, Math.round(lerp(1, 14, (st.age + 0.1) / 0.1)))}`;
    else {
      const years = Math.round(Math.pow(st.age, 1.15) * 100) + (P >= TL.bloom[0] ? 1 : 0);
      ageText = years < 1 ? 'First spring' : `${years} ${years === 1 ? 'year' : 'years'}`;
    }
    let season = 'Spring';
    if (st.age >= 0) season = st.age < 1 ? 'Growing seasons' : 'Summer';
    for (const [p, name] of SEASONS) if (P >= p) season = name;
    if (st.age < 0) season = st.age < -0.099 ? 'Late winter' : 'Early spring';
    if (ageText !== lastAge) { ageEl.textContent = ageText; lastAge = ageText; }
    if (season !== lastSeason) { seasonEl.textContent = season; lastSeason = season; }
    const night = st.dusk > 0.45;
    if (night !== lastNight) { document.documentElement.classList.toggle('night', night); lastNight = night; }
  }

  // ------------------------------------------------------------ main loop
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function scrollTarget() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
  }

  let P = scrollTarget();
  let last = performance.now();
  let gust = 0;
  let slowFrames = 0, fastFrames = 0;

  function adaptQuality(dt) {
    if (document.hidden || dt <= 0 || dt > 0.25) return;
    if (dt > 1 / 45) { slowFrames++; fastFrames = 0; } else { fastFrames++; slowFrames = Math.max(0, slowFrames - 1); }
    if (slowFrames > 40 && quality > 0.55) { quality = Math.max(0.55, quality * 0.85); slowFrames = 0; }
    else if (fastFrames > 600 && quality < 1) { quality = Math.min(1, quality / 0.9); fastFrames = 0; }
  }

  function frame(now) {
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    adaptQuality(rawDt);
    const target = scrollTarget();
    const prev = P;
    P += (target - P) * (1 - Math.exp(-dt * (reduceMotion ? 12 : 4.2)));
    if (Math.abs(target - P) < 1e-5) P = target;
    const vel = dt > 0 ? Math.abs(P - prev) / dt : 0;
    gust += (Math.min(1, vel * 8) - gust) * (1 - Math.exp(-dt * 2.5));

    const tick = Math.min(rawDt, 0.5);
    if (P >= TL.shower) showerClock += tick;
    else showerClock = Math.max(0, showerClock - dt * 12);
    if (P < TL.snowfall[0]) { snowOn = Math.max(0, snowOn - dt * 12); snowOff = 0; }
    else if (P <= TL.snowfall[1]) { snowOn += tick; snowOff = Math.max(0, snowOff - dt * 12); }
    else { snowOn += tick; snowOff += tick; }

    // the cursor drags the air: its speed comes from how far the pointer
    // really moved on screen (not from the camera zooming under it)
    let cur = null;
    if (lastCam && interact.sx >= 0 && dt > 0) {
      const toWorld = (2 * lastCam.halfH) / window.innerHeight;
      const k = 1 - Math.exp(-dt * 18);
      interact.vx += ((interact.ax * toWorld) / dt - interact.vx) * k;
      interact.vy += ((-interact.ay * toWorld) / dt - interact.vy) * k;
      interact.ax = 0; interact.ay = 0;
      if (now - interact.seen > 140) { interact.vx *= 0.5; interact.vy *= 0.5; }
      const wx = lastCam.cx + ((interact.sx / window.innerWidth) * 2 - 1) * lastCam.halfW;
      const wy = lastCam.cy + (1 - (interact.sy / window.innerHeight) * 2) * lastCam.halfH;
      const th = Math.max(lastTreeH, 0.02), m = reduceMotion ? 0.3 : 1;
      cur = { x: wx / th, y: wy / th, vx: (interact.vx / th) * m, vy: (interact.vy / th) * m };
    }
    air.step(dt, cur);
    uploadAir();

    const st = stateAt(P);
    st.gust = gust;
    st.dt = dt;
    st.scrollVel = vel;
    st.seedDrop = seedDrop(now / 1000 - seedT0);
    if (reduceMotion) { st.rate *= 0.35; st.snowRate *= 0.35; }
    const seasonWind = (1 + 0.45 * smooth(0, 0.5, st.fall) * (1 - smooth(0, 1, st.winter))) * (1 - 0.45 * st.snowSky);
    const windAmp = (reduceMotion ? 0.004 : 0.0105) * seasonWind * (1 + gust * 0.9);
    render(st, now / 1000, windAmp);
    updateUI(st);

    // soundscape
    if (sound.on) {
      const ev = st.actorEvents || [];
      const leafy = smooth(0.25, 0.6, st.age) * (1 - smooth(0.3, 0.95, st.fall));
      const blossomy = smooth(0.2, 0.6, st.bloom) * 0.7 + st.spring * 0.3;
      const summer = smooth(0.3, 0.5, st.age) * (1 - smooth(0, 0.3, st.dusk)) * (1 - smooth(0, 0.4, st.autumn));
      sound.update({
        wind: clamp(windAmp / 0.0105 - 0.4, 0, 1.2), gust: Math.max(gust, clamp(air.energy * 0.7, 0, 1.2)),
        foliage: Math.max(leafy, blossomy), snowing: st.snowSky,
        birds: Math.max(summer * 0.8, ev.includes('birds') ? 1 : 0, 0.25 * smooth(0, 0.3, st.autumn) * (1 - st.winter)),
        cardinal: st.snow > 0.6 && st.melt < 0.1, crickets: ev.includes('crickets') ? st.dusk : 0,
      });
      if (ev.includes('creak')) sound.creak();
      if (ev.includes('geese')) sound.geese();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => { resize(); measureText(); });

  // ------------------------------------------------------- touch the tree
  const sound = TreeSound.create();
  const soundBtn = document.getElementById('sound');
  const soundLabel = soundBtn && soundBtn.querySelector('.sound-label');
  if (soundBtn) {
    soundBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const on = await sound.setOn(!sound.on);
      soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (soundLabel) soundLabel.textContent = on ? 'Sound on' : 'Sound off';
    });
  }
  window.addEventListener('pointermove', (e) => {
    if (interact.sx >= 0) { interact.ax += e.clientX - interact.sx; interact.ay += e.clientY - interact.sy; }
    interact.sx = e.clientX; interact.sy = e.clientY; interact.seen = performance.now();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { interact.sx = -1; interact.vx = interact.vy = 0; });
  window.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('button, a')) return;
    const t = performance.now() / 1000;
    const st = stateAt(P);
    let cx = 0, cy = 0;
    if (lastCam) {
      cx = lastCam.cx + ((e.clientX / window.innerWidth) * 2 - 1) * lastCam.halfW;
      cy = lastCam.cy + (1 - (e.clientY / window.innerHeight) * 2) * lastCam.halfH;
    }
    // a rustle: the leaves and twigs shiver; the trunk and limbs don't move
    air.shake(1);
    const kind = cast.shake({ ...st, time: t, clickX: cx, clickY: cy });
    sound.shake(kind);
    document.documentElement.classList.add('touched');
  });
  measureText();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureText);
  document.documentElement.classList.add('ready');
  requestAnimationFrame(frame);

  // Deep links: ?p=0.5 jumps to that point of the lifecycle.
  const q = new URLSearchParams(location.search).get('p');
  if (q !== null) {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const go = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, clamp(parseFloat(q) || 0, 0, 1) * max);
      P = scrollTarget();
      if (P > 0.01) seedT0 = -1e3;
    };
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
  }
  window.__tree = {
    jump(p) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, clamp(p, 0, 1) * max);
      P = scrollTarget();
    },
    dropSeed() { seedT0 = performance.now() / 1000; },
    setQuality(q) { quality = q; slowFrames = fastFrames = 0; },
    cast,
    air,
    snap(x, y, w, h, k) {
      const st = stateAt(P);
      st.seedDrop = seedDrop(performance.now() / 1000 - seedT0);
      render(st, performance.now() / 1000, 0.0105);
      let c = document.getElementById('__snap');
      if (!c) {
        c = document.createElement('canvas');
        c.id = '__snap';
        c.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#fff;outline:1px solid red';
        document.body.appendChild(c);
        c.onclick = () => c.remove();
      }
      k = k || 2;
      c.width = w * k; c.height = h * k;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * k, h * k);
      c.style.width = (w * k) + 'px'; c.style.height = (h * k) + 'px';
    },
    unsnap() { const c = document.getElementById('__snap'); if (c) c.remove(); },
    setClock(t) { showerClock = t; snowOn = t; },
    bench(n) {
      const st = stateAt(P), px = new Uint8Array(4);
      st.seedDrop = [0, 0, 0];
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        render(st, i / 60, 0.0105);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - t0) / n;
    },
    // GPU time of one frame in ms (EXT_disjoint_timer_query_webgl2), or null
    async gpuTime(n) {
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!ext) return null;
      const st = stateAt(P), times = [];
      st.seedDrop = [0, 0, 0];
      for (let i = 0; i < (n || 5); i++) {
        const q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        render(st, i / 60, 0.0105);
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) {
          await new Promise((r) => setTimeout(r, 10));
        }
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      times.sort((a, b) => a - b);
      return times.length ? times[times.length >> 1] : null;
    },
    actorAtlas: actorCanvas,
    stats: { branches: tree.branchCount, leaves: tree.leafCount, blossoms: tree.blossomCount, petals: tree.petalCount, vertices: tree.vertexCount },
    atlas: atlasCanvas,
  };
})();
