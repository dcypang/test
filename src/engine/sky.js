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

  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunSize;
  uniform float uHazeStrength;
  uniform float uStars;
  uniform float uGroundGlow;
  uniform vec3 uGlowColor;

  // Hash-based star field: stable per direction, no texture needed.
  float hash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
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

  void main() {
    vec3 dir = normalize(vWorld);
    float h = dir.y;

    // Sky body: ground colour below the horizon, zenith above, haze between.
    float up = clamp(h, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
    col = mix(col, uGround, smoothstep(0.0, -0.16, h));

    // Haze thickens toward the horizon and toward the sun's azimuth.
    float horizonBand = exp(-abs(h) * 7.0);
    float sunAz = clamp(dot(normalize(vec3(dir.x, 0.0, dir.z)),
                            normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0);
    col += uSunColor * horizonBand * uHazeStrength * (0.35 + 0.65 * pow(sunAz, 3.0));

    // City / sunset glow hugging the horizon.
    col += uGlowColor * uGroundGlow * exp(-abs(h) * 12.0) * (0.4 + 0.6 * pow(sunAz, 2.0));

    // Sun or moon disc plus its aureole.
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, uSunSize) * 2.4;
    col += uSunColor * pow(sd, 6.0) * 0.16;

    if (uStars > 0.001) {
      col += vec3(stars(dir)) * uStars * smoothstep(-0.02, 0.25, h);
    }

    gl_FragColor = vec4(col, 1.0);
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
  },
};

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
      s.bias = -0.0009;
      s.normalBias = 0.035;
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
  update(focus) {
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
