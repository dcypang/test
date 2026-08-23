/**
 * Sky dome, distant backdrop and the lighting rig.
 *
 * The dome is a single shader sphere: a vertical gradient, a horizon haze band,
 * a sun/moon disc with bloom-ish falloff, and procedural stars that fade in as
 * the preset gets darker. It doubles as the source for the environment map, so
 * chrome on the bike and puddles on the road reflect the actual sky in use.
 */

import * as THREE from 'three';
import { mountainTexture } from './textures.js';

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vWorld;

  uniform vec3  uZenith;
  uniform vec3  uHorizon;
  uniform vec3  uGround;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunSize;
  uniform float uHazeStrength;
  uniform float uStars;
  uniform float uGroundGlow;
  uniform vec3  uGlowColor;
  uniform float uRayleigh;
  uniform float uScatterGain;
  uniform float uScatterMix;
  uniform float uMie;
  uniform float uCloudAmount;
  uniform float uCloudSharpness;
  uniform vec3  uCloudColor;
  uniform vec3  uCloudShadow;
  uniform float uTime;

  const float PI = 3.141592653589793;

  // ---- hashes / noise ------------------------------------------------
  float hash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i + vec2(0.0, 0.0)), hash2(i + vec2(1.0, 0.0)), u.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    float norm = 0.0;
    for (int i = 0; i < 5; i++) {
      v += a * valueNoise(p);
      norm += a;
      p *= 2.03;
      a *= 0.5;
    }
    return v / norm;
  }

  float stars(vec3 dir) {
    vec3 p = dir * 260.0;
    vec3 cell = floor(p);
    float h = hash(cell);
    if (h < 0.982) return 0.0;
    vec3 local = fract(p) - 0.5;
    float d = length(local);
    float bright = (h - 0.982) / 0.018;
    return smoothstep(0.34, 0.0, d) * bright;
  }

  // ---- scattering phase functions -------------------------------------
  float rayleighPhase(float mu) {
    return (3.0 / (16.0 * PI)) * (1.0 + mu * mu);
  }

  // Henyey-Greenstein: forward-scattering lobe that produces the bright
  // aureole around the sun and the glow along the horizon near it.
  float miePhase(float mu, float g) {
    float g2 = g * g;
    float denom = 1.0 + g2 - 2.0 * g * mu;
    return (1.0 - g2) / (4.0 * PI * pow(max(denom, 1e-4), 1.5));
  }

  void main() {
    vec3 dir = normalize(vWorld);
    vec3 sun = normalize(uSunDir);
    float h = dir.y;
    float mu = dot(dir, sun);

    // ---- single-scattering atmosphere ---------------------------------
    // Standard form:  L = I * (BR*PR + BM*PM)/BT * (1 - e^-BT*d) * Tsun
    //
    // DEPTH_SCALE is chosen so the blue optical depth looking straight up is
    // a few tenths — that is what makes midday sun near-white while a low sun
    // still reddens hard, because its path length grows as 1/height.
    const float DEPTH_SCALE = 8.0;

    vec3 betaR = vec3(5.8e-3, 1.35e-2, 3.31e-2) * uRayleigh;
    vec3 betaM = vec3(3.0e-3) * uMie;
    vec3 betaT = betaR + betaM;

    float viewDepth = DEPTH_SCALE / (max(h, 0.0) + 0.25);
    float sunDepth  = DEPTH_SCALE / (max(sun.y, 0.02) + 0.25);

    float rPhase = rayleighPhase(mu);
    // The Mie lobe is unbounded as mu -> 1; clamping keeps the aureole bright
    // without letting a single pixel run away to five figures.
    float mPhase = min(miePhase(mu, 0.76), 6.0);

    vec3 sunTransmit = exp(-betaT * sunDepth);
    vec3 inscatter = ((betaR * rPhase + betaM * mPhase) / betaT)
                   * (1.0 - exp(-betaT * viewDepth));

    vec3 scattered = uSunColor * inscatter * sunTransmit * uScatterGain;

    // Blend with the authored palette: the physical term supplies the
    // gradient shape and the sun-side warmth, the preset keeps each track
    // looking the way it was art-directed.
    float up = clamp(h, 0.0, 1.0);
    vec3 palette = mix(uHorizon, uZenith, pow(up, 0.42));
    vec3 col = mix(palette, scattered, uScatterMix);
    col = mix(col, uGround, smoothstep(0.0, -0.16, h));

    // Extra haze band hugging the horizon, strongest toward the sun.
    float horizonBand = exp(-abs(h) * 7.0);
    float sunAz = clamp(dot(normalize(vec3(dir.x, 0.0, dir.z)),
                            normalize(vec3(sun.x, 0.0, sun.z))), 0.0, 1.0);
    col += uSunColor * horizonBand * uHazeStrength * (0.35 + 0.65 * pow(sunAz, 3.0));
    col += uGlowColor * uGroundGlow * exp(-abs(h) * 12.0) * (0.4 + 0.6 * pow(sunAz, 2.0));

    // ---- clouds --------------------------------------------------------
    if (uCloudAmount > 0.001 && h > -0.02) {
      // Project onto a flat layer: dividing by height stretches the cells
      // toward the horizon the way a real cloud deck recedes.
      float t = 1.0 / max(h + 0.06, 0.06);
      vec2 uv = dir.xz * t * 0.55 + vec2(uTime * 0.0032, uTime * 0.0018);

      float n0 = fbm(uv * 1.1);
      // Domain warp: pushes the noise around by more noise, which turns even
      // bands into billows.
      float n = fbm(uv * 1.1 + vec2(n0 * 0.9, n0 * 0.6));

      // Domain-warping shifts the noise distribution well below the naive
      // [0,1] assumption — measured median is about 0.39, 95th percentile
      // about 0.61 — so the coverage threshold is mapped onto that range
      // rather than onto (1 - amount), which never triggered at all.
      float lo = mix(0.62, 0.20, uCloudAmount);
      float cover = smoothstep(lo, lo + uCloudSharpness, n);
      // Fade the deck out at the horizon so it never shows a hard edge.
      cover *= smoothstep(-0.02, 0.16, h);

      // Cheap self-shadowing. Shading off the coverage value alone makes
      // thick cloud also bright, so the deck reads as a flat stencil; the
      // difference between the warped and unwarped noise is a free stand-in
      // for a density gradient, and gives each billow a lit and a shaded side.
      float lit = clamp((n - n0) * 2.6 + 0.5, 0.0, 1.0);
      float sunUp = clamp(sun.y * 2.0, 0.0, 1.0);
      vec3 cloudLit = mix(uCloudShadow, uCloudColor, lit);
      cloudLit += uSunColor * pow(max(mu, 0.0), 8.0) * 0.5 * sunUp * (1.0 - lit * 0.5);

      col = mix(col, cloudLit, cover * 0.92);
    }

    // ---- sun / moon disc ------------------------------------------------
    float sd = max(mu, 0.0);
    // Limb-darkened disc plus two falloff terms for the aureole.
    float disc = pow(sd, uSunSize);
    col += uSunColor * disc * 3.0;
    col += uSunColor * pow(sd, 24.0) * 0.35;
    col += uSunColor * pow(sd, 6.0) * 0.12 * uHazeStrength;

    if (uStars > 0.001) {
      col += vec3(stars(dir)) * uStars * smoothstep(-0.02, 0.25, h);
    }

    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Named lighting presets. `sunDir` is a direction *toward* the light.
 * Colours are linear-ish values fed straight to the shader and lights.
 */
export const SKY_PRESETS = {
  day: {
    zenith: 0x2f6fc4,
    horizon: 0xa8c8e8,
    ground: 0x6a7386,
    sunColor: 0xfff3d8,
    sunDir: new THREE.Vector3(0.35, 0.55, -0.76),
    sunSize: 900,
    haze: 0.55,
    stars: 0,
    groundGlow: 0.0,
    glowColor: 0xffffff,
    sunIntensity: 3.1,
    ambientColor: 0x9fb8d8,
    ambientIntensity: 0.95,
    hemiGround: 0x4a5240,
    fogColor: 0xb2cbe4,
    fogDensity: 0.0016,
    exposure: 1.0,
    wet: false,
    rayleigh: 1.0,
    mie: 0.9,
    scatterGain: 48.0,
    scatterMix: 0.62,
    cloudAmount: 0.62,
    cloudSharpness: 0.20,
    cloudColor: 0xfbfcff,
    cloudShadow: 0x7d90ab,
  },
  dusk: {
    // Golden hour, not nightfall: the sun is low enough to rake the canyon
    // walls but still high enough to light them. Sitting it right on the
    // horizon left every rock face as an unreadable silhouette.
    zenith: 0x27356b,
    horizon: 0xe8996a,
    ground: 0x4a4048,
    sunColor: 0xffc089,
    sunDir: new THREE.Vector3(-0.66, 0.30, -0.69),
    sunSize: 620,
    haze: 0.95,
    stars: 0.22,
    groundGlow: 0.45,
    glowColor: 0xff9a52,
    sunIntensity: 2.6,
    ambientColor: 0x8f9ac4,
    ambientIntensity: 1.35,
    hemiGround: 0x54463c,
    fogColor: 0x9c7b78,
    fogDensity: 0.0019,
    exposure: 1.0,
    wet: false,
    rayleigh: 1.9,
    mie: 1.8,
    scatterGain: 22.0,
    scatterMix: 0.6,
    cloudAmount: 0.66,
    cloudSharpness: 0.26,
    cloudColor: 0xffcfa4,
    cloudShadow: 0x6b5470,
  },
  night: {
    // A real city night is not dark — it is lit from below by sodium and
    // shopfronts. The ambient and hemisphere terms are deliberately generous
    // so facades and tarmac read between the pools of lamp light; without
    // them the track collapses into black around the headlight beam.
    zenith: 0x070d1a,
    horizon: 0x1b2a44,
    ground: 0x0d1220,
    sunColor: 0xb9cbe8,
    sunDir: new THREE.Vector3(-0.4, 0.62, -0.68),
    sunSize: 2400,
    haze: 0.3,
    stars: 0.85,
    groundGlow: 1.25,
    glowColor: 0x5c82c0,
    sunIntensity: 0.8,
    ambientColor: 0x4a5f8c,
    ambientIntensity: 1.5,
    hemiGround: 0x2a2620,
    fogColor: 0x141f33,
    fogDensity: 0.0028,
    exposure: 1.25,
    wet: true,
    rayleigh: 0.25,
    mie: 0.35,
    scatterGain: 5.0,
    scatterMix: 0.35,
    cloudAmount: 0.5,
    cloudSharpness: 0.3,
    cloudColor: 0x2c3a52,
    cloudShadow: 0x0d1420,
  },
};

/** Mirrors the shadow-map choice made in engine/renderer.js. */
function renderUsesVsm(settings) {
  return settings.name !== 'low' && settings.name !== 'medium';
}

export class Sky {
  constructor(scene, presetName, settings) {
    this.scene = scene;
    this.settings = settings;
    this.preset = { ...SKY_PRESETS[presetName] };

    const p = this.preset;
    this.uniforms = {
      uZenith: { value: new THREE.Color(p.zenith) },
      uHorizon: { value: new THREE.Color(p.horizon) },
      uGround: { value: new THREE.Color(p.ground) },
      uSunDir: { value: p.sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(p.sunColor) },
      uSunSize: { value: p.sunSize },
      uHazeStrength: { value: p.haze },
      uStars: { value: p.stars },
      uGroundGlow: { value: p.groundGlow },
      uGlowColor: { value: new THREE.Color(p.glowColor) },
      uRayleigh: { value: p.rayleigh ?? 1.0 },
      uScatterGain: { value: p.scatterGain ?? 40.0 },
      uScatterMix: { value: p.scatterMix ?? 0.6 },
      uMie: { value: p.mie ?? 1.0 },
      uCloudAmount: { value: p.cloudAmount ?? 0.4 },
      uCloudSharpness: { value: p.cloudSharpness ?? 0.25 },
      uCloudColor: { value: new THREE.Color(p.cloudColor ?? 0xffffff) },
      uCloudShadow: { value: new THREE.Color(p.cloudShadow ?? 0x8899aa) },
      uTime: { value: 0 },
    };

    const geo = new THREE.SphereGeometry(1, 32, 20);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    // Must stay inside the camera's far plane: depthTest is off, but the
    // rasteriser still clips anything past far, which would leave the sky
    // missing entirely. See SKY_RADIUS in game/camera.js.
    this.mesh.scale.setScalar(4200);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);

    // ---- lights -----------------------------------------------------
    this.sun = new THREE.DirectionalLight(p.sunColor, p.sunIntensity);
    this.sun.position.copy(p.sunDir).multiplyScalar(180);
    this.sun.castShadow = settings.shadows;
    if (settings.shadows) {
      const s = this.sun.shadow;
      s.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      // The shadow volume only ever needs to cover the rider and their
      // immediate surroundings; everything further out is fogged anyway.
      s.camera.near = 1;
      s.camera.far = 260;
      s.camera.left = -46;
      s.camera.right = 46;
      s.camera.top = 46;
      s.camera.bottom = -46;
      // VSM stores depth moments rather than sampling a depth test, so the
      // slope-scaled offsets PCF needs would only smear the shadow: keep the
      // bias tiny and let the blur radius do the softening.
      if (settings.shadows && renderUsesVsm(settings)) {
        s.bias = -0.0004;
        s.normalBias = 0;
        s.radius = 3.5;
        s.blurSamples = 12;
      } else {
        s.bias = -0.0009;
        s.normalBias = 0.035;
      }
    }
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(p.ambientColor, p.hemiGround, p.ambientIntensity);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(p.fogColor, p.fogDensity);

    this.backdrop = null;
  }

  /** Ring of painted ridges sat just inside the dome. */
  addMountains(tint = '#5c6b7a', height = 900, radius = 3400, opacity = 1) {
    const tex = mountainTexture(tint);
    tex.repeat.set(3, 1);
    const geo = new THREE.CylinderGeometry(radius, radius, height, 64, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = height * 0.28;
    mesh.renderOrder = -900;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.backdrop = mesh;
    return mesh;
  }

  /**
   * Bake the dome into a PMREM cube so materials get real specular response.
   * Called once after the sky is configured.
   */
  buildEnvironment(renderer) {
    if (!this.settings.reflections) return null;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    const capture = new THREE.Scene();
    const domeClone = new THREE.Mesh(this.mesh.geometry, this.mesh.material);
    domeClone.scale.setScalar(100);
    domeClone.frustumCulled = false;
    capture.add(domeClone);

    const target = pmrem.fromScene(capture, 0.04, 0.1, 200);
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = this.preset.wet ? 0.85 : 0.6;
    this.envMap = target.texture;
    // `pmrem.dispose()` frees the generator's scratch targets but not the one
    // it hands back, so hold on to it and release it with the rest of the sky.
    this.envTarget = target;

    pmrem.dispose();
    capture.remove(domeClone);
    return target.texture;
  }

  /** Keep the dome and shadow volume centred on the rider. */
  update(focus, dt = 0) {
    // The deck drifts slowly. It is scrolled in the shader rather than by
    // rotating the dome, so the sun and stars stay put.
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(focus);
    this.mesh.updateMatrix();
    if (this.backdrop) {
      this.backdrop.position.x = focus.x;
      this.backdrop.position.z = focus.z;
    }
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.uniforms.uSunDir.value, 150);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this.backdrop) {
      this.backdrop.geometry.dispose();
      this.backdrop.material.dispose();
    }
    if (this.envTarget) {
      if (this.scene.environment === this.envTarget.texture) this.scene.environment = null;
      this.envTarget.dispose();
      this.envTarget = null;
      this.envMap = null;
    }
    // The shadow map is allocated lazily on first render and is not reached by
    // clearing the scene, so it has to be released explicitly.
    this.sun.shadow?.dispose();
    this.sun.dispose?.();
    this.hemi.dispose?.();
  }
}
