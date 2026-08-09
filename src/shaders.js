// ---------------------------------------------------------------------------
// shaders.js - all GLSL for the game.
// A single uber-shader handles every opaque surface; `aFlag` selects between
// car paint, glass, foliage, asphalt and plain surfaces.
// ---------------------------------------------------------------------------

// Shared helpers: value noise, fbm, and the procedural sky that is used both
// as the visible backdrop and as the reflection environment.
const GLSL_COMMON = `
precision highp float;
precision highp int;
precision highp sampler2DShadow;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uGroundTint;
uniform vec3 uCloudColor;
uniform float uCloudAmount;
uniform float uCloudOffset;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise2(p); p *= 2.03; a *= 0.5; }
  return v;
}

// The plain sky gradient: no clouds, no sun disk. Everything that reflects the
// sky uses this.
//
// Two details in here are deliberate and both were bugs before:
//  * the cloud layer is projected with d.xz / d.y, which blows up at grazing
//    angles. On a curved, near-horizontal panel neighbouring pixels then land
//    in completely different parts of the noise and the bodywork crawls with
//    white speckle, so reflections get a clean gradient instead.
//  * the sun disk is a near-delta function, which sparkles on a mirror-smooth
//    clear coat for the same reason, so reflections re-add it as a broad lobe.
vec3 skyGradient(vec3 d) {
  if (d.y > 0.0) return mix(uSkyHorizon, uSkyZenith, pow(clamp(d.y, 0.0, 1.0), 0.55));
  return mix(uSkyHorizon, uGroundTint, 1.0 - smoothstep(-0.3, 0.0, d.y));
}

// The visible backdrop, which can afford both clouds and a hard sun because it
// is a smooth full-screen gradient rather than a curved reflector.
vec3 skyColor(vec3 d) {
  vec3 col = skyGradient(d);
  if (d.y > 0.0) {
    vec2 uv = d.xz / max(d.y, 0.10);
    float c = fbm(uv * 0.055 + vec2(uCloudOffset, uCloudOffset * 0.6));
    float c2 = fbm(uv * 0.13 - vec2(uCloudOffset * 1.7, 0.0));
    c = smoothstep(0.44, 0.92, c * 0.75 + c2 * 0.35) * smoothstep(0.03, 0.30, d.y);
    col = mix(col, uCloudColor, clamp(c * uCloudAmount, 0.0, 1.0));
  }
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(sd, 1200.0) * 14.0;
  col += uSunColor * pow(sd, 9.0) * 0.22;
  return col;
}

// Roughness-aware environment lookup: a clean gradient plus a broad,
// energy-limited sun so highlights read without aliasing.
vec3 envSpecular(vec3 r, float rough) {
  vec3 dir = normalize(r);
  vec3 col = skyGradient(dir);
  float wide = clamp(rough * 3.0, 0.0, 1.0);
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * pow(sd, mix(210.0, 18.0, wide)) * mix(1.5, 0.30, wide);
  col += uSunColor * pow(sd, 9.0) * 0.16;
  vec3 avg = mix(uGroundTint, uSkyZenith, 0.55) + uSunColor * 0.04;
  return mix(col, avg, clamp(rough * 1.35, 0.0, 1.0));
}

vec3 envIrradiance(vec3 n) {
  vec3 up = mix(uSkyHorizon, uSkyZenith, 0.6);
  return mix(uGroundTint * 0.7, up, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
}
`;

const MAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec3 aMaterial;
layout(location = 4) in float aFlag;

uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform mat4 uViewProj;
uniform mat4 uShadowMat0;
uniform mat4 uShadowMat1;

