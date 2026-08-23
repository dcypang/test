/**
 * Every texture in the game is drawn at runtime on a 2D canvas.
 *
 * That keeps the repository free of binary assets and lets the road markings,
 * building windows and so on adapt per track, at the cost of a few hundred
 * milliseconds during load. Results are cached by key.
 */

import * as THREE from 'three';
import { makeCanvas, makeRng, grainOverlay, blotches, rand, clamp, TAU } from './util.js';

const cache = new Map();

/**
 * Global multiplier on procedural texture resolution, set from the quality
 * tier before any texture is built. 1 = the authored size.
 */
let RES = 1;

export function setTextureScale(scale) {
  const next = Math.max(0.25, Math.min(2, scale || 1));
  if (next === RES) return;
  RES = next;
  disposeTextures();
}

/** Authored size scaled by the current tier, rounded to a power of two. */
function px(base) {
  const v = Math.round(base * RES);
  return Math.max(16, 2 ** Math.round(Math.log2(v)));
}

/**
 * Derive a tangent-space normal map from a colour canvas.
 *
 * A Sobel gradient over perceived luminance is not physically meaningful, but
 * for surfaces whose colour variation *is* their height variation — asphalt
 * aggregate, gravel, grass, concrete — it reads convincingly and costs one
 * pass over the pixels rather than a second authored texture.
 */
