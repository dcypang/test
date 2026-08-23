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
  return cached(`road:${wet}:${aniso}`, () => {
    const W = 512;
    const H = 1024;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rng = makeRng(9137);

    ctx.fillStyle = wet ? '#22262b' : '#3a3d42';
    ctx.fillRect(0, 0, W, H);

    // Long-grain streaks left by traffic wear.
    for (let i = 0; i < 260; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const h = rand(rng, 30, 260);
      ctx.globalAlpha = rand(rng, 0.03, 0.11);
      ctx.fillStyle = rng() > 0.5 ? '#4b4f55' : '#2b2e33';
      ctx.fillRect(x, y, rand(rng, 1, 4), h);
    }
    ctx.globalAlpha = 1;

    // Darker polished wheel tracks in each lane.
    const laneCentres = [0.185, 0.375, 0.625, 0.815];
    for (const lc of laneCentres) {
      const g = ctx.createLinearGradient((lc - 0.09) * W, 0, (lc + 0.09) * W, 0);
      g.addColorStop(0, 'rgba(20,22,26,0)');
      g.addColorStop(0.5, wet ? 'rgba(12,14,18,0.55)' : 'rgba(30,32,36,0.5)');
      g.addColorStop(1, 'rgba(20,22,26,0)');
      ctx.fillStyle = g;
      ctx.fillRect((lc - 0.09) * W, 0, 0.18 * W, H);
    }

    blotches(ctx, W, H, 40, rng,
      (r) => (r() > 0.5 ? 'rgba(24,25,28,ALPHA)' : 'rgba(70,72,76,ALPHA)'), 14, 60);

    // Cracks and patch seams.
    ctx.strokeStyle = 'rgba(22,23,26,0.5)';
    for (let i = 0; i < 26; i++) {
      ctx.lineWidth = rand(rng, 0.8, 2.2);
      ctx.beginPath();
      let x = rng() * W;
      let y = rng() * H;
      ctx.moveTo(x, y);
      const steps = Math.floor(rand(rng, 3, 9));
      for (let s = 0; s < steps; s++) {
        x += rand(rng, -34, 34);
        y += rand(rng, 12, 48);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    grainOverlay(ctx, W, H, wet ? 12 : 18, rng);

    // ---- markings ----------------------------------------------------
    const paint = wet ? 'rgba(228,232,236,0.82)' : 'rgba(238,242,246,0.92)';
    const yellow = wet ? 'rgba(226,182,64,0.85)' : 'rgba(240,196,72,0.95)';

    // Solid white edge lines.
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

    // Double yellow centre line.
    ctx.fillStyle = yellow;
    ctx.fillRect(0.484 * W, 0, 0.013 * W, H);
    ctx.fillRect(0.503 * W, 0, 0.013 * W, H);

    // Scuff the paint so it doesn't look freshly applied.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = wet ? '#22262b' : '#3a3d42';
    for (let i = 0; i < 200; i++) {
      ctx.fillRect(rng() * W, rng() * H, rand(rng, 2, 9), rand(rng, 2, 14));
    }
    ctx.globalAlpha = 1;

    return finish(canvas, { repeat: [1, 1], aniso });
  });
}

/** Roughness map for the road: puddles read as dark (smooth) patches. */
export function roadRoughnessTexture({ wet = false } = {}) {
  return cached(`roadRough:${wet}`, () => {
    const W = 256;
    const H = 512;
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
  return cached(`grass:${palette}`, () => {
    const S = 512;
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
    return finish(canvas, { repeat: [1, 1], aniso: 4 });
  });
}

export function dirtTexture() {
  return cached('dirt', () => {
    const S = 256;
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
    return finish(canvas);
  });
}

export function concreteTexture() {
  return cached('concrete', () => {
    const S = 256;
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
    return finish(canvas);
  });
}

/* ------------------------------------------------------------------
   Buildings
   ------------------------------------------------------------------ */

/**
 * A facade tile: `cols` x `rows` windows on a concrete field.
 * Returns { map, emissive } so the night city can glow without a second draw.
 */
export function buildingTextures(variant = 0, lit = true) {
  return cached(`building:${variant}:${lit}`, () => {
    const W = 256;
    const H = 512;
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