out vec3 vWorld;
out vec3 vLocal;
out vec3 vNormal;
out vec3 vColor;
out vec3 vMaterial;
// Declared flat: this is a material id, not a value to blend across the
// triangle. Smooth interpolation hands the fragment shader 0.9999997 instead
// of 1.0 on scattered pixels, every equality test against it then misses, and
// those fragments fall through the whole material chain - which showed up as
// coloured speckle crawling over every car in the game.
flat out float vFlag;
out vec4 vShadow0;
out vec4 vShadow1;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vLocal = aPosition;
  vNormal = normalize(uNormalMat * aNormal);
  vColor = aColor;
  vMaterial = aMaterial;
  vFlag = aFlag;
  vShadow0 = uShadowMat0 * world;
  vShadow1 = uShadowMat1 * world;
  gl_Position = uViewProj * world;
}
`;

const MAIN_FS = `#version 300 es
${GLSL_COMMON}

in vec3 vWorld;
in vec3 vLocal;
in vec3 vNormal;
in vec3 vColor;
in vec3 vMaterial;
flat in float vFlag;
in vec4 vShadow0;
in vec4 vShadow1;

uniform vec3 uCameraPos;
uniform vec3 uPaintColor;
uniform vec3 uStripeColor;
uniform float uLiveryStyle;
uniform float uPaintOverride;
uniform float uDirt;
uniform sampler2DShadow uShadow0;
uniform sampler2DShadow uShadow1;
uniform float uShadowTexel;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uWetness;
uniform float uAlpha;
uniform vec3 uHeadlightPos;
uniform vec3 uHeadlightDir;
uniform float uHeadlightOn;
uniform float uNight;

out vec4 fragColor;

const float PI = 3.14159265;

float distributionGGX(float ndh, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-6);
}

float geometrySmith(float ndv, float ndl, float rough) {
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float gv = ndv / (ndv * (1.0 - k) + k);
  float gl = ndl / (ndl * (1.0 - k) + k);
  return gv * gl;
}

vec3 fresnelSchlick(float ct, vec3 f0) {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - ct, 0.0, 1.0), 5.0);
}

// --- procedural livery ------------------------------------------------------
// Everything is evaluated in car-local space so one mesh can serve the whole
// grid: paint colour, stripes, a door roundel with a race number, panel gaps
// and road grime are all per-pixel rather than per-vertex.

// GLSL leaves smoothstep undefined when edge0 >= edge1, so every falling
// ramp in this file is written as 1.0 - smoothstep(lo, hi, x). Writing them
// the other way round renders as per-pixel noise on some drivers.
float band(float v, float c, float w) {
  return 1.0 - smoothstep(0.0, w, abs(v - c));
}

// Seven segment race number inside the door roundel.
// Deliberately written without arrays: dynamically indexing a local array is
// legal GLSL but not reliable across drivers, and when it misbehaves the
// roundel fills with noise.
float segmentOn(vec2 p, float cx, float cy, float hw, float hh, bool lit) {
  if (!lit) return 0.0;
  vec2 d = abs(p - vec2(cx, cy)) - vec2(hw, hh);
  // Antialias the segment edge instead of a hard step, so the number stays
  // clean when the car is far away.
  float e = max(d.x, d.y);
  return 1.0 - smoothstep(0.0, 0.02, e);
}

int digitSegments(int d) {
  if (d == 0) return 63;
  if (d == 1) return 6;
  if (d == 2) return 91;
  if (d == 3) return 79;
  if (d == 4) return 102;
  if (d == 5) return 109;
  if (d == 6) return 125;
  if (d == 7) return 7;
  if (d == 8) return 127;
  return 111;
}

float digitMask(vec2 p, int digit) {
  int mask = digitSegments(digit);
  float on = 0.0;
  on = max(on, segmentOn(p, 0.0, 0.40, 0.19, 0.055, (mask & 1) != 0));
  on = max(on, segmentOn(p, 0.22, 0.21, 0.055, 0.17, (mask & 2) != 0));
  on = max(on, segmentOn(p, 0.22, -0.21, 0.055, 0.17, (mask & 4) != 0));
  on = max(on, segmentOn(p, 0.0, -0.40, 0.19, 0.055, (mask & 8) != 0));
  on = max(on, segmentOn(p, -0.22, -0.21, 0.055, 0.17, (mask & 16) != 0));
  on = max(on, segmentOn(p, -0.22, 0.21, 0.055, 0.17, (mask & 32) != 0));
  on = max(on, segmentOn(p, 0.0, 0.0, 0.19, 0.055, (mask & 64) != 0));
  return on;
}

