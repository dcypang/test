/**
 * Post-processing pipeline.
 *
 * The scene renders into a half-float HDR target, then goes through:
 *
 *   RenderPass -> UnrealBloom -> Cinematic grade -> AA -> OutputPass
 *
 * three disables tone mapping and colour conversion automatically while
 * rendering into a render target, so the whole chain runs in linear light and
 * `OutputPass` applies ACES and the sRGB transfer exactly once at the end.
 *
 * The grade pass folds five effects into a single fragment shader — radial
 * motion blur, chromatic aberration, lift/gamma/gain grading, grain and
 * vignette. Stacking them as separate passes would mean five full-screen
 * round trips for work that fits comfortably in one.
 */

import * as THREE from 'three';
import { EffectComposer } from '../../vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three-addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/three-addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../../vendor/three-addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from '../../vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from '../../vendor/three-addons/postprocessing/SMAAPass.js';
import { FXAAPass } from '../../vendor/three-addons/postprocessing/FXAAPass.js';
import { clamp, damp } from './util.js';

/* ------------------------------------------------------------------
   Cinematic grade
   ------------------------------------------------------------------ */

const CinematicShader = {
  name: 'CinematicShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },           // 0..1, drives blur + aberration
    uFocus: { value: new THREE.Vector2(0.5, 0.5) },
    uBlurStrength: { value: 0.5 },
    uAberration: { value: 1.0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.45 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.06 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSpeed;
    uniform vec2  uFocus;
    uniform float uBlurStrength;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3  uLift;
    uniform vec3  uGain;
    varying vec2 vUv;

    // Interleaved gradient noise: cheap, and its dither pattern is far less
    // objectionable than plain white noise when used for grain.
    float igNoise(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec2 dir = vUv - uFocus;
      float dist = length(dir);

      // ---- radial motion blur + chromatic aberration ----------------
      // Samples march inward from the frame edge toward the focal point, so
      // the picture smears at the periphery and stays sharp in the middle.
      //
      // The aberration rides on the *same* offset vector as the blur. An
      // earlier version blurred the frame and then replaced R and B with
      // unblurred samples, which left green smeared while red and blue stayed
      // sharp — visible as magenta/green fringing along every high-contrast
      // edge once the rider got moving.
      float blur = uSpeed * uBlurStrength * smoothstep(0.12, 0.85, dist);

      #ifdef USE_ABERRATION
        // Fade the split against the border: sampling past the edge clamps to
        // the last texel and draws a hard coloured line down the frame.
        float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float ca = uAberration * (0.0006 + uSpeed * 0.0016)
                 * smoothstep(0.30, 0.95, dist)
                 * smoothstep(0.0, 0.02, edge);
        vec2 caVec = normalize(dir + 1e-6) * ca;

        const int SAMPLES = 6;
        vec3 sum = vec3(0.0);
        float total = 0.0;
        for (int i = 0; i < SAMPLES; i++) {
          float t = float(i) / float(SAMPLES - 1);
          float w = 1.0 - t * 0.55;
          vec2 o = dir * (t * blur * 0.22);
          sum.r += texture2D(tDiffuse, clamp(vUv - o + caVec, 0.0, 1.0)).r * w;
          sum.g += texture2D(tDiffuse, clamp(vUv - o, 0.0, 1.0)).g * w;
          sum.b += texture2D(tDiffuse, clamp(vUv - o - caVec, 0.0, 1.0)).b * w;
          total += w;
        }
        vec3 col = sum / total;
      #else
        const int SAMPLES = 8;
        vec3 sum = vec3(0.0);
        float total = 0.0;
        for (int i = 0; i < SAMPLES; i++) {
          float t = float(i) / float(SAMPLES - 1);
          float w = 1.0 - t * 0.55;
          vec2 o = dir * (t * blur * 0.22);
          sum += texture2D(tDiffuse, clamp(vUv - o, 0.0, 1.0)).rgb * w;
          total += w;
        }
        vec3 col = sum / total;
      #endif

      // ---- grade: lift / gain, contrast, saturation -----------------
      col = col * uGain + uLift;
      col = (col - 0.5) * uContrast + 0.5;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // ---- vignette -------------------------------------------------
      float vig = smoothstep(0.85, 0.25, dist);
      col *= mix(1.0, vig, uVignette);

      // ---- grain ----------------------------------------------------
      // Scaled by (1 - luma) so it sits in the shadows, where film grain
      // actually lives, instead of crawling all over the sky.
      float g = igNoise(gl_FragCoord.xy + fract(uTime) * 1000.0) - 0.5;
      col += g * uGrain * (1.0 - luma * 0.7);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/* ------------------------------------------------------------------
   Per-preset grade looks
   ------------------------------------------------------------------ */

/**
 * Bloom thresholds are in linear light, *before* tone mapping. A polished
 * clearcoat catching the sun peaks well above 1.0, so a threshold under 1
 * turns every specular highlight into a lens flare. Keeping it above unity
 * means only genuinely emissive surfaces — lamps, tail lights, lit windows —
 * bloom, which is what the effect is for.
 */
const LOOKS = {
  day: {
    bloomStrength: 0.4, bloomThreshold: 1.5, bloomRadius: 0.5,
    saturation: 1.12, contrast: 1.06, vignette: 0.32, grain: 0.026,
    lift: [0.004, 0.006, 0.012], gain: [1.03, 1.0, 0.97],
  },
  dusk: {
    bloomStrength: 0.7, bloomThreshold: 1.05, bloomRadius: 0.62,
    saturation: 1.16, contrast: 1.08, vignette: 0.44, grain: 0.034,
    lift: [0.014, 0.006, 0.016], gain: [1.07, 0.99, 0.94],
  },
  night: {
    bloomStrength: 1.05, bloomThreshold: 0.72, bloomRadius: 0.72,
    saturation: 1.1, contrast: 1.1, vignette: 0.52, grain: 0.045,
    lift: [0.004, 0.008, 0.022], gain: [0.98, 1.0, 1.08],
  },
};

export class PostFx {
  /**
   * @param renderer  the Renderer wrapper (needs .gl, .width, .height)
   * @param scene
   * @param camera
   * @param settings  tier settings
   * @param lookName  'day' | 'dusk' | 'night'
   */
  constructor(renderer, scene, camera, settings, lookName = 'day') {
    this.renderer = renderer;
    this.gl = renderer.gl;
    this.settings = settings;
    this.enabled = settings.postFx !== 'off';
    this.look = LOOKS[lookName] || LOOKS.day;
    this.time = 0;
    this.speedSmooth = 0;

    if (!this.enabled) return;

    const size = this.gl.getDrawingBufferSize(new THREE.Vector2());

    // Half-float keeps highlights above 1.0 so bloom has something to find.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: settings.postFx === 'ultra' ? 4 : 0,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.name = 'PostFx.scene';

    this.composer = new EffectComposer(this.gl, target);
    this.composer.setPixelRatio(this.gl.getPixelRatio());
    this.composer.setSize(renderer.width, renderer.height);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    if (settings.bloom) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        this.look.bloomStrength,
        this.look.bloomRadius,
        this.look.bloomThreshold,
      );
      this.composer.addPass(this.bloom);
    }

    this.grade = new ShaderPass(CinematicShader);
    // A define rather than a uniform branch: the two paths differ in texture
    // fetch count (18 vs 8), so the cheaper tiers should not pay for the
    // aberration path at all.
    if (settings.postFx === 'ultra' || settings.name === 'high') {
      this.grade.material.defines = { ...this.grade.material.defines, USE_ABERRATION: '' };
      this.grade.material.needsUpdate = true;
    }
    const u = this.grade.uniforms;
    u.uSaturation.value = this.look.saturation;
    u.uContrast.value = this.look.contrast;
    u.uVignette.value = this.look.vignette;
    u.uGrain.value = settings.grain ? this.look.grain : 0;
    u.uLift.value.fromArray(this.look.lift);
    u.uGain.value.fromArray(this.look.gain);
    u.uBlurStrength.value = settings.motionBlur ? 0.38 : 0;
    u.uAberration.value = settings.postFx === 'ultra' ? 1.2 : 0.7;
    this.composer.addPass(this.grade);

    // OutputPass must come before AA: FXAA and SMAA both expect display-
    // referred (sRGB) input, and running them on linear HDR blurs the wrong
    // edges. Everything after this point is LDR.
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    if (settings.antialias === 'smaa') {
      this.aa = new SMAAPass();
      this.composer.addPass(this.aa);
    } else if (settings.antialias === 'fxaa') {
      this.aa = new FXAAPass();
      this.composer.addPass(this.aa);
    }
  }

  setCamera(camera) {
    if (this.renderPass) this.renderPass.camera = camera;
  }

  resize(width, height, pixelRatio) {
    if (!this.enabled) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    if (this.bloom) this.bloom.setSize(width * pixelRatio, height * pixelRatio);
  }

  /**
   * @param dt      frame delta
   * @param speed01 rider speed normalised to 0..1
   */
  update(dt, speed01) {
    if (!this.enabled) return;
    this.time += dt;
    // Smooth the speed term so a crash or a gear change doesn't make the
    // whole frame lurch in and out of blur.
    this.speedSmooth = damp(this.speedSmooth, clamp(speed01, 0, 1), 0.02, dt);
    const u = this.grade.uniforms;
    u.uTime.value = this.time;
    u.uSpeed.value = this.speedSmooth;
  }

  render(scene, camera) {
    if (!this.enabled) {
      this.gl.render(scene, camera);
      return;
    }
    this.composer.render();
  }

  dispose() {
    if (!this.enabled) return;
    this.composer.renderTarget1?.dispose();
    this.composer.renderTarget2?.dispose();
    this.bloom?.dispose();
    this.grade?.dispose?.();
    this.aa?.dispose?.();
    this.output?.dispose?.();
  }
}
