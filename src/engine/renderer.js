/**
 * WebGL renderer setup plus the resize / adaptive-resolution plumbing.
 */

import * as THREE from 'three';
import { AdaptiveResolution } from './quality.js';
import { clamp } from './util.js';

export class Renderer {
  constructor(canvas, settings) {
    this.settings = settings;

    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.name === 'high',
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      // The scene is fully opaque and we never read pixels back, so letting the
      // browser discard the buffer after compositing saves bandwidth.
      preserveDrawingBuffer: false,
    });

    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.setClearColor(0x0a0f16, 1);

    this.gl.shadowMap.enabled = settings.shadows;
    // VSM gives noticeably softer, more natural contact shadows than PCF at
    // the same map size, which matters most for the bike's own shadow.
    this.gl.shadowMap.type = settings.name === 'medium' || settings.name === 'low'
      ? THREE.PCFShadowMap
      : THREE.VSMShadowMap;
    this.gl.shadowMap.autoUpdate = settings.shadows;

    /** Optional post-processing chain; set by `attachPost`. */
    this.post = null;

    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio);
    this.adaptive = new AdaptiveResolution({
      target: 60,
      minScale: 0.5,
      maxScale: 1.0,
    });

    this.width = 1;
    this.height = 1;
    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this.resize();
  }

  resize() {
    // visualViewport tracks the real drawable box on iOS when the URL bar
    // collapses; innerWidth lags behind it by a frame or two.
    const vv = window.visualViewport;
    this.width = Math.max(1, Math.floor(vv ? vv.width : window.innerWidth));
    this.height = Math.max(1, Math.floor(vv ? vv.height : window.innerHeight));
    this.gl.setSize(this.width, this.height, false);
    this.applyPixelRatio();
    if (this.camera) {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    }
    this.post?.resize(this.width, this.height, this.gl.getPixelRatio());
  }

  applyPixelRatio() {
    const ratio = clamp(this.maxPixelRatio * this.adaptive.scale, 0.5, 3);
    this.gl.setPixelRatio(ratio);
    this.post?.resize(this.width, this.height, ratio);
  }

  /** Hand the renderer its post chain so resizes stay in one place. */
  attachPost(post) {
    this.post = post;
    this.post?.resize(this.width, this.height, this.gl.getPixelRatio());
  }

  /** Call once per frame with the frame delta in seconds. */
  tick(dt) {
    if (this.adaptive.update(dt)) this.applyPixelRatio();
  }

  render(scene, camera) {
    // A composer issues several `gl.render` calls per frame and three resets
    // its counters on each one, so the stats would only ever describe the last
    // full-screen quad. Reset once per frame instead and let them accumulate.
    this.gl.info.autoReset = false;
    this.gl.info.reset();
    if (this.post) this.post.render(scene, camera);
    else this.gl.render(scene, camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this.gl.dispose();
  }
}

/** True when the browser can give us a WebGL context at all. */
export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGL2RenderingContext && canvas.getContext('webgl2')
    ) || !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch (err) {
    return false;
  }
}