vec3 applyLivery(vec3 lp, vec3 base, out float roughAdj) {
  roughAdj = 0.0;
  vec3 col = base;
  float x = lp.x, y = lp.y, z = lp.z;
  float ax = abs(x);
  int style = int(uLiveryStyle + 0.5);

  if (style == 0) {
    // Twin centre stripes running the length of the car.
    float s = (1.0 - smoothstep(0.22, 0.26, ax)) * smoothstep(0.08, 0.12, ax);
    col = mix(col, uStripeColor, s);
  } else if (style == 1) {
    // Lower side blade that kicks up over the rear haunch.
    float edge = 0.46 + 0.13 * sin(z * 1.25 + 1.2) - (1.0 - smoothstep(-1.6, 0.4, z)) * 0.12;
    float s = (1.0 - smoothstep(edge - 0.05, edge + 0.05, y)) * smoothstep(0.55, 0.68, ax);
    col = mix(col, uStripeColor, s);
  } else if (style == 2) {
    // Diagonal two tone across the doors.
    float d = z * 0.55 + y * 1.1;
    col = mix(col, uStripeColor, 1.0 - smoothstep(0.50, 0.62, d));
  } else if (style == 3) {
    // Chevron over the nose and bonnet.
    float c = abs(ax * 1.7 - (2.45 - z));
    col = mix(col, uStripeColor, (1.0 - smoothstep(0.16, 0.30, c)) * smoothstep(0.35, 0.6, z));
  }

  // Door roundel with the race number.
  if (ax > 0.62 && uPaintOverride > 0.5) {
    vec2 q = vec2(-sign(x) * (z + 0.18), y - 0.52);
    float r = length(q / vec2(0.42, 0.30));
    float disc = 1.0 - smoothstep(0.94, 1.0, r);
    col = mix(col, vec3(0.93, 0.93, 0.90), disc);
    float dg = digitMask(q / vec2(0.30, 0.26), int(mod(uLiveryStyle * 7.0 + 3.0, 10.0)));
    col = mix(col, vec3(0.05, 0.05, 0.06), dg * disc);
  }

  // Panel gaps: bonnet, doors and rear deck.
  float gaps = 0.0;
  gaps = max(gaps, band(z, 0.92, 0.012) * step(y, 0.86) * step(ax, 0.88));
  gaps = max(gaps, band(z, -1.02, 0.012) * step(y, 0.88) * step(ax, 0.90));
  gaps = max(gaps, band(z, 0.30, 0.010) * step(0.62, ax));
  gaps = max(gaps, band(ax, 0.56, 0.010) * step(1.0, z) * step(z, 2.0));
  gaps = max(gaps, band(y, 0.30, 0.010) * step(0.70, ax) * step(abs(z), 1.7));
  col *= 1.0 - gaps * 0.75;

  // Road grime creeps up the flanks and behind the wheels.
  float grime = (1.0 - smoothstep(0.06, 0.42, y)) * (0.45 + 0.55 * fbm(lp.xz * 4.0 + lp.y * 3.0));
  grime = clamp(grime * uDirt * 1.35, 0.0, 0.85);
  col = mix(col, vec3(0.30, 0.27, 0.23), grime);
  roughAdj = grime * 0.55;
  return col;
}