function normalFromCanvas(source, strength = 1.6) {
  const w = source.width;
  const h = source.height;
  const src = source.getContext('2d').getImageData(0, 0, w, h).data;

  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    lum[p] = (src[i] * 0.2126 + src[i + 1] * 0.7152 + src[i + 2] * 0.0722) / 255;
  }

  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => lum[((y + h) % h) * w + ((x + w) % w)];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel, wrapping at the edges so tiled textures stay seamless.
      const dx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));

      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len;
      const nzn = nz / len;

      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nzn * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function finish(canvas, { repeat = [1, 1], srgb = true, aniso = 4, wrapU, wrapV } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = wrapU ?? THREE.RepeatWrapping;
  tex.wrapT = wrapV ?? THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

export function disposeTextures() {
  for (const tex of cache.values()) {
    if (Array.isArray(tex)) tex.forEach((t) => t.dispose?.());
    else tex.dispose?.();
  }
  cache.clear();
}

/* ------------------------------------------------------------------
   Road surface
   ------------------------------------------------------------------ */

/**
 * One tile spans the full road width horizontally and 32 m along its length.
 * Markings are baked in, which avoids a second pass of decal geometry.
 *
 * Lane layout (14.4 m of asphalt): shoulder line, two lanes, double yellow
 * centre, two lanes, shoulder line — the layout in the reference footage.
 */
export function roadTexture({ wet = false, aniso = 8 } = {}) {
  return cached(`road:${wet}:${aniso}:${RES}`, () => {
    const W = px(1024);
    const H = px(2048);
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rng = makeRng(9137);

    ctx.fillStyle = wet ? '#1e2227' : '#35383d';
    ctx.fillRect(0, 0, W, H);

    // ---- aggregate ----------------------------------------------------
    // Individual chips of stone are what make asphalt read as asphalt rather
    // than as grey noise, and they give the normal map something to bite on.
    const chips = Math.round(W * H / 190);
    for (let i = 0; i < chips; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const r = rand(rng, 0.6, 2.6) * (W / 1024);
      const shade = rand(rng, 0.55, 1.5);
      const base = wet ? 40 : 62;
      const v = Math.round(base * shade);
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 5},${rand(rng, 0.25, 0.75)})`;
      ctx.beginPath();
      // Slightly irregular chips beat perfect circles at this density.
      ctx.ellipse(x, y, r, r * rand(rng, 0.6, 1.4), rng() * TAU, 0, TAU);
      ctx.fill();
    }

    // Long-grain streaks left by traffic wear.
    for (let i = 0; i < 420; i++) {
      ctx.globalAlpha = rand(rng, 0.03, 0.1);
      ctx.fillStyle = rng() > 0.5 ? '#4b4f55' : '#282b30';
      ctx.fillRect(rng() * W, rng() * H, rand(rng, 1, 5) * (W / 1024), rand(rng, 60, 520));
    }
    ctx.globalAlpha = 1;

    // Darker polished wheel tracks in each lane.
    const laneCentres = [0.185, 0.375, 0.625, 0.815];
    for (const lc of laneCentres) {
      const g = ctx.createLinearGradient((lc - 0.095) * W, 0, (lc + 0.095) * W, 0);
      g.addColorStop(0, 'rgba(20,22,26,0)');
      g.addColorStop(0.5, wet ? 'rgba(10,12,16,0.6)' : 'rgba(28,30,34,0.52)');
      g.addColorStop(1, 'rgba(20,22,26,0)');
      ctx.fillStyle = g;
      ctx.fillRect((lc - 0.095) * W, 0, 0.19 * W, H);
    }

    blotches(ctx, W, H, 70, rng,
      (r) => (r() > 0.5 ? 'rgba(20,21,24,ALPHA)' : 'rgba(76,78,82,ALPHA)'), 26, 130);

    // ---- tar seams ----------------------------------------------------
    // Repair lines: glossy black snakes that catch the light differently from
    // the surrounding surface.
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(14,15,18,${rand(rng, 0.5, 0.85)})`;
      ctx.lineWidth = rand(rng, 3, 9) * (W / 1024);
      ctx.beginPath();
      let x = rng() * W;
      let y = rng() * H;
      ctx.moveTo(x, y);
      const steps = Math.floor(rand(rng, 4, 12));
      for (let s = 0; s < steps; s++) {
        x += rand(rng, -70, 70);
        y += rand(rng, 40, 180);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // ---- cracks -------------------------------------------------------
    for (let i = 0; i < 30; i++) {
      ctx.strokeStyle = `rgba(20,21,24,${rand(rng, 0.18, 0.4)})`;
      ctx.lineWidth = rand(rng, 0.7, 1.8) * (W / 1024);
      ctx.beginPath();
      let x = rng() * W;
      let y = rng() * H;
      ctx.moveTo(x, y);
      const steps = Math.floor(rand(rng, 3, 9));
      for (let s = 0; s < steps; s++) {
        x += rand(rng, -60, 60);
        y += rand(rng, 20, 90);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // ---- patches ------------------------------------------------------
    // Rectangular resurfacing squares, slightly off-colour from the rest.
    for (let i = 0; i < 5; i++) {
      const pw = rand(rng, 0.12, 0.4) * W;
      const ph = rand(rng, 0.03, 0.1) * H;
      ctx.fillStyle = `rgba(${wet ? 30 : 52},${wet ? 33 : 55},${wet ? 38 : 60},${rand(rng, 0.3, 0.6)})`;
      ctx.fillRect(rng() * W, rng() * H, pw, ph);
    }

    grainOverlay(ctx, W, H, wet ? 10 : 15, rng);

    // ---- markings ------------------------------------------------------
    const paint = wet ? 'rgba(226,230,235,0.8)' : 'rgba(238,242,246,0.9)';
    const yellow = wet ? 'rgba(224,180,62,0.84)' : 'rgba(240,196,72,0.94)';

    ctx.fillStyle = paint;
    ctx.fillRect(0.035 * W, 0, 0.014 * W, H);
    ctx.fillRect(0.951 * W, 0, 0.014 * W, H);

    // Dashed white lane dividers (3 m stripe, 6 m gap over a 32 m tile).
    const dash = H * (3 / 32);
    const gap = H * (6 / 32);
    for (const x of [0.28, 0.72]) {
      for (let y = 0; y < H; y += dash + gap) {
        ctx.fillRect(x * W - 0.007 * W, y, 0.014 * W, dash);
      }
    }

    ctx.fillStyle = yellow;
    ctx.fillRect(0.484 * W, 0, 0.013 * W, H);
    ctx.fillRect(0.503 * W, 0, 0.013 * W, H);

    // Scuff the paint so it doesn't look freshly applied: worn patches, and
    // aggregate showing through where tyres have polished it away.
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = wet ? '#1e2227' : '#35383d';
    for (let i = 0; i < 520; i++) {
      ctx.fillRect(rng() * W, rng() * H, rand(rng, 2, 12) * (W / 1024), rand(rng, 3, 22));
    }
    ctx.globalAlpha = 1;

    cache.set(`roadNormal:${wet}:${RES}`,
      finish(normalFromCanvas(canvas, 1.5), { srgb: false, aniso }));

    return finish(canvas, { repeat: [1, 1], aniso });
  });
}

/** Normal map matching `roadTexture`. Built as a side effect of the colour map. */
export function roadNormalTexture({ wet = false, aniso = 8 } = {}) {
  const key = `roadNormal:${wet}:${RES}`;
  if (!cache.has(key)) roadTexture({ wet, aniso });
  return cache.get(key);
}

/** Roughness map for the road: puddles read as dark (smooth) patches. */
export function roadRoughnessTexture({ wet = false } = {}) {
  return cached(`roadRough:${wet}:${RES}`, () => {
    const W = px(512);
    const H = px(1024);
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rng = makeRng(4421);

    ctx.fillStyle = wet ? '#3a3a3a' : '#c8c8c8';
    ctx.fillRect(0, 0, W, H);

    if (wet) {
      // Puddles: very low roughness, so the sky and lights mirror in them.
      blotches(ctx, W, H, 48, rng, () => 'rgba(6,6,6,ALPHA)', 16, 70);
      // Wheel tracks stay wetter than the crown of the road.
      for (const lc of [0.185, 0.375, 0.625, 0.815]) {
        const g = ctx.createLinearGradient((lc - 0.08) * W, 0, (lc + 0.08) * W, 0);
        g.addColorStop(0, 'rgba(30,30,30,0)');
        g.addColorStop(0.5, 'rgba(20,20,20,0.75)');
        g.addColorStop(1, 'rgba(30,30,30,0)');
        ctx.fillStyle = g;
        ctx.fillRect((lc - 0.08) * W, 0, 0.16 * W, H);
      }
    } else {
      blotches(ctx, W, H, 30, rng, () => 'rgba(160,160,160,ALPHA)', 10, 44);
    }
    grainOverlay(ctx, W, H, 16, rng);
    return finish(canvas, { srgb: false, aniso: 4 });
  });
}

/* ------------------------------------------------------------------
   Ground cover
   ------------------------------------------------------------------ */

export function grassTexture(palette = 'summer') {
  return cached(`grass:${palette}:${RES}`, () => {
    const S = px(1024);
    const canvas = makeCanvas(S);
    const ctx = canvas.getContext('2d');
    const rng = makeRng(palette === 'dry' ? 771 : 5512);

    const base = palette === 'dry' ? '#8c8351' : '#4e6b33';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);

    const tints = palette === 'dry'
      ? ['rgba(160,148,92,ALPHA)', 'rgba(104,96,58,ALPHA)', 'rgba(126,124,74,ALPHA)']
      : ['rgba(96,124,58,ALPHA)', 'rgba(52,76,38,ALPHA)', 'rgba(74,102,44,ALPHA)'];
    blotches(ctx, S, S, 90, rng, (r) => tints[Math.floor(r() * tints.length)], 18, 90);

    // Short strokes suggest blades without needing geometry.
    for (let i = 0; i < 2600; i++) {
      const x = rng() * S;
      const y = rng() * S;
      ctx.strokeStyle = tints[Math.floor(rng() * tints.length)].replace('ALPHA', String(rand(rng, 0.15, 0.5)));
      ctx.lineWidth = rand(rng, 0.6, 1.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rand(rng, -3, 3), y - rand(rng, 2, 7));
      ctx.stroke();
    }
    grainOverlay(ctx, S, S, 12, rng);
    cache.set(`grassNormal:${palette}:${RES}`,
      finish(normalFromCanvas(canvas, 1.1), { srgb: false, aniso: 4 }));
    return finish(canvas, { repeat: [1, 1], aniso: 4 });
  });
}

/** Normal map matching `grassTexture`. */
export function grassNormalTexture(palette = 'summer') {
  const key = `grassNormal:${palette}:${RES}`;
  if (!cache.has(key)) grassTexture(palette);
  return cache.get(key);
}

export function dirtTexture() {
  return cached(`dirt:${RES}`, () => {
    const S = px(512);
    const canvas = makeCanvas(S);
    const ctx = canvas.getContext('2d');
    const rng = makeRng(3311);
    ctx.fillStyle = '#6b5f4c';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, S, S, 60, rng,
      (r) => (r() > 0.5 ? 'rgba(122,110,90,ALPHA)' : 'rgba(74,66,52,ALPHA)'), 8, 44);
    // Loose gravel.
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${140 + rng() * 60 | 0},${128 + rng() * 55 | 0},${104 + rng() * 50 | 0},${rand(rng, 0.2, 0.6)})`;
      ctx.beginPath();
      ctx.arc(rng() * S, rng() * S, rand(rng, 0.5, 2), 0, TAU);
      ctx.fill();
    }
    grainOverlay(ctx, S, S, 16, rng);
    cache.set(`dirtNormal:${RES}`, finish(normalFromCanvas(canvas, 1.9), { srgb: false }));
    return finish(canvas);
  });
}

/** Normal map matching `dirtTexture`. */
export function dirtNormalTexture() {
  const key = `dirtNormal:${RES}`;
  if (!cache.has(key)) dirtTexture();
  return cache.get(key);
}

export function concreteTexture() {
  return cached(`concrete:${RES}`, () => {
    const S = px(512);
    const canvas = makeCanvas(S);
    const ctx = canvas.getContext('2d');
    const rng = makeRng(8123);
    ctx.fillStyle = '#9a9a96';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, S, S, 40, rng,
      (r) => (r() > 0.5 ? 'rgba(168,168,164,ALPHA)' : 'rgba(122,122,120,ALPHA)'), 10, 50);
    // Expansion joints.
    ctx.strokeStyle = 'rgba(92,92,90,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
    grainOverlay(ctx, S, S, 14, rng);
    cache.set(`concreteNormal:${RES}`, finish(normalFromCanvas(canvas, 1.2), { srgb: false }));
    return finish(canvas);
  });
}

/** Normal map matching `concreteTexture`. */
export function concreteNormalTexture() {
  const key = `concreteNormal:${RES}`;
  if (!cache.has(key)) concreteTexture();
  return cache.get(key);
}

/* ------------------------------------------------------------------
   Buildings
   ------------------------------------------------------------------ */

/**
 * A facade tile: `cols` x `rows` windows on a concrete field.
 * Returns { map, emissive } so the night city can glow without a second draw.
 */
export function buildingTextures(variant = 0, lit = true) {
  return cached(`building:${variant}:${lit}:${RES}`, () => {
    const W = px(512);
    const H = px(1024);
    const rng = makeRng(1000 + variant * 37);

    const cols = [6, 8, 5, 7][variant % 4];
    const rows = [14, 18, 11, 16][variant % 4];
    const bodyColors = ['#4a4f57', '#3c4149', '#5a5148', '#43484f'];

    const map = makeCanvas(W, H);
    const mctx = map.getContext('2d');
    const emi = makeCanvas(W, H);
    const ectx = emi.getContext('2d');

    mctx.fillStyle = bodyColors[variant % 4];
    mctx.fillRect(0, 0, W, H);
    ectx.fillStyle = '#000';
    ectx.fillRect(0, 0, W, H);

    blotches(mctx, W, H, 26, rng, () => 'rgba(30,32,36,ALPHA)', 20, 80);

    const padX = W * 0.08;
    const padY = H * 0.02;
    const cw = (W - padX * 2) / cols;
    const ch = (H - padY * 2) / rows;
    const winW = cw * 0.66;
    const winH = ch * 0.6;

    // Mullion bands between floors.
    mctx.fillStyle = 'rgba(28,30,34,0.55)';
    for (let r = 0; r <= rows; r++) {
      mctx.fillRect(0, padY + r * ch - ch * 0.06, W, ch * 0.12);
    }

    const warm = ['#ffd9a0', '#ffc978', '#ffe6bd', '#c9e2ff', '#ffb765'];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = padX + c * cw + (cw - winW) / 2;
        const y = padY + r * ch + (ch - winH) / 2;

        // Dark glass in the daytime map.
        mctx.fillStyle = `rgba(${18 + rng() * 22 | 0},${24 + rng() * 26 | 0},${34 + rng() * 30 | 0},0.95)`;
        mctx.fillRect(x, y, winW, winH);
        // Sky reflection highlight along the top of each pane.
        mctx.fillStyle = 'rgba(150,180,215,0.16)';
        mctx.fillRect(x, y, winW, winH * 0.34);

        if (lit && rng() < 0.42) {
          const c1 = warm[Math.floor(rng() * warm.length)];
          const a = rand(rng, 0.55, 1);
          ectx.fillStyle = c1;
          ectx.globalAlpha = a;
          ectx.fillRect(x, y, winW, winH);
          // Occasional half-drawn blind.
          if (rng() < 0.3) {
            ectx.globalAlpha = a * 0.35;
            ectx.fillStyle = '#000';
            ectx.fillRect(x, y, winW, winH * rand(rng, 0.2, 0.55));
          }
          ectx.globalAlpha = 1;
        }
      }
    }

    grainOverlay(mctx, W, H, 10, rng);

    return {
      map: finish(map, { aniso: 4 }),
      emissive: finish(emi, { aniso: 4 }),
      // Mullions and window reveals get real relief from this rather than
      // reading as a flat photograph pasted onto a box.
      normal: finish(normalFromCanvas(map, 2.2), { srgb: false, aniso: 4 }),
    };
  });
}

/* ------------------------------------------------------------------
   Sprites & particles
   ------------------------------------------------------------------ */

/** Radial falloff used for light pools, headlight glare and smoke puffs. */
export function glowTexture(hardness = 0.0) {
  return cached(`glow:${hardness}`, () => {
    const S = 128;
    const canvas = makeCanvas(S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.5 * hardness, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return finish(canvas, { wrapU: THREE.ClampToEdgeWrapping, wrapV: THREE.ClampToEdgeWrapping });
  });
}

/** A single vertical rain streak, brightest in the middle. */
export function rainTexture() {
  return cached('rain', () => {
    const W = 16;
    const H = 64;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(190,210,235,0)');
    g.addColorStop(0.5, 'rgba(210,228,248,0.85)');
    g.addColorStop(1, 'rgba(190,210,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(W * 0.35, 0, W * 0.3, H);
    return finish(canvas, { wrapU: THREE.ClampToEdgeWrapping, wrapV: THREE.ClampToEdgeWrapping });
  });
}

/** Soft dark ellipse used as the bike's contact shadow on low tiers. */
export function blobShadowTexture() {
  return cached('blob', () => {
    const S = 128;
    const canvas = makeCanvas(S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return finish(canvas, {
      srgb: false,
      wrapU: THREE.ClampToEdgeWrapping,
      wrapV: THREE.ClampToEdgeWrapping,
    });
  });
}

/** Billboard foliage for broadleaf trees — a clump of translucent leaf blobs. */
export function foliageTexture() {
  return cached('foliage', () => {
    const S = 128;
    const canvas = makeCanvas(S);
    const ctx = canvas.getContext('2d');
    const rng = makeRng(6621);
    ctx.clearRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const a = rng() * TAU;
      const rad = Math.pow(rng(), 0.6) * S * 0.44;
      const x = S / 2 + Math.cos(a) * rad;
      const y = S / 2 + Math.sin(a) * rad * 0.9;
      const r = rand(rng, 6, 17);
      const shade = 40 + rng() * 60;
      ctx.fillStyle = `rgba(${shade * 0.5 | 0},${shade + 34 | 0},${shade * 0.45 | 0},${rand(rng, 0.55, 0.95)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    return finish(canvas, {
      wrapU: THREE.ClampToEdgeWrapping,
      wrapV: THREE.ClampToEdgeWrapping,
    });
  });
}

/** Distant ridge line drawn straight into the sky dome as a backdrop. */
export function mountainTexture(tint = '#5c6b7a') {
  return cached(`mountain:${tint}`, () => {
    const W = 2048;
    const H = 256;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rng = makeRng(2288);

    ctx.clearRect(0, 0, W, H);

    // Three overlapping ridges, each paler and lower than the one in front.
    for (let layer = 2; layer >= 0; layer--) {
      const baseY = H * (0.42 + layer * 0.13);
      const amp = H * (0.42 - layer * 0.09);
      const alpha = 0.95 - layer * 0.24;
      ctx.beginPath();
      ctx.moveTo(0, H);
      let y = baseY;
      for (let x = 0; x <= W; x += 8) {
        const n =
          Math.sin(x * 0.0031 + layer * 2.1) * 0.55 +
          Math.sin(x * 0.0092 + layer * 5.3) * 0.3 +
          Math.sin(x * 0.021 + layer) * 0.15;
        y = baseY - n * amp + rand(rng, -2, 2);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, H * 0.1, 0, H);
      g.addColorStop(0, tint);
      g.addColorStop(1, layer === 0 ? '#38424e' : tint);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return finish(canvas, {
      wrapU: THREE.RepeatWrapping,
      wrapV: THREE.ClampToEdgeWrapping,
      aniso: 4,
    });
  });
}

/** Car body paint: flat colour with a subtle clear-coat gradient. */
export function carPaintTexture() {
  return cached('carPaint', () => {
    const S = 64;
    const canvas = makeCanvas(S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#e8e8e8');
    g.addColorStop(1, '#c4c4c4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return finish(canvas, { aniso: 2 });
  });
}
