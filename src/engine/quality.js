/**
 * Device tiering and the adaptive-resolution controller.
 *
 * Mobile GPUs vary by more than an order of magnitude, so rather than guessing
 * once from the user agent we start at a conservative estimate and then let a
 * running frame-time average push the render scale up or down.
 */

import { clamp } from './util.js';

const TIERS = {
  low: {
    name: 'low',
    maxPixelRatio: 1.0,
    shadows: false,
    shadowMapSize: 512,
    drawDistance: 420,
    treeDensity: 0.45,
    trafficCount: 8,
    rainCount: 900,
    reflections: false,
    lightPools: false,
    anisotropy: 2,
    sparks: false,
    // --- rendering ---
    postFx: 'off',          // no composer at all: straight to the canvas
    bloom: false,
    motionBlur: false,
    grain: false,
    antialias: 'none',
    normalMaps: false,
    textureScale: 0.5,      // multiplier on procedural texture resolution
    clearcoat: false,
    lightStreaks: false,
    roadColumns: 5,
    facadeDetail: false,
  },
  medium: {
    name: 'medium',
    maxPixelRatio: 1.35,
    shadows: true,
    shadowMapSize: 1024,
    drawDistance: 620,
    treeDensity: 0.75,
    trafficCount: 12,
    rainCount: 1800,
    reflections: true,
    lightPools: true,
    anisotropy: 4,
    sparks: true,
    postFx: 'on',
    bloom: true,
    motionBlur: true,
    grain: true,
    antialias: 'fxaa',
    normalMaps: true,
    textureScale: 1,
    clearcoat: false,
    lightStreaks: true,
    roadColumns: 7,
    facadeDetail: false,
  },
  high: {
    name: 'high',
    maxPixelRatio: 2.0,
    shadows: true,
    shadowMapSize: 2048,
    drawDistance: 900,
    treeDensity: 1.0,
    trafficCount: 16,
    rainCount: 3000,
    reflections: true,
    lightPools: true,
    anisotropy: 8,
    sparks: true,
    postFx: 'on',
    bloom: true,
    motionBlur: true,
    grain: true,
    antialias: 'smaa',
    normalMaps: true,
    textureScale: 1,
    clearcoat: true,
    lightStreaks: true,
    roadColumns: 9,
    facadeDetail: true,
  },
  ultra: {
    name: 'ultra',
    maxPixelRatio: 2.0,
    shadows: true,
    shadowMapSize: 4096,
    drawDistance: 1200,
    treeDensity: 1.35,
    trafficCount: 20,
    rainCount: 4200,
    reflections: true,
    lightPools: true,
    anisotropy: 16,
    sparks: true,
    postFx: 'ultra',        // adds MSAA on the HDR target
    bloom: true,
    motionBlur: true,
    grain: true,
    antialias: 'smaa',
    normalMaps: true,
    textureScale: 2,
    clearcoat: true,
    lightStreaks: true,
    roadColumns: 13,
    facadeDetail: true,
  },
};

/**
 * Best-effort guess at what this device can handle, used only as a starting
 * point. `AdaptiveResolution` does the real work at runtime.
 */
export function detectTier() {
  const ua = navigator.userAgent;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  // iPadOS 13+ reports as desktop Safari; the touch-point count gives it away.
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (!isMobile && !isIpad) return cores >= 12 && mem >= 8 ? 'ultra' : cores >= 8 ? 'high' : 'medium';
  if (isIpad) return cores >= 6 ? 'high' : 'medium';
  if (cores >= 8 && mem >= 6) return 'high';
  if (cores >= 6 && mem >= 4) return 'medium';
  return 'low';
}

export function getTierSettings(name) {
  return { ...(TIERS[name] || TIERS.medium) };
}

export function isTouchDevice() {
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

/**
 * Watches frame time and nudges the renderer's pixel ratio to hold a target
 * frame rate. Changes are deliberately slow and hysteretic: a resolution that
 * oscillates every few frames looks far worse than one that is slightly low.
 */
export class AdaptiveResolution {
  constructor({ target = 60, minScale = 0.55, maxScale = 1.0 } = {}) {
    this.targetFrameMs = 1000 / target;
    this.minScale = minScale;
    this.maxScale = maxScale;
    this.scale = maxScale;
    this.avgFrameMs = this.targetFrameMs;
    this.cooldown = 1.5;      // seconds before the first adjustment
    this.sinceChange = 0;
    this.changed = false;
  }

  /** Feed one frame's delta (seconds). Returns true when `scale` moved. */
  update(dt) {
    this.changed = false;
    const frameMs = dt * 1000;
    // Ignore hitches (tab wake, GC pause) so they don't tank the resolution.
    if (frameMs < 200) {
      this.avgFrameMs += (frameMs - this.avgFrameMs) * 0.08;
    }
    this.sinceChange += dt;
    if (this.sinceChange < this.cooldown) return false;

    const budget = this.targetFrameMs;
    if (this.avgFrameMs > budget * 1.35 && this.scale > this.minScale) {
      this.scale = clamp(this.scale - 0.1, this.minScale, this.maxScale);
      this.sinceChange = 0;
      this.changed = true;
    } else if (this.avgFrameMs < budget * 0.82 && this.scale < this.maxScale) {
      this.scale = clamp(this.scale + 0.05, this.minScale, this.maxScale);
      this.sinceChange = 0;
      this.changed = true;
    }
    return this.changed;
  }

  get fps() {
    return this.avgFrameMs > 0 ? 1000 / this.avgFrameMs : 0;
  }
}