float sampleShadow(sampler2DShadow smap, vec4 coord, float bias) {
  vec3 p = coord.xyz / coord.w;
  p = p * 0.5 + 0.5;
  if (p.x < 0.002 || p.x > 0.998 || p.y < 0.002 || p.y > 0.998 || p.z > 1.0) return -1.0;
  p.z -= bias;
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      sum += texture(smap, vec3(p.xy + vec2(float(x), float(y)) * uShadowTexel, p.z));
    }
  }
  return sum / 9.0;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorld);

  int flag = int(vFlag + 0.5);
  vec3 albedo = vColor;
  float rough = clamp(vMaterial.x, 0.03, 1.0);
  float metal = clamp(vMaterial.y, 0.0, 1.0);
  float emissive = vMaterial.z;
  float alpha = uAlpha;

  // --- per-material surface detail ------------------------------------------
  if (flag == 4) {
    // Asphalt: speckled aggregate plus faint puddling that sharpens reflections.
    float grain = fbm(vWorld.xz * 3.1);
    float coarse = noise2(vWorld.xz * 0.35);
    albedo *= 0.82 + grain * 0.30 + coarse * 0.08;
    rough = clamp(rough - uWetness * 0.55 * smoothstep(0.35, 0.75, coarse), 0.05, 1.0);
    N = normalize(N + vec3((fbm(vWorld.xz * 6.0) - 0.5) * 0.07, 0.0,
                           (fbm(vWorld.zx * 6.0 + 11.0) - 0.5) * 0.07));
  } else if (flag == 3) {
    // Foliage: break up the silhouette and let some light through.
    float n = fbm(vWorld.xz * 2.2 + vWorld.y * 0.7);
    albedo *= 0.75 + n * 0.5;
  } else if (flag == 0) {
    float n = noise2(vWorld.xz * 1.7 + vWorld.y * 0.9);
    albedo *= 0.93 + n * 0.14;
  } else if (flag == 1) {
    // Car paint: livery is evaluated in car-local space, then a very fine
    // metallic flake is mixed into the clear coat.
    vec3 basePaint = mix(albedo, uPaintColor, uPaintOverride);
    float roughAdj = 0.0;
    albedo = applyLivery(vLocal, basePaint, roughAdj);
    rough = clamp(rough + roughAdj, 0.03, 1.0);
    // Flake is evaluated in car-local space: in world space the pattern is
    // fixed to the ground and the car swims through it, and at the frequency
    // metal flake really has it just aliases into noise.
    float flake = noise2(vLocal.xz * 46.0 + vLocal.y * 31.0);
    albedo *= 0.975 + flake * 0.05;
  }

  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 1e-4);
  float ndh = max(dot(N, H), 0.0);
  float vdh = max(dot(V, H), 0.0);

  // --- shadowing -------------------------------------------------------------
  float bias = max(0.0016 * (1.0 - ndl), 0.00035);
  float shadow = sampleShadow(uShadow0, vShadow0, bias);
  if (shadow < 0.0) shadow = sampleShadow(uShadow1, vShadow1, bias * 2.6);
  if (shadow < 0.0) shadow = 1.0;

  // --- direct sun -------------------------------------------------------------
  float D = distributionGGX(ndh, rough);
  float G = geometrySmith(ndv, ndl, rough);
  vec3 F = fresnelSchlick(vdh, f0);
  vec3 spec = min((D * G * F) / max(4.0 * ndv * ndl, 1e-4), vec3(28.0));
  vec3 kd = (1.0 - F) * (1.0 - metal);
  vec3 direct = (kd * albedo / PI + spec) * uSunColor * ndl * shadow;

  if (flag == 3) {
    // Wrapped diffuse so foliage keeps volume on the shaded side.
    float wrap = max(dot(N, L) * 0.5 + 0.5, 0.0);
    direct += albedo * uSunColor * wrap * 0.35 * mix(0.35, 1.0, shadow);
  }

  // --- ambient / image based ---------------------------------------------------
  vec3 R = reflect(-V, N);
  float fres = pow(1.0 - ndv, 5.0);
  vec3 envF = f0 + (max(vec3(1.0 - rough), f0) - f0) * fres;
  vec3 ambientDiffuse = envIrradiance(N) * albedo * (1.0 - metal) * 0.55;
  vec3 ambientSpec = envSpecular(R, rough) * envF * 0.85;
  vec3 color = direct + ambientDiffuse + ambientSpec;

  // --- clear coat on car paint --------------------------------------------------
  if (flag == 1) {
    // A perfectly smooth coat aliases badly on curved panels, so the lobe is
    // kept slightly rough and its peak energy is capped.
    float ccRough = 0.085;
    float Dc = distributionGGX(ndh, ccRough);
    float Gc = geometrySmith(ndv, ndl, ccRough);
    float Fc = 0.04 + 0.96 * pow(clamp(1.0 - vdh, 0.0, 1.0), 5.0);
    float ccSpec = min(Dc * Gc * Fc / max(4.0 * ndv * ndl, 1e-4), 22.0);
    color += vec3(ccSpec) * uSunColor * ndl * shadow;
    color += envSpecular(R, ccRough) * (0.04 + 0.30 * fres);
  }

  // --- glass ----------------------------------------------------------------------
  if (flag == 2) {
    float glassFres = 0.06 + 0.94 * pow(1.0 - ndv, 4.0);
    color = mix(albedo * envIrradiance(N) * 0.35, envSpecular(R, 0.05), glassFres);
    color += vec3(pow(ndh, 220.0)) * uSunColor * 1.6 * shadow;
    alpha = uAlpha * clamp(0.42 + glassFres * 0.75, 0.0, 1.0);
  }

  // --- emissive & headlights ---------------------------------------------------
  color += albedo * emissive * mix(1.0, 2.4, uNight);
  if (flag == 5) color = albedo * (1.0 + emissive * 2.0);

  if (uHeadlightOn > 0.5 && flag != 5) {
    vec3 toL = uHeadlightPos - vWorld;
    float dist = length(toL);
    vec3 Ld = toL / max(dist, 0.001);
    float spot = smoothstep(0.55, 0.90, dot(-Ld, normalize(uHeadlightDir)));
    float atten = spot / (1.0 + 0.02 * dist * dist);
    color += albedo * uSunColor * 0.0 + albedo * vec3(1.0, 0.96, 0.86) * atten * max(dot(N, Ld), 0.0) * 26.0;
  }

  // --- fog ---------------------------------------------------------------------
  float dist = length(uCameraPos - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  // skyGradient, not skyColor: the cloud projection is unstable at the grazing
  // angles distant geometry sits at, and it shows up as a noise band along the
  // horizon on everything far away.
  vec3 fogged = mix(uFogColor, skyGradient(normalize(vWorld - uCameraPos)), 0.45);
  color = mix(color, fogged, clamp(fog, 0.0, 1.0));

  fragColor = vec4(color, alpha);
}
`;

const SHADOW_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uViewProj;
void main() {
  gl_Position = uViewProj * uModel * vec4(aPosition, 1.0);
}
`;

const SHADOW_FS = `#version 300 es
precision highp float;
void main() {}
`;

// Skybox: a fullscreen triangle with the view ray reconstructed per pixel.
const SKY_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat4 uInvViewProj;
uniform vec3 uCameraPos;
out vec3 vRay;
void main() {
  vec4 far = uInvViewProj * vec4(aPos, 1.0, 1.0);
  vRay = far.xyz / far.w - uCameraPos;
  gl_Position = vec4(aPos, 1.0, 1.0);
}
`;

const SKY_FS = `#version 300 es
${GLSL_COMMON}
in vec3 vRay;
uniform vec3 uFogColor;
out vec4 fragColor;
void main() {
  vec3 d = normalize(vRay);
  vec3 col = skyColor(d);
  // Haze band so the world does not end at a hard horizon line.
  col = mix(col, uFogColor, (1.0 - smoothstep(-0.02, 0.10, d.y)) * 0.85);
  fragColor = vec4(col, 1.0);
}
`;

const POST_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(lum - uThreshold, 0.0) / max(lum, 1e-4);
  fragColor = vec4(c * k, 1.0);
}
`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uDirection;
out vec4 fragColor;
void main() {
  float w[5];
  w[0] = 0.227027; w[1] = 0.194594; w[2] = 0.121621; w[3] = 0.054054; w[4] = 0.016216;
  vec3 sum = texture(uSource, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uDirection * float(i);
    sum += texture(uSource, vUv + off).rgb * w[i];
    sum += texture(uSource, vUv - off).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}
`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uSpeedBlur;
uniform float uExposure;
uniform float uVignette;
uniform float uTime;
uniform float uFlash;
out vec4 fragColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 center = vec2(0.5, 0.5);
  vec2 dir = vUv - center;
  vec3 col = texture(uScene, vUv).rgb;

  // Radial blur that scales with speed - cheap but very effective motion cue.
  if (uSpeedBlur > 0.001) {
    float r = dot(dir, dir);
    vec3 acc = col;
    for (int i = 1; i <= 6; i++) {
      float t = float(i) / 6.0;
      vec2 uv = vUv - dir * t * uSpeedBlur * (0.35 + r * 1.8);
      acc += texture(uScene, uv).rgb;
    }
    col = acc / 7.0;
  }

  col += texture(uBloom, vUv).rgb * uBloomStrength;
  col *= uExposure;
  col = aces(col);

  // Slight chromatic aberration toward the edges.
  float ca = 0.0016 * (0.25 + uSpeedBlur * 8.0);
  col.r = aces(texture(uScene, vUv + dir * ca).rgb * uExposure).r;
  col.b = aces(texture(uScene, vUv - dir * ca).rgb * uExposure).b;

  float vig = 1.0 - uVignette * dot(dir, dir) * 1.6;
  col *= clamp(vig, 0.0, 1.0);

  // Film grain keeps flat sky gradients from banding.
  float grain = fract(sin(dot(vUv * vec2(1.0, 1.3) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  col += (grain - 0.5) * 0.018;

  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}
`;

// Particles: camera-facing quads expanded in the vertex shader.
const PARTICLE_VS = `#version 300 es
layout(location = 0) in vec3 aCenter;
layout(location = 1) in vec4 aParams;  // size, alpha, rotation, kind
layout(location = 2) in vec3 aTint;
layout(location = 3) in vec2 aCorner;

uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;

out vec2 vCorner;
out float vAlpha;
out vec3 vTint;

void main() {
  float s = aParams.x;
  float rot = aParams.z;
  vec2 c = vec2(aCorner.x * cos(rot) - aCorner.y * sin(rot),
                aCorner.x * sin(rot) + aCorner.y * cos(rot));
  vec3 world = aCenter + uCamRight * c.x * s + uCamUp * c.y * s;
  vCorner = aCorner;
  vAlpha = aParams.y;
  vTint = aTint;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

const PARTICLE_FS = `#version 300 es
precision highp float;
in vec2 vCorner;
in float vAlpha;
in vec3 vTint;
out vec4 fragColor;
void main() {
  float d = length(vCorner);
  float a = (1.0 - smoothstep(0.15, 1.0, d)) * vAlpha;
  if (a <= 0.002) discard;
  fragColor = vec4(vTint, a);
}
`;

// Ground decals: skid marks and shadows blended onto the road.
const DECAL_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aData;   // alpha, unused
uniform mat4 uViewProj;
out float vAlpha;
void main() {
  vAlpha = aData.x;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}
`;

const DECAL_FS = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  if (vAlpha <= 0.003) discard;
  fragColor = vec4(uColor, vAlpha);
}
`;
