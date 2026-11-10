// 3D renderer (three.js).
//
// Scene: terrain with a painted ground texture and a horizon skirt, extruded buildings with
// roofs, windows, doors and rooftop details, streets with sidewalks, markings, streetlights and
// moving traffic, creeks, instanced trees that follow the seasons, and a shader sky with clouds,
// sun and stars. Lighting follows a time-of-day preset (morning, afternoon, sunset, night).
//
// It exposes the same camera interface as the 2D renderer (cx, cy, scale, toWorld, toScreen, pan,
// zoomAt, viewBB...) so every tool works in both views.
'use strict';

SG.TOD = {
  morning: { icon: '🌅', label: 'Morning', sun: [0.78, 0.42, 0.3], sunCol: '#ffdcae', sunI: 1.6, skyTop: '#4f8fd8', skyHor: '#f2dcc4',
    hemiSky: '#eaf2ff', hemiGnd: '#77805c', hemiI: 0.05, fog: '#ecdccb', lit: 0.06, night: 0, glass: '#8496aa', exposure: 0.95, env: 0.3 },
  day: { icon: '☀️', label: 'Afternoon', sun: [-0.62, 0.56, 0.45], sunCol: '#fff3df', sunI: 1.75, skyTop: '#3f86da', skyHor: '#c6ddf2',
    hemiSky: '#eef6ff', hemiGnd: '#77805c', hemiI: 0.05, fog: '#cbdef0', lit: 0, night: 0, glass: '#8194a8', exposure: 0.95, env: 0.3 },
  sunset: { icon: '🌇', label: 'Sunset', sun: [-0.93, 0.16, 0.2], sunCol: '#ff9a56', sunI: 1.7, skyTop: '#3f5596', skyHor: '#ffad73',
    hemiSky: '#e9c0a6', hemiGnd: '#55524a', hemiI: 0.05, fog: '#eaa882', lit: 0.42, night: 0.35, glass: '#59606e', exposure: 1.0, env: 0.4 },
  night: { icon: '🌙', label: 'Night', sun: [0.35, 0.8, -0.45], sunCol: '#93a9de', sunI: 0.3, skyTop: '#040816', skyHor: '#131d3a',
    hemiSky: '#2a3a66', hemiGnd: '#0d1220', hemiI: 0.18, fog: '#0f1730', lit: 0.72, night: 1, glass: '#1c2433', exposure: 1.3, env: 0.9 },
};
SG.TOD_ORDER = ['day', 'sunset', 'night', 'morning'];

SG.Renderer3D = class Renderer3D {
  static supported() {
    try { const c = document.createElement('canvas'); return !!(window.THREE && (c.getContext('webgl2') || c.getContext('webgl'))); }
    catch (e) { return false; }
  }
  static hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }

  constructor(glCanvas, hudCanvas, world, sim) {
    const T = THREE;
    T.ColorManagement.legacyMode = false; // colours are authored in sRGB and lit in linear light
    this.gl = glCanvas; this.hud = hudCanvas; this.ctx = hudCanvas.getContext('2d');
    this.sim = sim;
    this.overlay = 'none';
    this.dirty = true; this.zoneDirty = true; this.hudDirty = true;
    this.ghost = null; this.selected = null;
    this.yaw = 0.35; this.pitch = 0.7; this.dist = 3000; this.tx = 0; this.ty = 0;
    this.fov = 45;
    this.time = 0; this.lastT = 0;
    this.pz = 0; this.pzx = 0; this.pzy = 0; this.pyaw = 0; this.ppitch = 0;
    this.autoOrbit = false; this.photo = false;

    // graphics quality: 0 full, 1 lower resolution, 2 no shadows, 3 static (no animation, no building detail)
    let mode = 'auto';
    try { mode = new URLSearchParams(location.search).get('gfx') || localStorage.getItem('simsaratoga.gfx') || 'auto'; } catch (e) { /* ignore */ }
    this.gfxMode = mode;
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    this.q = mode === 'low' ? 3 : mode === 'high' ? 0 : coarse ? 1 : 0;
    this.slow = 0; this.ema = 0.016;

    this.renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new T.Scene();
    // With WebGL2 the frame is finished in screen space (see post3d.js). Without it we fall
    // back to three's built-in tone mapping and plain distance fog.
    this.post = this.renderer.capabilities.isWebGL2 && SG.Post ? new SG.Post(this.renderer) : null;
    if (!this.post) {
      this.renderer.outputEncoding = T.sRGBEncoding;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.scene.fog = new T.Fog('#cfe2f1', 4000, 16000);
    }
    this.camera = new T.PerspectiveCamera(this.fov, 1, 5, 40000);

    this.hemi = new T.HemisphereLight('#eef6ff', '#6f7d50', 0.1);
    this.sun = new T.DirectionalLight('#fff1d6', 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.raycaster = new T.Raycaster();
    this.chunks = new Map();
    this.uTime = { value: 0 };
    this.uLit = { value: 0 };
    this.uGlass = { value: new T.Color('#41566e') };
    this.makeMaterials();
    this.makeSky();
    this.tod = 'day'; this.todT = 1;
    this.todCur = this.todParse(SG.TOD.day); this.todFrom = this.todCur; this.todTo = this.todCur;
    this.setWorld(world);
    this.resize();
    this.fit();
    this.applyTod(this.todCur);
  }

  // ---------- materials, sky, time of day ----------
  makeMaterials() {
    const T = THREE;
    const NOISE = Renderer3D.NOISE;
    // Surface detail is generated in the fragment shader from world position, so the merged,
    // vertex-coloured meshes need no texture coordinates. It fades out with distance.
    const detail = (mat, code) => {
      mat.extensions = { derivatives: true };
      mat.onBeforeCompile = sh => {
        sh.uniforms.uTime = this.uTime;
        sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'varying vec3 vWp;\nuniform float uTime;\n' + NOISE + '\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + code);
      };
      return mat;
    };
    const std = o => new T.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o));
    this.groundDetail = `
      float px = length(dFdx(vWp)) + length(dFdy(vWp));
      float g1 = vn(vWp.xz * 0.06), g2 = vn(vWp.xz * 0.8), g3 = vn(vWp.xz * 6.0);
      diffuseColor.rgb *= (0.9 + 0.2 * g1) * mix(1.0, 0.84 + 0.32 * g2, 1.0 - smoothstep(1.5, 12.0, px)) * mix(1.0, 0.86 + 0.28 * g3, 1.0 - smoothstep(0.25, 2.5, px));`;
    // walls: stucco mottling and faint siding; pitched roofs: staggered shingle courses; flat roofs: gravel
    this.bldMat = detail(std({ vertexColors: true, roughness: 0.88 }), `
      vec3 fdx = dFdx(vWp), fdy = dFdy(vWp);
      vec3 wn = normalize(cross(fdx, fdy));
      float upf = abs(wn.y), px = length(fdx) + length(fdy);
      float nearF = 1.0 - smoothstep(0.06, 0.45, px), var = 1.0;
      if (upf > 0.2 && upf < 0.985) {
        float sl = vWp.y / max(0.2, sqrt(1.0 - upf * upf));
        float al = dot(vWp.xz, normalize(vec2(-wn.z, wn.x) + 1e-5));
        float row = floor(sl / 0.38), c = fract(sl / 0.38);
        float tile = h21(vec2(row, floor(al / 0.55 + mod(row, 2.0) * 0.5)));
        var = (0.84 + 0.24 * tile) * (0.78 + 0.22 * smoothstep(0.0, 0.3, c));
      } else if (upf <= 0.2) {
        var = (0.92 + 0.16 * vn(vWp.xz * 5.0 + vWp.y * 3.1)) * (0.965 + 0.035 * step(0.5, fract(vWp.y * 4.0)));
      } else var = 0.88 + 0.24 * vn(vWp.xz * 7.0);
      diffuseColor.rgb *= mix(1.0, var, nearF) * (0.93 + 0.14 * vn(vWp.xz * 0.35 + vWp.y * 0.2));`);
    this.detailMat = std({ vertexColors: true, side: T.DoubleSide, roughness: 0.7 });
    // windows: reflective glass by day; at dusk and night each window lights up when its random
    // threshold (stored in the colour's alpha) falls below uLit, bright enough to bloom
    this.winMat = std({ vertexColors: true, roughness: 0.06, metalness: 0.8, envMapIntensity: 1.25 });
    this.winMat.onBeforeCompile = sh => {
      sh.uniforms.uLit = this.uLit; sh.uniforms.uGlass = this.uGlass;
      sh.fragmentShader = 'uniform float uLit;\nuniform vec3 uGlass;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', 'float lit = step(vColor.a, uLit);\n diffuseColor.rgb = uGlass * (0.8 + 0.4 * fract(vColor.a * 7.0)) * (1.0 - lit);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * lit * 2.6;');
    };
    const off = (f) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
    this.walkMat = detail(std(Object.assign({ vertexColors: true, roughness: 0.95 }, off(-2))), `
      diffuseColor.rgb *= 0.9 + 0.2 * vn(vWp.xz * 3.0);
      float pxw = length(dFdx(vWp)) + length(dFdy(vWp));
      diffuseColor.rgb *= mix(1.0, 0.86 + 0.14 * step(0.06, fract((vWp.x + vWp.z) * 0.33)), 1.0 - smoothstep(0.05, 0.4, pxw));`);
    this.roadMat = detail(std(Object.assign({ vertexColors: true, roughness: 0.92 }, off(-4))), `
      float pxr = length(dFdx(vWp)) + length(dFdy(vWp));
      diffuseColor.rgb *= (0.9 + 0.2 * vn(vWp.xz * 0.4)) * mix(1.0, 0.82 + 0.36 * vn(vWp.xz * 9.0), 1.0 - smoothstep(0.05, 0.6, pxr));`);
    this.markMat = std(Object.assign({ vertexColors: true, roughness: 0.8 }, off(-6)));
    // creek: glossy, reflects the sky, with a little moving shimmer
    this.waterMat = detail(std(Object.assign({ color: '#2f5f7a', roughness: 0.08, metalness: 0.35, envMapIntensity: 1.4 }, off(-3))), `
      diffuseColor.rgb *= 1.0 + 0.25 * sin(vWp.x * 0.9 + vWp.z * 0.7 - uTime * 2.2) + 0.18 * sin(vWp.x * 0.31 - vWp.z * 0.43 + uTime * 1.3);`);
    // trees sway a little in the wind
    this.treeMat = std({ vertexColors: true, roughness: 1 });
    this.treeMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n#ifdef USE_INSTANCING\n float ph = instanceMatrix[3][0] * 0.07 + instanceMatrix[3][2] * 0.05;\n float sw = sin(uTime * 1.4 + ph) * 0.03 * transformed.y;\n transformed.x += sw; transformed.z += sw * 0.6;\n#endif');
    };
    this.carMat = std({ vertexColors: true, roughness: 0.32, metalness: 0.55, envMapIntensity: 1.2 });
    this.carLightMat = new T.MeshBasicMaterial({ vertexColors: true }); this.carLightMat.color.setRGB(5, 5, 5);
    this.poleMat = std({ color: '#70757a', roughness: 0.6, metalness: 0.5 });
    this.lampMat = new T.MeshBasicMaterial(); this.lampMat.color.setRGB(7, 5.6, 3.4);
    const gc = document.createElement('canvas'); gc.width = gc.height = 64;
    const g = gc.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    this.glowMat = new T.MeshBasicMaterial(Object.assign({ map: new T.CanvasTexture(gc), transparent: true, opacity: 0,
      blending: T.AdditiveBlending, depthWrite: false }, off(-8)));
    this.glowMat.color.setRGB(0.42, 0.25, 0.09);
    this.cityLightMat = new T.PointsMaterial({ size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
    this.cityLightMat.color.setRGB(1.6, 1.15, 0.55);
  }
  makeSky() {
    const T = THREE;
    this.skyU = { top: { value: new T.Color() }, hor: { value: new T.Color() }, sunDir: { value: new T.Vector3(0, 1, 0) },
      sunCol: { value: new T.Color() }, gnd: { value: new T.Color() }, night: { value: 0 }, time: this.uTime };
    const mat = new T.ShaderMaterial({
      uniforms: this.skyU, side: T.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: 'varying vec3 vDir;\nvoid main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 top, hor, sunDir, sunCol, gnd; uniform float night, time; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = mix(hor, top, pow(clamp(d.y, 0.0, 1.0), 0.5));
          float s = max(dot(d, sunDir), 0.0);
          col += sunCol * (pow(s, 700.0) * 2.2 + pow(s, 14.0) * 0.22);
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.12) * 1.25 + vec2(time * 0.006, time * 0.002);
            float c = smoothstep(0.5, 0.82, fbm(uv)) * smoothstep(0.0, 0.2, d.y);
            vec3 cloud = mix(vec3(1.0), sunCol, 0.4) * (1.0 - night * 0.86);
            float st = step(0.988, hash(floor(d.xz / (d.y + 0.35) * 110.0))) * night * smoothstep(0.03, 0.3, d.y);
            col += vec3(st) * 0.85 * (1.0 - c);
            col = mix(col, cloud, c * 0.86);
          } else col = mix(hor, gnd, clamp(-d.y * 6.0, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new T.Mesh(new T.SphereGeometry(1, 32, 18), mat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    // the same sky, rendered into a prefiltered cube map, lights every material (ambient and reflections)
    this.pmrem = new T.PMREMGenerator(this.renderer);
    this.envScene = new T.Scene();
    const es = new T.Mesh(this.sky.geometry, mat); es.scale.setScalar(100); es.frustumCulled = false;
    this.envScene.add(es);
    this.envDirty = true;
  }
  todParse(d) {
    const T = THREE, c = h => new T.Color(h);
    return { sun: new T.Vector3(...d.sun).normalize(), sunCol: c(d.sunCol), sunI: d.sunI, skyTop: c(d.skyTop), skyHor: c(d.skyHor),
      hemiSky: c(d.hemiSky), hemiGnd: c(d.hemiGnd), hemiI: d.hemiI, fog: c(d.fog), lit: d.lit, night: d.night, glass: c(d.glass),
      exposure: d.exposure, env: d.env };
  }
  todLerp(a, b, t) {
    const o = {};
    for (const k in a) {
      if (typeof a[k] === 'number') o[k] = a[k] + (b[k] - a[k]) * t;
      else if (a[k].isColor) o[k] = a[k].clone().lerp(b[k], t);
      else o[k] = a[k].clone().lerp(b[k], t).normalize();
    }
    return o;
  }
  applyTod(s) {
    this.todCur = s;
    this.sun.color.copy(s.sunCol); this.sun.intensity = s.sunI;
    this.hemi.color.copy(s.hemiSky); this.hemi.groundColor.copy(s.hemiGnd); this.hemi.intensity = s.hemiI;
    if (this.scene.fog) this.scene.fog.color.copy(s.fog);
    if (!this.post) this.renderer.toneMappingExposure = s.exposure;
    this.skyU.top.value.copy(s.skyTop); this.skyU.hor.value.copy(s.skyHor); this.skyU.sunDir.value.copy(s.sun);
    this.skyU.sunCol.value.copy(s.sunCol); this.skyU.night.value = s.night;
    // light bouncing up off the ground: its colour, scaled by how much sun there is
    this.skyU.gnd.value.copy(s.hemiGnd).multiplyScalar(0.25 + 0.12 * s.sunI * Math.max(0.1, s.sun.y));
    this.uLit.value = s.lit; this.uGlass.value.copy(s.glass);
    this.glowMat.opacity = Math.min(1, s.night * 1.4) * 0.9;
    this.cityLightMat.opacity = s.night * 0.9;
    this.envDirty = true;
    this.dirty = true;
  }
  updateEnv() {
    this.envDirty = false;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.03, 0.1, 1000);
    this.scene.environment = this.envRT.texture;
    if (old) old.dispose();
    const k = this.todCur.env;
    for (const m of [this.bldMat, this.detailMat, this.walkMat, this.roadMat, this.markMat, this.treeMat, this.poleMat, this.terrainMat, this.skirtMat])
      if (m) m.envMapIntensity = k;
    this.winMat.envMapIntensity = k * 1.1; this.waterMat.envMapIntensity = k * 1.2; this.carMat.envMapIntensity = k;
  }
  setPhoto(on) { this.photo = on; this.dirty = this.hudDirty = true; }
  savePhoto(name = 'simsaratoga.png') {
    this.dirty = true; this.draw(performance.now()); // the drawing buffer is only readable right after a render
    this.gl.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }
  setTod(name) {
    if (!SG.TOD[name]) return;
    this.tod = name;
    this.todFrom = this.todCur; this.todTo = this.todParse(SG.TOD[name]); this.todT = 0;
    this.dirty = true;
  }
  cycleTod() { this.setTod(SG.TOD_ORDER[(SG.TOD_ORDER.indexOf(this.tod) + 1) % SG.TOD_ORDER.length]); return SG.TOD[this.tod]; }
  setGfx(mode) {
    this.gfxMode = mode;
    try { localStorage.setItem('simsaratoga.gfx', mode); } catch (e) { /* ignore */ }
    this.q = mode === 'low' ? 3 : 0; this.slow = 0;
    this.resize();
  }

  setSim(sim) { this.sim = sim; this.dirty = this.zoneDirty = true; }
  get w() { return this._w; }
  set w(world) { if (world !== this._w && this._w) this.setWorld(world); else this._w = world; }

  setWorld(world) {
    this._w = world;
    this.disposeChunks();
    for (const k of ['terrain', 'overlayMesh', 'skirt', 'walkMesh', 'roadMesh', 'markMesh', 'waterMesh', 'cityLights'])
      if (this[k]) { this.scene.remove(this[k]); this[k].geometry.dispose(); this[k] = null; }
    if (this.treeTiles) for (const t of this.treeTiles) for (const m of t.meshes.concat(t.hi)) this.scene.remove(m);
    this.buildTerrain();
    this.buildSkirt();
    this.buildRoads();
    this.buildWater();
    this.syncBuildings();
    this.buildCityLights();
    this.buildTrees();
    this.seen = { v: world.version, r: world.roadVersion, a: world.areaVersion };
    this.season = -1;
    this._miniDirty = true;
    this.dirty = this.zoneDirty = true;
  }
  disposeChunks() {
    for (const c of this.chunks.values()) this.dropChunk(c);
    this.chunks.clear();
  }
  dropChunk(c) {
    for (const m of [c.mesh, c.detail, c.win]) if (m) { this.scene.remove(m); m.geometry.dispose(); }
  }

  // ---------- camera interface shared with the 2D renderer ----------
  get cx() { return this.tx; } set cx(v) { this.tx = v; this.dirty = true; }
  get cy() { return this.ty; } set cy(v) { this.ty = v; this.dirty = true; }
  get scale() { return this.vh / (2 * this.dist * Math.tan(this.fov * Math.PI / 360)); }
  set scale(s) { this.dist = Math.max(18, Math.min(14000, this.vh / (2 * Math.tan(this.fov * Math.PI / 360) * s))); this.dirty = true; }
  get minScale() { return this.vh / (2 * 14000 * Math.tan(this.fov * Math.PI / 360)); }

  resize() {
    const r = this.gl.getBoundingClientRect();
    this.vw = Math.max(1, r.width); this.vh = Math.max(1, r.height);
    const dev = window.devicePixelRatio || 1;
    this.dpr = Math.min(2, dev);
    this.pr = this.q === 0 ? this.dpr : this.q === 1 ? Math.min(1.25, dev) : 1;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(this.vw, this.vh, false);
    if (this.post) { this.post.opts.msaa = this.q < 2 ? 4 : 0; this.post.setSize(this.vw * this.pr, this.vh * this.pr); }
    this.camera.aspect = this.vw / this.vh;
    this.camera.updateProjectionMatrix();
    this.hud.width = Math.round(this.vw * this.dpr); this.hud.height = Math.round(this.vh * this.dpr);
    this.dirty = true;
  }
  fit() {
    const w = this.w;
    const xs = w.boundary.flatMap(r => Array.from(r.filter((_, i) => i % 2 === 0)));
    const ys = w.boundary.flatMap(r => Array.from(r.filter((_, i) => i % 2 === 1)));
    this.tx = (Math.min(...xs) + Math.max(...xs)) / 2;
    this.ty = (Math.min(...ys) + Math.max(...ys)) / 2 + 500;
    this.dist = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.95;
    this.yaw = 0.35; this.pitch = 0.62;
    // open on a closer view of the Village (Big Basin Way) when the map has it
    const v = w.pois.find(p => /saratoga village/i.test(p.name));
    const bb = w.roads.find(r => /big basin/i.test(r.name));
    const at = v ? [v.x, v.y] : bb ? [bb.pts[0], bb.pts[1]] : null;
    if (at) { this.tx = at[0]; this.ty = at[1]; this.dist = 1500; this.yaw = 0.9; this.pitch = 0.42; }
    this.dirty = true;
  }
  updateCamera() {
    const h = this.w.heightAt(this.tx, this.ty);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cam = this.camera;
    cam.position.set(this.tx + this.dist * cp * Math.sin(this.yaw), h + this.dist * sp, this.ty + this.dist * cp * Math.cos(this.yaw));
    const ground = this.w.heightAt(cam.position.x, cam.position.z);
    if (cam.position.y < ground + 2.2) cam.position.y = ground + 2.2; // eye height: street-level views are allowed
    cam.lookAt(this.tx, h + Math.min(12, this.dist * 0.02), this.ty);
    cam.near = Math.max(0.6, this.dist / 300); cam.far = this.dist * 6 + 45000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    if (this.scene.fog) { this.scene.fog.near = this.dist * 1.6 + 300; this.scene.fog.far = this.dist * 5 + 9000; }
    this.sky.position.copy(cam.position); this.sky.scale.setScalar(cam.far * 0.5);

    // the shadow box follows the view
    const ext = Math.min(2600, Math.max(140, this.dist * 0.9));
    const s = this.todCur.sun;
    this.sun.position.set(this.tx + s.x * ext * 2.2, h + s.y * ext * 2.2, this.ty + s.z * ext * 2.2);
    this.sun.target.position.set(this.tx, h, this.ty);
    this.sun.target.updateMatrixWorld();
    const sc = this.sun.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = ext * 6;
    sc.updateProjectionMatrix();
    this.sun.castShadow = this.dist < 5000 && this.q < 2;
  }
  toScreen(x, y, h) {
    const v = this._v || (this._v = new THREE.Vector3());
    v.set(x, h == null ? this.w.heightAt(x, y) : h, y).project(this.camera);
    return [(v.x + 1) / 2 * this.vw, (1 - v.y) / 2 * this.vh, v.z];
  }
  ray(sx, sy) {
    this.raycaster.setFromCamera(new THREE.Vector2(sx / this.vw * 2 - 1, -(sy / this.vh) * 2 + 1), this.camera);
    return this.raycaster.ray;
  }
  toWorld(sx, sy) {
    this.updateCamera();
    const { origin: o, direction: d } = this.ray(sx, sy);
    if (d.y > -0.02) { const f = 12000; return [o.x + d.x * f, o.z + d.z * f]; } // above the horizon
    let h = this.w.heightAt(this.tx, this.ty), x = o.x, z = o.z;
    for (let k = 0; k < 6; k++) {
      const t = Math.min(30000, (h - o.y) / d.y);
      x = o.x + d.x * t; z = o.z + d.z * t;
      h = this.w.heightAt(x, z);
    }
    return [x, z];
  }
  // Like toWorld, but hits buildings first (for inspecting and bulldozing).
  pickWorld(sx, sy) {
    this.updateCamera();
    this.ray(sx, sy);
    const meshes = [...this.chunks.values()].map(c => c.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (hit) {
      const c = hit.object.userData.chunk;
      const b = this.w.buildings[c.triIds[hit.faceIndex]];
      if (b && !b.removed) {
        const dx = b.cx - hit.point.x, dz = b.cy - hit.point.z, L = Math.hypot(dx, dz) || 1;
        const k = Math.min(L, 0.9); // roofs overhang the walls a little
        return [hit.point.x + dx / L * k, hit.point.z + dz / L * k];
      }
    }
    return this.toWorld(sx, sy);
  }
  pan(dx, dy) {
    const s = this.scale, sy = Math.max(0.3, Math.sin(this.pitch));
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.tx += -dx / s * rx + dy / (s * sy) * fx;
    this.ty += -dx / s * rz + dy / (s * sy) * fz;
    this.clampTarget();
    this.dirty = true;
  }
  clampTarget() {
    const w = this.w;
    this.tx = Math.max(w.x0, Math.min(w.x1, this.tx)); this.ty = Math.max(w.y0, Math.min(w.y1, this.ty));
  }
  zoomAt(sx, sy, f) {
    const before = this.toWorld(sx, sy);
    this.dist = Math.max(18, Math.min(14000, this.dist / f));
    const after = this.toWorld(sx, sy);
    const mx = before[0] - after[0], my = before[1] - after[1];
    if (Math.hypot(mx, my) < this.dist * 3) { this.tx += mx; this.ty += my; }
    this.clampTarget();
    this.dirty = true;
  }
  zoomSmooth(sx, sy, f) { this.pz += Math.log(f); this.pzx = sx; this.pzy = sy; this.dirty = true; }
  orbit(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.04, Math.min(1.5, this.pitch + dy * 0.004));
    this.dirty = true;
  }
  orbitSmooth(dx, dy) { this.pyaw += dx; this.ppitch += dy; this.dirty = true; }
  viewBB() {
    const pts = [[0, 0], [this.vw, 0], [0, this.vh], [this.vw, this.vh], [this.vw / 2, this.vh / 2]].map(([x, y]) => this.toWorld(x, y));
    const lim = Math.max(400, this.dist * 3);
    const xs = pts.map(p => Math.max(this.tx - lim, Math.min(this.tx + lim, p[0])));
    const ys = pts.map(p => Math.max(this.ty - lim, Math.min(this.ty + lim, p[1])));
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  // ---------- terrain, ground texture, horizon ----------
  tintFor(h, x, y) { // ground colour by elevation: valley floor to wooded hills
    const t = Math.max(0, Math.min(1, (h - 126) / 260));
    const n = x == null ? 0 : (Renderer3D.hash((x * 73856093) ^ (y * 19349663)) - 0.5) * 10;
    return [150 + (100 - 150) * t + n, 163 + (130 - 163) * t + n, 118 + (84 - 118) * t + n * 0.6];
  }
  buildTerrain() {
    const T = THREE, w = this.w;
    const TW = w.TW, TH = w.TH, S = w.TCELL;
    const EW = (TW - 1) * S, EH = (TH - 1) * S;
    const pos = new Float32Array(TW * TH * 3), uv = new Float32Array(TW * TH * 2);
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = j * TW + i;
      pos[3 * k] = w.x0 + i * S; pos[3 * k + 1] = w.hgt[k]; pos[3 * k + 2] = w.y0 + j * S;
      uv[2 * k] = i / (TW - 1); uv[2 * k + 1] = 1 - j / (TH - 1);
    }
    const idx = [];
    for (let j = 0; j < TH - 1; j++) for (let i = 0; i < TW - 1; i++) {
      const a = j * TW + i, b = a + 1, c = a + TW, d = c + 1;
      idx.push(a, c, b, b, c, d); // same split as World.heightAt
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.groundExtent = [EW, EH];
    this.groundCanvas = document.createElement('canvas');
    const max = Math.min(4096, this.renderer.capabilities.maxTextureSize);
    const k = max / Math.max(EW, EH);
    this.groundCanvas.width = Math.round(EW * k); this.groundCanvas.height = Math.round(EH * k);
    this.groundK = k;
    this.groundTex = new T.CanvasTexture(this.groundCanvas);
    this.groundTex.encoding = T.sRGBEncoding;
    this.groundTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.paintGround();
    if (this.terrainMat) this.terrainMat.dispose();
    this.terrainMat = new T.MeshStandardMaterial({ map: this.groundTex, roughness: 1, metalness: 0 });
    this.terrainMat.extensions = { derivatives: true };
    this.terrainMat.onBeforeCompile = sh => {
      sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vWp;\n' + Renderer3D.NOISE + '\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + this.groundDetail);
    };
    this.terrain = new T.Mesh(g, this.terrainMat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    this.overlayTex = null;
    this.overlayMesh = new T.Mesh(g, new T.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.overlayMesh.visible = false;
    this.overlayMesh.renderOrder = 2;
    this.scene.add(this.overlayMesh);
  }
  // Rings of terrain from the map edge out to the horizon, so the world doesn't end at the city.
  buildSkirt() {
    const T = THREE, w = this.w, TW = w.TW, TH = w.TH, S = w.TCELL;
    const loop = [];
    for (let i = 0; i < TW - 1; i++) loop.push([i, 0]);
    for (let j = 0; j < TH - 1; j++) loop.push([TW - 1, j]);
    for (let i = TW - 1; i > 0; i--) loop.push([i, TH - 1]);
    for (let j = TH - 1; j > 0; j--) loop.push([0, j]);
    const cx = w.x0 + (TW - 1) * S / 2, cy = w.y0 + (TH - 1) * S / 2;
    const rings = [0, 120, 300, 600, 1000, 1600, 2400, 3500, 5000, 7000, 10000, 14000, 19000, 26000];
    const N = loop.length, pos = new Float32Array(N * rings.length * 3), col = new Float32Array(N * rings.length * 3);
    for (let k = 0; k < rings.length; k++) for (let i = 0; i < N; i++) {
      const [gi, gj] = loop[i];
      const bx = w.x0 + gi * S, by = w.y0 + gj * S;
      const L = Math.hypot(bx - cx, by - cy) || 1;
      const x = bx + (bx - cx) / L * rings[k], y = by + (by - cy) / L * rings[k];
      const h = k === 0 ? w.hgt[gj * TW + gi] : w.elevFn(x, y);
      const o = (k * N + i) * 3;
      pos[o] = x; pos[o + 1] = h; pos[o + 2] = y;
      const c = this.tintFor(h);
      col[o] = Math.pow(c[0] / 255, 2.2); col[o + 1] = Math.pow(c[1] / 255, 2.2); col[o + 2] = Math.pow(c[2] / 255, 2.2);
    }
    const idx = [];
    const up = (a, b, c) => { // wind each triangle so it faces up
      const ux = pos[3 * b] - pos[3 * a], uz = pos[3 * b + 2] - pos[3 * a + 2], vx = pos[3 * c] - pos[3 * a], vz = pos[3 * c + 2] - pos[3 * a + 2];
      if (uz * vx - ux * vz >= 0) idx.push(a, b, c); else idx.push(a, c, b);
    };
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < N; i++) {
      const a = k * N + i, b = k * N + (i + 1) % N, c = a + N, d = b + N;
      up(a, b, c); up(b, d, c);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (this.skirtMat) this.skirtMat.dispose();
    this.skirtMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.skirtMat.extensions = { derivatives: true };
    this.skirtMat.onBeforeCompile = this.terrainMat.onBeforeCompile;
    this.skirt = new T.Mesh(g, this.skirtMat);
    this.scene.add(this.skirt);
  }
  driveway(b) { // closest point on a street, cached per building
    if (b._drv !== undefined) return b._drv;
    let best = null, bd = 45 * 45;
    for (const r of this.w.roadsIn([b.cx - 45, b.cy - 45, b.cx + 45, b.cy + 45])) {
      if (r.cls > 4) continue;
      const p = r.pts;
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], ay = p[i - 1], dx = p[i] - ax, dy = p[i + 1] - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((b.cx - ax) * dx + (b.cy - ay) * dy) / l2)) : 0;
        const qx = ax + t * dx, qy = ay + t * dy, d2 = (qx - b.cx) ** 2 + (qy - b.cy) ** 2;
        if (d2 < bd) { bd = d2; best = [qx, qy]; }
      }
    }
    return (b._drv = best);
  }
  paintGround() {
    const w = this.w, c = this.groundCanvas, g = c.getContext('2d'), k = this.groundK;
    const X = x => (x - w.x0) * k, Y = y => (y - w.y0) * k;
    const path = (p, close = true) => {
      g.moveTo(X(p[0]), Y(p[1]));
      for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]), Y(p[i + 1]));
      if (close) g.closePath();
    };
    // base: elevation tint, one pixel per terrain vertex, scaled up
    const tc = document.createElement('canvas'); tc.width = w.TW; tc.height = w.TH;
    const tg = tc.getContext('2d'), img = tg.createImageData(w.TW, w.TH);
    for (let j = 0; j < w.TH; j++) for (let i = 0; i < w.TW; i++) {
      const o = (j * w.TW + i) * 4, col = this.tintFor(w.hgt[j * w.TW + i], i, j);
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(tc, 0, 0, w.TW - 1, w.TH - 1, 0, 0, c.width, c.height);
    // city land a little lighter and warmer than the surrounding country
    g.beginPath(); for (const r of w.boundary) path(r);
    g.fillStyle = 'rgba(176,180,136,0.4)'; g.fill('evenodd');
    // lawns and driveways
    for (const b of w.buildings) {
      if (b.removed || (b.kind !== 'house' && b.kind !== 'duplex')) continue;
      const r = Math.min(30, Math.sqrt(b.area) * 1.4) * k;
      g.fillStyle = Renderer3D.hash(b.id + 9) < 0.5 ? '#9aac72' : '#a3b27b';
      g.fillRect(X(b.cx) - r, Y(b.cy) - r, 2 * r, 2 * r);
    }
    g.strokeStyle = '#c3bfb4'; g.lineWidth = Math.max(1, 3.2 * k); g.lineCap = 'butt';
    g.beginPath();
    for (const b of w.buildings) {
      if (b.removed || b.kind !== 'house') continue;
      const d = this.driveway(b);
      if (d) { g.moveTo(X(b.cx), Y(b.cy)); g.lineTo(X(d[0]), Y(d[1])); }
    }
    g.stroke();
    const col = Object.assign({}, SG.AREA_COLORS, { forest: '#55784a', park: '#86ad6a', golf: '#93ba78', sports: '#94bd7c', orchard: '#a3ae72',
      residential: null, commercial: '#cfc9bd', parking: '#bdbab2', water: '#5a9bd0', pool: '#62b7e0' });
    for (const a of w.areas) {
      if (a.removed || !col[a.kind]) continue;
      g.beginPath(); path(a.pts); g.fillStyle = col[a.kind]; g.fill();
      if (a.kind === 'orchard' || a.kind === 'sports') { // tree rows and mowing stripes
        g.save(); g.clip();
        const bb = a.bb || (a.bb = SG.World.bbox(a.pts)), step = a.kind === 'orchard' ? 9 : 12;
        g.strokeStyle = a.kind === 'orchard' ? 'rgba(120,105,70,.35)' : 'rgba(255,255,255,.14)'; g.lineWidth = Math.max(1, step * 0.4 * k);
        g.beginPath();
        for (let y = bb[1]; y < bb[3]; y += step) { g.moveTo(X(bb[0]), Y(y)); g.lineTo(X(bb[2]), Y(y)); }
        g.stroke(); g.restore();
      }
    }
    // pads under buildings read as patios and soften where walls meet the ground
    g.fillStyle = 'rgba(70,70,60,.22)';
    for (const b of w.buildings) {
      if (b.removed) continue;
      const r = (Math.sqrt(b.area) / 2 + 1.5) * k;
      g.fillRect(X(b.cx) - r, Y(b.cy) - r, 2 * r, 2 * r);
    }
    // grass speckle
    const nc = document.createElement('canvas'); nc.width = nc.height = 128;
    const ng = nc.getContext('2d'), ni = ng.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) { const v = Renderer3D.hash(i * 7 + 1); ni.data[4 * i] = ni.data[4 * i + 1] = ni.data[4 * i + 2] = v < 0.5 ? 0 : 255; ni.data[4 * i + 3] = 14; }
    ng.putImageData(ni, 0, 0);
    g.fillStyle = g.createPattern(nc, 'repeat'); g.fillRect(0, 0, c.width, c.height);
    // trails are painted; streets get a dark bed so they read from far away
    g.strokeStyle = '#b9a47c'; g.lineWidth = Math.max(1, 2 * k); g.setLineDash([3, 2]);
    g.beginPath(); for (const r of w.roads) if (!r.removed && r.cls >= 5) path(r.pts, false); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#8c8b84'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of w.roads) {
      if (r.removed || r.cls > 4) continue;
      g.lineWidth = Math.max(1, SG.ROAD_STYLE[r.cls][0] * k * 1.2);
      g.beginPath(); path(r.pts, false); g.stroke();
    }
    g.beginPath(); for (const r of w.boundary) path(r);
    g.setLineDash([10, 6]); g.strokeStyle = 'rgba(120,40,90,.55)'; g.lineWidth = 3; g.stroke(); g.setLineDash([]);
    this.groundTex.needsUpdate = true;
  }
  updateOverlay() {
    const T = THREE;
    if (this.overlay === 'none') { this.overlayMesh.visible = false; this.zoneDirty = false; return; }
    SG.Renderer.prototype.buildOverlay.call(this);
    const [EW, EH] = this.groundExtent;
    const c = this._ovc || (this._ovc = document.createElement('canvas'));
    c.width = Math.round(EW / SG.CELL); c.height = Math.round(EH / SG.CELL);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.overlayCanvas, 0, 0);
    if (!this.overlayTex) {
      this.overlayTex = new T.CanvasTexture(c);
      this.overlayTex.encoding = T.sRGBEncoding;
      this.overlayTex.magFilter = T.NearestFilter; this.overlayTex.minFilter = T.LinearFilter;
      this.overlayMesh.material.map = this.overlayTex;
      this.overlayMesh.material.needsUpdate = true;
    }
    this.overlayTex.needsUpdate = true;
    this.overlayMesh.visible = true;
  }
  gridCanvas(fill) { return SG.Renderer.prototype.gridCanvas.call(this, fill); }

  // ---------- streets, markings, creeks ----------
  // Flat ribbons along polylines. opts: width(item), color(item), lift, offset(item), dash [on, off], step
  ribbon(list, opts) {
    const w = this.w, pos = [], col = [];
    const color = new THREE.Color();
    const step = opts.step || 18;
    for (const item of list) {
      const p = item.pts;
      const pts = [];
      for (let i = 0; i < p.length - 2; i += 2) {
        const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let s = 0; s < n; s++) pts.push([ax + (bx - ax) * s / n, ay + (by - ay) * s / n]);
      }
      pts.push([p[p.length - 2], p[p.length - 1]]);
      if (pts.length < 2) continue;
      const hw = opts.width(item) / 2, off = opts.offset ? opts.offset(item) : 0;
      color.set(opts.color(item));
      const L = [], R = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        const x = pts[i][0] - dy * off, y = pts[i][1] + dx * off;
        L.push([x - dy * hw, y + dx * hw]); R.push([x + dy * hw, y - dx * hw]);
      }
      const H = q => w.heightAt(q[0], q[1]) + opts.lift;
      let run = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const segLen = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        const on = !opts.dash || (run % (opts.dash[0] + opts.dash[1])) < opts.dash[0];
        run += segLen;
        if (!on) continue;
        const a = L[i], b = R[i], c = L[i + 1], d = R[i + 1];
        pos.push(a[0], H(a), a[1], c[0], H(c), c[1], b[0], H(b), b[1]);
        pos.push(b[0], H(b), b[1], c[0], H(c), c[1], d[0], H(d), d[1]);
        for (let k = 0; k < 6; k++) col.push(color.r, color.g, color.b);
      }
    }
    const P = new Float32Array(pos);
    for (let i = 0; i < P.length; i += 9) { // make sure every triangle faces up
      const ux = P[i + 3] - P[i], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vz = P[i + 8] - P[i + 2];
      if (uz * vx - ux * vz < 0) for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  mergeGeos(list) {
    const pos = [], col = [];
    for (const g of list) { pos.push(...g.attributes.position.array); col.push(...g.attributes.color.array); g.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  buildRoads() {
    const T = THREE, w = this.w;
    for (const k of ['walkMesh', 'roadMesh', 'markMesh']) if (this[k]) { this.scene.remove(this[k]); this[k].geometry.dispose(); }
    const W = r => SG.ROAD_STYLE[r.cls][0];
    const drive = w.roads.filter(r => !r.removed && r.cls <= 4).sort((a, b) => b.cls - a.cls);
    const asphalt = ['#5d5f63', '#66676b', '#6e6f72', '#77787a', '#8f8d87'];
    this.walkMesh = new T.Mesh(this.ribbon(drive.filter(r => r.cls >= 1 && r.cls <= 3), { width: r => W(r) + 3.4, color: () => '#c2bfb6', lift: 0.16 }), this.walkMat);
    this.roadMesh = new T.Mesh(this.ribbon(drive, { width: W, color: r => asphalt[r.cls], lift: 0.3 }), this.roadMat);
    const major = drive.filter(r => r.cls <= 2), art = drive.filter(r => r.cls <= 1), fwy = drive.filter(r => r.cls === 0);
    const lane = (list, off) => this.ribbon(list, { width: () => 0.22, color: () => '#e9e9e4', lift: 0.42, offset: () => off, dash: [3, 9], step: 3 });
    const marks = [
      this.ribbon(major, { width: r => r.cls === 0 ? 1.6 : 0.5, color: r => r.cls === 0 ? '#aeaca4' : '#e3bd3a', lift: 0.42, step: 12 }),
      lane(art, 3.6), lane(art, -3.6), lane(fwy, 7.2), lane(fwy, -7.2),
      this.ribbon(fwy, { width: () => 0.25, color: () => '#e9e9e4', lift: 0.42, offset: () => 11, step: 12 }),
      this.ribbon(fwy, { width: () => 0.25, color: () => '#e9e9e4', lift: 0.42, offset: () => -11, step: 12 }),
    ];
    this.markMesh = new T.Mesh(this.mergeGeos(marks), this.markMat);
    for (const m of [this.walkMesh, this.roadMesh, this.markMesh]) { m.receiveShadow = true; this.scene.add(m); }
    this.buildStreetlights(major.filter(r => r.cls >= 1));
    this.buildTraffic();
  }
  buildWater() {
    if (this.waterMesh) { this.scene.remove(this.waterMesh); this.waterMesh.geometry.dispose(); }
    const g = this.ribbon(this.w.water, { width: () => 7, color: () => '#2f5f7a', lift: 0.2 });
    this.waterMesh = new THREE.Mesh(g, this.waterMat);
    this.waterMesh.receiveShadow = true;
    this.scene.add(this.waterMesh);
  }
  // [[geometry, colourHex, mode]] -> one non-indexed geometry with vertex colours.
  // mode 'smooth' keeps smooth normals and shades the part darker toward its base;
  // a part with no colour brings its own colour and normal attributes.
  partsGeo(parts) {
    const T = THREE, pos = [], nor = [], col = [];
    for (const [g0, hex, mode] of parts) {
      let g = g0;
      if (hex != null && mode !== 'smooth') { g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals(); }
      else if (g0.index) g = g0.toNonIndexed();
      const P = g.attributes.position;
      pos.push(...P.array); nor.push(...g.attributes.normal.array);
      if (hex == null) { col.push(...g.attributes.color.array); continue; }
      const c = new T.Color(hex);
      let lo = Infinity, hi = -Infinity;
      if (mode === 'smooth') for (let i = 0; i < P.count; i++) { const y = P.getY(i); if (y < lo) lo = y; if (y > hi) hi = y; }
      for (let i = 0; i < P.count; i++) {
        const k = mode === 'smooth' ? 0.55 + 0.6 * (P.getY(i) - lo) / (hi - lo || 1) : 1;
        col.push(c.r * k, c.g * k, c.b * k);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    return g;
  }
  // A lumpy, smooth-shaded ball of foliage: darker underneath and inside, lighter on top.
  blob(x, y, z, r, hex, seed) {
    const T = THREE, g = new T.IcosahedronGeometry(r, 1), P = g.attributes.position, c = new T.Color(hex);
    const nor = new Float32Array(P.count * 3), col = new Float32Array(P.count * 3), v = new T.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      const h = Renderer3D.hash((Math.round(v.x * 40) * 73856093) ^ (Math.round(v.y * 40) * 19349663) ^ (Math.round(v.z * 40) * 83492791) ^ (seed * 7919));
      const n = v.clone().normalize();
      v.multiplyScalar(0.82 + h * 0.36); v.y *= 0.86;
      P.setXYZ(i, v.x + x, v.y + y, v.z + z);
      n.y += 0.3; n.normalize();
      nor[3 * i] = n.x; nor[3 * i + 1] = n.y; nor[3 * i + 2] = n.z;
      const k = (0.5 + 0.62 * (n.y * 0.5 + 0.5)) * (0.9 + 0.2 * h);
      col[3 * i] = c.r * k; col[3 * i + 1] = c.g * k; col[3 * i + 2] = c.b * k;
    }
    g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return g;
  }
  buildStreetlights(roads) {
    const T = THREE, w = this.w;
    for (const m of this.lightMeshes || []) { this.scene.remove(m); }
    const spots = [];
    for (const r of roads) {
      const p = r.pts, half = SG.ROAD_STYLE[r.cls][0] / 2 + 1.3;
      let acc = 20, side = 1;
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], ay = p[i - 1], dx = p[i] - ax, dy = p[i + 1] - ay, L = Math.hypot(dx, dy);
        if (!L) continue;
        while (acc < L) {
          const x = ax + dx * acc / L, y = ay + dy * acc / L, nx = -dy / L * side, ny = dx / L * side;
          spots.push([x + nx * half, y + ny * half, -nx, -ny]);
          side = -side; acc += 46;
        }
        acc -= L;
      }
    }
    const pole = (() => {
      const a = new T.CylinderGeometry(0.1, 0.15, 7.2, 5); a.translate(0, 3.6, 0);
      const b = new T.BoxGeometry(1.9, 0.12, 0.12); b.translate(0.95, 7.15, 0);
      const c = new T.BoxGeometry(0.7, 0.16, 0.34); c.translate(1.75, 7.05, 0);
      return this.partsGeo([[a, '#ffffff'], [b, '#ffffff'], [c, '#ffffff']]);
    })();
    const n = spots.length;
    const poles = new T.InstancedMesh(pole, this.poleMat, n);
    const lamps = new T.InstancedMesh(new T.IcosahedronGeometry(0.3, 0), this.lampMat, n);
    const glowGeo = new T.PlaneGeometry(1, 1); glowGeo.rotateX(-Math.PI / 2);
    const glows = new T.InstancedMesh(glowGeo, this.glowMat, n);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), up = new T.Vector3(0, 1, 0), one = new T.Vector3(1, 1, 1), sc = new T.Vector3();
    spots.forEach(([x, y, tx, ty], i) => {
      const h = w.heightAt(x, y);
      q.setFromAxisAngle(up, Math.atan2(-ty, tx));
      m4.compose(v.set(x, h, y), q, one); poles.setMatrixAt(i, m4);
      const lx = x + tx * 1.75, ly = y + ty * 1.75;
      m4.compose(v.set(lx, h + 6.9, ly), q, one); lamps.setMatrixAt(i, m4);
      m4.compose(v.set(lx, w.heightAt(lx, ly) + 0.55, ly), q.identity(), sc.set(26, 1, 26)); glows.setMatrixAt(i, m4);
    });
    this.lightMeshes = [poles, lamps, glows];
    for (const m of this.lightMeshes) { m.frustumCulled = false; this.scene.add(m); }
    glows.renderOrder = 3;
  }

  // ---------- traffic ----------
  buildTraffic() {
    const T = THREE, w = this.w;
    for (const m of [this.carMesh, this.carLights]) if (m) this.scene.remove(m);
    const rnd = (() => { let s = 4711; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    const spacing = [55, 120, 210, 900], speed = [29, 15, 12, 8];
    const lanes = [[2, 5.6, 9.2], [1.9, 5.3], [2.2], [2.1]];
    const cars = [];
    for (const r of w.roads) {
      if (r.removed || r.cls > 3 || r.len < 60) continue;
      if (!r._cum) {
        const p = r.pts, cum = new Float32Array(p.length / 2);
        for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
        r._cum = cum;
      }
      for (const dir of [1, -1]) {
        let n = r.len / spacing[r.cls];
        n = Math.floor(n) + (rnd() < n % 1 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const ln = lanes[r.cls];
          cars.push({ road: r, s: rnd() * r.len, dir, v: speed[r.cls] * (0.82 + rnd() * 0.36), lane: ln[Math.floor(rnd() * ln.length)], i: 1 });
        }
      }
    }
    if (cars.length > 1800) cars.length = 1800;
    this.cars = cars;
    const body = new T.BoxGeometry(4.4, 0.62, 1.82); body.translate(0, 0.66, 0);
    const cabin = new T.BoxGeometry(2.3, 0.56, 1.6); cabin.translate(-0.25, 1.25, 0);
    const carParts = [[body, '#ffffff'], [cabin, '#20252c']];
    for (const x of [-1.4, 1.4]) for (const z of [-0.86, 0.86]) { const wh = new T.BoxGeometry(0.66, 0.66, 0.24); wh.translate(x, 0.33, z); carParts.push([wh, '#0c0c0d']); }
    const carGeo = this.partsGeo(carParts);
    const lightParts = [];
    for (const z of [-0.6, 0.6]) {
      const f = new T.BoxGeometry(0.12, 0.2, 0.36); f.translate(2.17, 0.72, z); lightParts.push([f, '#fff4d0']);
      const b = new T.BoxGeometry(0.12, 0.18, 0.36); b.translate(-2.17, 0.78, z); lightParts.push([b, '#ff2414']);
    }
    this.carMesh = new T.InstancedMesh(carGeo, this.carMat, Math.max(1, cars.length));
    this.carLights = new T.InstancedMesh(this.partsGeo(lightParts), this.carLightMat, Math.max(1, cars.length));
    this.carLights.instanceMatrix = this.carMesh.instanceMatrix;
    const palette = ['#f2f2f0', '#d9dbde', '#2a2c30', '#8a8f96', '#2f4f86', '#9c2b2b', '#f2f2f0', '#3e4a3a', '#c9c2b0'];
    const c = new T.Color();
    cars.forEach((car, i) => { this.carMesh.setColorAt(i, c.set(palette[Math.floor(rnd() * palette.length)])); });
    for (const m of [this.carMesh, this.carLights]) { m.frustumCulled = false; this.scene.add(m); }
    this.carMesh.castShadow = false;
    this.moveCars(0);
  }
  moveCars(dt) {
    const T = THREE, w = this.w, cars = this.cars;
    if (!cars || !cars.length) return;
    const m4 = this._m4 || (this._m4 = new T.Matrix4()), q = this._q || (this._q = new T.Quaternion());
    const v = this._cv || (this._cv = new T.Vector3()), up = this._up || (this._up = new T.Vector3(0, 1, 0));
    const sc = this._sc || (this._sc = new T.Vector3(1.2, 1.2, 1.2));
    for (let n = 0; n < cars.length; n++) {
      const c = cars[n], r = c.road, cum = r._cum, p = r.pts;
      c.s += c.v * dt;
      if (c.s >= r.len) { c.s -= r.len; c.i = c.dir > 0 ? 1 : cum.length - 1; }
      const u = c.dir > 0 ? c.s : r.len - c.s;
      let i = c.i;
      while (i < cum.length - 1 && cum[i] < u) i++;
      while (i > 1 && cum[i - 1] > u) i--;
      c.i = i;
      const seg = cum[i] - cum[i - 1] || 1, t = (u - cum[i - 1]) / seg;
      let dx = (p[2 * i] - p[2 * i - 2]) / seg * c.dir, dy = (p[2 * i + 1] - p[2 * i - 1]) / seg * c.dir;
      const x = p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * t - dy * c.lane, y = p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * t + dx * c.lane;
      q.setFromAxisAngle(up, Math.atan2(-dy, dx));
      m4.compose(v.set(x, w.heightAt(x, y) + 0.3, y), q, r.removed ? v.clone().set(0, 0, 0) : sc);
      this.carMesh.setMatrixAt(n, m4);
    }
    this.carMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- buildings ----------
  chunkKey(b) { return Math.floor(b.cx / 400) + ',' + Math.floor(b.cy / 400); }
  syncBuildings() {
    const sigs = new Map();
    for (const b of this.w.buildings) {
      const key = this.chunkKey(b);
      let s = sigs.get(key) || 0;
      s = (s * 31 + (b.removed ? 7 : b.id + 1) + (b.construction ? b.months * 977 : 0)) % 2147483647;
      sigs.set(key, s);
    }
    for (const [key, sig] of sigs) {
      const c = this.chunks.get(key);
      if (!c || c.sig !== sig) this.buildChunk(key, sig);
    }
  }
  // Everything the shell, the details and the windows need to agree on for one building.
  frame(b) {
    const w = this.w, T = THREE;
    let p = Array.from(b.pts);
    if (p.length > 4 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) p = p.slice(0, -2);
    const n = p.length / 2;
    if (n < 3) return null;
    let area = 0; // wind the ring so wall normals point outward
    for (let i = 0, j = n - 1; i < n; j = i++) area += p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1];
    if (area > 0) { const q = []; for (let i = n - 1; i >= 0; i--) q.push(p[2 * i], p[2 * i + 1]); p = q; }
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < n; i++) { const h = w.heightAt(p[2 * i], p[2 * i + 1]); if (h < minH) minH = h; if (h > maxH) maxH = h; }
    const kind = b.kind, K = SG.KIND[kind] || SG.KIND.other;
    const resi = kind === 'house' || kind === 'adu' || kind === 'duplex' || kind === 'townhomes' || kind === 'accessory';
    const shops = kind === 'commercial' || kind === 'mixeduse';
    const hsh = Renderer3D.hash(b.id + 1), hsh2 = Renderer3D.hash(b.id * 7 + 3), hsh3 = Renderer3D.hash(b.id * 13 + 5);
    const P = Renderer3D.PAL;
    const wallC = new T.Color(resi ? P.walls[Math.floor(hsh * P.walls.length)] : shops ? P.shopWalls[Math.floor(hsh * P.shopWalls.length)] : K.color);
    const roofC = new T.Color(resi ? P.roofs[Math.floor(hsh2 * P.roofs.length)] : shops ? '#7b7772' : K.roof);
    const levels = Math.max(1, b.levels || 1), levelH = kind === 'accessory' ? 2.8 : 3.3;
    let wallH = levels * levelH + (shops ? 1 : 0);
    const cons = !!b.construction;
    if (cons) {
      wallH = Math.max(0.6, wallH * (1 - b.months / Math.max(1, b.totalMonths || 18)));
      wallC.set('#e3c27a'); roofC.set('#c9a25a');
    }
    const floorY = Math.min(maxH, minH + 6); // sits on the uphill side; the downhill side gets a tall foundation
    const f = { p, n, kind, resi, shops, cons, levels, levelH, wallH, floorY, bot: minH - 1.5, top: floorY + wallH, hsh, hsh2, hsh3,
      wall: [wallC.r, wallC.g, wallC.b], roof: [roofC.r, roofC.g, roofC.b] };
    if (resi && !cons && n === 4) f.rf = this.roofFrame(f, b);
    return f;
  }
  roofFrame(f, b) {
    const p = f.p, Q = i => [p[2 * i], p[2 * i + 1]];
    let [q0, q1, q2, q3] = [Q(0), Q(1), Q(2), Q(3)];
    let L = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]), S = Math.hypot(q2[0] - q1[0], q2[1] - q1[1]);
    if (S > L) { [q0, q1, q2, q3] = [q1, q2, q3, q0]; [L, S] = [S, L]; }
    if (S < 1.5) return null;
    const a = [(q1[0] - q0[0]) / L, (q1[1] - q0[1]) / L], pv = [(q2[0] - q1[0]) / S, (q2[1] - q1[1]) / S];
    const hip = f.kind !== 'accessory' && f.hsh3 < 0.38 && L - S > 2.5;
    const o = f.kind === 'accessory' ? 0.3 : 0.55;
    const rh = Math.min(4.5, S * 0.32), slope = rh / (S / 2);
    const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
    const add = (q, ka, kp) => [q[0] + a[0] * ka + pv[0] * kp, q[1] + a[1] * ka + pv[1] * kp];
    const inset = hip ? Math.min(S * 0.5, (L - 1) / 2) : -o;
    return { q0, q1, q2, q3, a, pv, L, S, hip, rh, ridgeH: f.top + rh, eaveH: f.top - slope * o,
      e0: add(q0, -o, -o), e1: add(q1, o, -o), e2: add(q2, o, o), e3: add(q3, -o, o),
      r0: add(mid(q3, q0), inset, 0), r1: add(mid(q1, q2), -inset, 0), g0: mid(q3, q0), g1: mid(q1, q2) };
  }
  // push one triangle, flipped if needed so its normal agrees with `ref`
  tri(out, a, b, c, col, ref, sa = 1, sb = 1, sc = 1) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * ref[0] + ny * ref[1] + nz * ref[2] < 0) { const t = b; b = c; c = t; const ts = sb; sb = sc; sc = ts; }
    out.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const cl = out.col;
    if (col.length === 4) cl.push(col[0], col[1], col[2], col[3], col[0], col[1], col[2], col[3], col[0], col[1], col[2], col[3]);
    else cl.push(col[0] * sa, col[1] * sa, col[2] * sa, col[0] * sb, col[1] * sb, col[2] * sb, col[0] * sc, col[1] * sc, col[2] * sc);
    if (out.ids) out.ids.push(out.id);
  }
  quad(out, a, b, c, d, col, ref) { this.tri(out, a, b, c, col, ref); this.tri(out, a, c, d, col, ref); }
  box(out, x, y, z, sx, sy, sz, yaw, col) { // box sitting on (x, y, z)
    const cs = Math.cos(yaw), sn = Math.sin(yaw), V = (u, h, v) => [x + u * cs - v * sn, y + h, z + u * sn + v * cs];
    const hx = sx / 2, hz = sz / 2;
    const c = [V(-hx, 0, -hz), V(hx, 0, -hz), V(hx, 0, hz), V(-hx, 0, hz), V(-hx, sy, -hz), V(hx, sy, -hz), V(hx, sy, hz), V(-hx, sy, hz)];
    const mid = [x, y + sy / 2, z];
    for (const [i, j, k, l] of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]) {
      const ref = [(c[i][0] + c[k][0]) / 2 - mid[0], (c[i][1] + c[k][1]) / 2 - mid[1], (c[i][2] + c[k][2]) / 2 - mid[2]];
      this.quad(out, c[i], c[j], c[k], c[l], col, ref);
    }
  }
  shell(b, f, out) {
    const { p, n, bot, top, wall, roof } = f;
    out.id = b.id;
    for (let i = 0; i < n; i++) { // walls, darker toward the ground
      const j = (i + 1) % n;
      const ax = p[2 * i], az = p[2 * i + 1], bx = p[2 * j], bz = p[2 * j + 1];
      const o = [-(bz - az), 0, bx - ax];
      this.tri(out, [ax, bot, az], [bx, bot, bz], [bx, top, bz], wall, o, 0.7, 0.7, 1);
      this.tri(out, [ax, bot, az], [bx, top, bz], [ax, top, az], wall, o, 0.7, 1, 1);
    }
    const up = [0, 1, 0], rf = f.rf;
    if (rf) {
      const V = (q, h) => [q[0], h, q[1]];
      const { e0, e1, e2, e3, r0, r1, eaveH: eh, ridgeH: rh } = rf;
      this.quad(out, V(e0, eh), V(e1, eh), V(r1, rh), V(r0, rh), roof, up);
      this.quad(out, V(e2, eh), V(e3, eh), V(r0, rh), V(r1, rh), roof, up);
      if (rf.hip) {
        this.tri(out, V(e1, eh), V(e2, eh), V(r1, rh), roof, up);
        this.tri(out, V(e3, eh), V(e0, eh), V(r0, rh), roof, up);
      } else { // gable ends in the wall colour
        const o1 = [rf.a[0], 0, rf.a[1]], o0 = [-rf.a[0], 0, -rf.a[1]];
        this.tri(out, V(rf.q1, top), V(rf.q2, top), V(rf.g1, rh), wall, o1);
        this.tri(out, V(rf.q3, top), V(rf.q0, top), V(rf.g0, rh), wall, o0);
      }
      return;
    }
    const contour = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[2 * i], p[2 * i + 1]));
    let faces;
    try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { faces = []; }
    for (const [a, b2, c] of faces)
      this.tri(out, [p[2 * a], top, p[2 * a + 1]], [p[2 * b2], top, p[2 * b2 + 1]], [p[2 * c], top, p[2 * c + 1]], roof, up);
  }
  // Windows, doors, awnings, chimneys, solar panels, parapets, rooftop units and cranes.
  details(b, f, D, Wn) {
    const { p, n, floorY, top, levels, levelH, kind, hsh, hsh2, hsh3 } = f, C = Renderer3D.colors(), w = this.w;
    const up = [0, 1, 0];
    if (f.cons) {
      if (levels >= 3) { // tower crane
        const full = levels * levelH, yaw = hsh * 6.28, y = f.floorY;
        this.box(D, b.cx, y, b.cy, 1.3, full + 14, 1.3, yaw, C.crane);
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        this.box(D, b.cx + cs * 8, y + full + 13, b.cy + sn * 8, 30, 0.8, 0.8, yaw, C.crane);
        this.box(D, b.cx - cs * 6, y + full + 11.6, b.cy - sn * 6, 3, 1.4, 1.6, yaw, C.craneCab);
      }
      return;
    }
    let longest = 0, bestL = 0;
    const lens = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; const L = Math.hypot(p[2 * j] - p[2 * i], p[2 * j + 1] - p[2 * i + 1]); lens.push(L); if (L > bestL) { bestL = L; longest = i; } }
    // the wall that faces the street gets the awning
    let front = -1;
    if (f.shops) {
      let bd = 1e9;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n; if (lens[i] < 5) continue;
        const nr = w.nearestRoad((p[2 * i] + p[2 * j]) / 2, (p[2 * i + 1] + p[2 * j + 1]) / 2, 60);
        if (nr && nr.dist < bd) { bd = nr.dist; front = i; }
      }
    }
    const dark = hsh2 > 0.72; // nobody home tonight
    const litCol = C.lit[Math.floor(hsh3 * C.lit.length)];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, L = lens[i];
      if (L < 2.6) continue;
      const ax = p[2 * i], az = p[2 * i + 1], dx = (p[2 * j] - ax) / L, dz = (p[2 * j + 1] - az) / L, ox = -dz, oz = dx, ref = [ox, 0, oz];
      const at = (t, y, off) => [ax + dx * t + ox * off, y, az + dz * t + oz * off];
      const rect = (out, t, hw, y0, y1, off, col) => this.quad(out, at(t - hw, y0, off), at(t + hw, y0, off), at(t + hw, y1, off), at(t - hw, y1, off), col, ref);
      if (kind === 'accessory') { if (i === longest && L > 3.4) rect(D, L / 2, Math.min(1.5, L / 2 - 0.4), floorY, floorY + 2.1, 0.06, C.garage); continue; }
      const slotW = f.resi ? 3.1 : 2.9, slots = Math.max(1, Math.floor((L - 1.2) / slotW));
      for (let lv = 0; lv < levels; lv++) {
        const y = floorY + lv * levelH;
        if (f.shops && lv === 0) {
          if (L >= 4.5) rect(Wn, L / 2, L / 2 - 0.7, y + 0.45, y + 2.8, 0.06, [C.store[0], C.store[1], C.store[2], 0.05 + Renderer3D.hash(b.id * 3 + i) * 0.5]);
          if (i === front) {
            const ac = C.awn[Math.floor(hsh * C.awn.length)];
            this.quad(D, at(0.5, y + 3.0, 0.02), at(L - 0.5, y + 3.0, 0.02), at(L - 0.5, y + 2.5, 1.4), at(0.5, y + 2.5, 1.4), ac, up);
          }
          continue;
        }
        for (let k = 0; k < slots; k++) {
          const t = (k + 0.5) / slots * L;
          if (lv === 0 && i === longest) {
            if (k === Math.floor(slots / 2)) { rect(D, t, 0.5, y, y + 2.1, 0.06, C.doors[Math.floor(hsh2 * C.doors.length)]); continue; }
            if (kind === 'house' && k === 0 && slots >= 3) { rect(D, t, 1.25, y, y + 2.15, 0.06, C.garage); continue; }
          }
          const r = Renderer3D.hash(b.id * 131 + i * 17 + lv * 5 + k);
          const hw = f.resi ? 0.65 : 0.75, a = dark ? 0.95 + r * 0.05 : 0.04 + r * 0.92;
          rect(Wn, t, hw, y + 0.95, y + 2.25, 0.06, [litCol[0], litCol[1], litCol[2], a]);
        }
      }
    }
    const rf = f.rf;
    if (rf) {
      const { a, pv, L, S, q0 } = rf;
      const at = (u, v) => [q0[0] + a[0] * u + pv[0] * v, q0[1] + a[1] * u + pv[1] * v];
      if (kind !== 'accessory' && hsh2 < 0.55) { // chimney
        const c = at(L * (0.25 + hsh * 0.5), S * 0.3);
        this.box(D, c[0], top - 0.2, c[1], 0.8, rf.rh * 0.6 + 1.5, 0.8, Math.atan2(a[1], a[0]), C.chimney);
      }
      if (kind === 'house' && !rf.hip && hsh3 > 0.8 && L > 8) { // solar panels on one slope
        const sl = (u, v) => { const e = at(u * L, 0), r = at(u * L, S / 2); return [e[0] + (r[0] - e[0]) * v, top + rf.rh * v + 0.14, e[1] + (r[1] - e[1]) * v]; };
        this.quad(D, sl(0.22, 0.2), sl(0.78, 0.2), sl(0.78, 0.8), sl(0.22, 0.8), C.solar, up);
      }
      return;
    }
    if (f.resi) return;
    const pw = [f.wall[0] * 0.92, f.wall[1] * 0.92, f.wall[2] * 0.92];
    for (let i = 0; i < n; i++) { // parapet
      const j = (i + 1) % n;
      const A = [p[2 * i], top, p[2 * i + 1]], B = [p[2 * j], top, p[2 * j + 1]];
      this.quad(D, A, B, [B[0], top + 0.7, B[2]], [A[0], top + 0.7, A[2]], pw, [-(B[2] - A[2]), 0, B[0] - A[0]]);
    }
    if (b.area > 150) { // rooftop units
      const k = 1 + Math.floor(hsh * 2.99), s = Math.sqrt(b.area) * 0.22;
      for (let m = 0; m < k; m++) {
        const x = b.cx + (Renderer3D.hash(b.id * 5 + m) - 0.5) * 2 * s, z = b.cy + (Renderer3D.hash(b.id * 11 + m) - 0.5) * 2 * s;
        if (SG.World.pointInPoly(x, z, b.pts)) this.box(D, x, top, z, 2.2, 1.2, 1.6, hsh * 3, C.hvac);
      }
    }
  }
  buildChunk(key, sig) {
    const T = THREE;
    const old = this.chunks.get(key);
    if (old) this.dropChunk(old);
    const list = this.w.buildings.filter(b => !b.removed && this.chunkKey(b) === key);
    const out = { pos: [], col: [], ids: [], id: 0 };
    let cx = 0, cy = 0;
    for (const b of list) { const f = this.frame(b); if (f) this.shell(b, f, out); cx += b.cx; cy += b.cy; }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(out.pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(out.col, 3));
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, this.bldMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const chunk = { key, sig, mesh, triIds: Int32Array.from(out.ids), list, cx: cx / Math.max(1, list.length), cy: cy / Math.max(1, list.length), detail: null, win: null };
    mesh.userData.chunk = chunk;
    this.scene.add(mesh);
    this.chunks.set(key, chunk);
  }
  buildDetail(c) { // built lazily, only for chunks near the camera
    const T = THREE;
    const D = { pos: [], col: [] }, Wn = { pos: [], col: [] };
    for (const b of c.list) { const f = this.frame(b); if (f) this.details(b, f, D, Wn); }
    const mk = (o, size, mat) => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(o.pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(o.col, size));
      g.computeVertexNormals();
      const m = new T.Mesh(g, mat); this.scene.add(m); return m;
    };
    c.detail = mk(D, 3, this.detailMat); c.detail.receiveShadow = true;
    c.win = mk(Wn, 4, this.winMat);
  }
  buildCityLights() { // one point per lit building, for the far view at night
    const w = this.w, pos = [];
    for (const b of w.buildings) if (!b.removed && b.kind !== 'accessory' && Renderer3D.hash(b.id * 7 + 3) <= 0.72)
      pos.push(b.cx, w.heightAt(b.cx, b.cy) + 3, b.cy);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.cityLights = new THREE.Points(g, this.cityLightMat);
    this.cityLights.frustumCulled = false;
    this.scene.add(this.cityLights);
  }

  // ---------- trees ----------
  buildTrees() {
    const T = THREE, w = this.w;
    const rnd = (() => { let s = 20250101; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    const spots = []; // [x, y, scale, type (0 broadleaf, 1 pine, 2 redwood), flag (1 deciduous, 2 orchard), r]
    const free = (x, y, clear) => {
      for (const b of w.buildingsIn([x - clear, y - clear, x + clear, y + clear])) {
        if (SG.World.pointInPoly(x, y, b.pts)) return false;
        if (Math.hypot(b.cx - x, b.cy - y) < clear + Math.sqrt(b.area) / 2) return false;
      }
      return w.cellOf(x, y) >= 0 && !w.nearestRoad(x, y, 9, false);
    };
    for (const b of w.buildings) { // yard trees
      if (b.removed || (b.kind !== 'house' && b.kind !== 'duplex')) continue;
      const nTrees = 1 + Math.floor(rnd() * 3.2);
      for (let k = 0; k < nTrees; k++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(b.area) * 0.7 + 4 + rnd() * 14;
        const x = b.cx + Math.cos(a) * d, y = b.cy + Math.sin(a) * d;
        if (free(x, y, 3)) { const t = rnd(); spots.push([x, y, 0.7 + rnd() * 0.8, t < 0.14 ? 1 : t < 0.2 ? 2 : 0, rnd() < 0.3 ? 1 : 0, rnd()]); }
      }
    }
    for (const a of w.areas) { // woods, parks, orchards
      const spacing = { forest: 13, park: 28, golf: 45, orchard: 9, sports: 60, cemetery: 30, campus: 40 }[a.kind];
      if (!spacing) continue;
      const bb = SG.World.bbox(a.pts);
      const cols = Math.ceil((bb[2] - bb[0]) / spacing);
      const cnt = Math.min(20000, ((bb[2] - bb[0]) * (bb[3] - bb[1])) / (spacing * spacing));
      for (let k = 0; k < cnt; k++) {
        let x, y;
        if (a.kind === 'orchard') { x = bb[0] + (k % cols) * spacing; y = bb[1] + Math.floor(k / cols) * spacing; }
        else { x = bb[0] + rnd() * (bb[2] - bb[0]); y = bb[1] + rnd() * (bb[3] - bb[1]); }
        if (!SG.World.pointInPoly(x, y, a.pts)) continue;
        if (a.kind !== 'forest' && a.kind !== 'orchard' && !free(x, y, 3)) continue;
        if (a.kind === 'forest' && w.roadDist[w.cellOf(x, y)] === 0) continue;
        const t = rnd();
        if (a.kind === 'orchard') spots.push([x, y, 0.5, 0, 2, rnd()]);
        else spots.push([x, y, 0.8 + rnd() * 0.9, a.kind === 'forest' ? (t < 0.35 ? 2 : t < 0.55 ? 1 : 0) : (t < 0.12 ? 1 : 0), a.kind !== 'forest' && rnd() < 0.35 ? 1 : 0, rnd()]);
      }
    }
    for (let i = 0; i < w.zone.length; i++) { // oak and redwood woodland on unbuilt hillside land
      const z = w.zone[i];
      if ((z !== SG.Z.HR && z !== SG.Z.OS && z !== SG.Z.R_1_40_000) || w.claim[i] !== -1 || w.roadDist[i] === 0 || w.areaK[i]) continue;
      if (rnd() > (z === SG.Z.R_1_40_000 ? 0.25 : 0.55)) continue;
      const [cx, cy] = w.cellCenter(i), t = rnd();
      spots.push([cx + (rnd() - 0.5) * SG.CELL, cy + (rnd() - 0.5) * SG.CELL, 0.9 + rnd() * 0.9, t < 0.14 ? 2 : t < 0.38 ? 1 : 0, 0, rnd()]);
    }
    this.treeSpots = spots;

    const tr = (g, x, y, z) => { g.translate(x, y, z); return g; };
    const trunk = (r0, r1, h, hex) => [tr(new T.CylinderGeometry(r0, r1, h, 6, 1, true), 0, h / 2, 0), hex, 'smooth'];
    const cone = (r, h, y, hex, seg) => [tr(new T.ConeGeometry(r, h, seg, 1, true), 0, y, 0), hex, 'smooth'];
    // far away: a few dozen triangles per tree; near the camera: fuller, lumpier crowns
    const lo = [
      this.partsGeo([trunk(0.3, 0.45, 3.2, '#5d4632'), [tr(new T.IcosahedronGeometry(2.8, 0), 0, 5.2, 0), '#5e8c47', 'smooth']]),
      this.partsGeo([trunk(0.28, 0.42, 3, '#5a4330'), cone(2.9, 5, 5, '#3f6b3d', 6), cone(2.1, 4.2, 7.8, '#487544', 6)]),
      this.partsGeo([trunk(0.45, 0.75, 8, '#70462f'), cone(3.0, 7, 9.5, '#2f5a35', 6), cone(2.2, 7, 14.5, '#356339', 6)]),
    ];
    const hi = [
      this.partsGeo([trunk(0.28, 0.5, 3.4, '#5d4632'), [this.blob(0, 5.4, 0, 2.9, '#5c8a45', 1)], [this.blob(1.8, 4.5, 0.9, 2.2, '#679350', 2)],
        [this.blob(-1.5, 4.7, -1.1, 2.0, '#547e40', 3)], [this.blob(0.3, 4.3, -1.7, 1.7, '#5a8743', 4)]]),
      this.partsGeo([trunk(0.28, 0.42, 3, '#5a4330'), cone(3.0, 4.2, 4.3, '#3b6639', 10), cone(2.4, 3.8, 6.4, '#42703f', 10), cone(1.7, 3.4, 8.4, '#4a7a46', 10)]),
      this.partsGeo([trunk(0.45, 0.8, 8, '#70462f'), cone(3.1, 6, 8.5, '#2c5632', 10), cone(2.6, 5.5, 11.8, '#305c36', 10), cone(2.0, 5, 15, '#35643a', 10), cone(1.3, 4.5, 18, '#3b6c40', 10)]),
    ];
    const tiles = new Map(); // 800 m tiles, culled by hand (an InstancedMesh culls as a whole)
    for (const s of spots) {
      const key = Math.floor(s[0] / 800) + ',' + Math.floor(s[1] / 800);
      let t = tiles.get(key); if (!t) tiles.set(key, t = [[], [], []]); t[s[3]].push(s);
    }
    this.treeTiles = [];
    const m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3();
    for (const [key, groups] of tiles) {
      const [kx, ky] = key.split(',').map(Number);
      const box = new T.Box3(new T.Vector3(kx * 800, -100, ky * 800), new T.Vector3(kx * 800 + 800, 1200, ky * 800 + 800));
      const meshes = [], his = [];
      groups.forEach((list, type) => {
        if (!list.length) return;
        const im = new T.InstancedMesh(lo[type], this.treeMat, list.length);
        list.forEach((s, i) => {
          q.setFromAxisAngle(v.set(0, 1, 0), s[5] * 6.28);
          sc.set(s[2], s[2] * (0.85 + s[5] * 0.4), s[2]);
          m4.compose(v.set(s[0], w.heightAt(s[0], s[1]) - 0.3, s[1]), q, sc);
          im.setMatrixAt(i, m4);
        });
        im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(list.length * 3).fill(1), 3);
        const hm = new T.InstancedMesh(hi[type], this.treeMat, list.length); // shares the instance data
        hm.instanceMatrix = im.instanceMatrix; hm.instanceColor = im.instanceColor;
        im.userData.spots = list;
        for (const m of [im, hm]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.scene.add(m); }
        hm.visible = false;
        meshes.push(im); his.push(hm);
      });
      this.treeTiles.push({ box, meshes, hi: his });
    }
  }
  // 0 winter, 1 spring, 2 summer, 3 fall
  static seasonOf(month) { return month <= 1 || month === 11 ? 0 : month <= 4 ? 1 : month <= 8 ? 2 : 3; }
  applySeason(season) {
    this.season = season;
    const T = THREE, c = new T.Color(), base = new T.Color('#5e8c47');
    const mul = hex => { const t = new T.Color(hex); return [t.r / base.r, t.g / base.g, t.b / base.b]; };
    const M = Renderer3D._M || (Renderer3D._M = { pink: mul('#f2bccb'), white: mul('#f1e8d6'), bare: mul('#5f5348'),
      orange: mul('#c8742a'), yellow: mul('#d2a63a'), red: mul('#a8442e'), rust: mul('#a9772f') });
    for (const t of this.treeTiles) for (const im of t.meshes) {
      im.userData.spots.forEach((s, i) => {
        const r = s[5], v = 0.75 + r * 0.5;
        let m = null;
        if (s[4] === 2) m = season === 1 ? (r < 0.6 ? M.pink : M.white) : season === 0 ? M.bare : season === 3 ? M.rust : null; // orchard
        else if (s[4] === 1) m = season === 3 ? (r < 0.4 ? M.orange : r < 0.75 ? M.yellow : M.red) : season === 0 ? M.bare : season === 1 && r < 0.3 ? M.pink : null;
        if (m) c.setRGB(m[0], m[1], m[2]); else c.setRGB(v, v * (0.92 + ((r * 7) % 1) * 0.16), v * 0.9);
        im.setColorAt(i, c);
      });
      im.instanceColor.needsUpdate = true;
    }
    // hills: green after the winter rains, golden by late summer
    const tint = [[0.86, 1.0, 0.8], [0.9, 1.0, 0.8], [1.0, 0.94, 0.72], [1.0, 0.88, 0.68]][season];
    this.terrain.material.color.setRGB(...tint);
    this.skirt.material.color.setRGB(...tint);
  }
  pruneTrees() { // hide trees that a new building now sits on
    const w = this.w, m4 = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const t of this.treeTiles) for (const im of t.meshes) {
      let changed = false;
      im.userData.spots.forEach((s, i) => {
        if (s.gone) return;
        for (const b of w.buildingsIn([s[0] - 4, s[1] - 4, s[0] + 4, s[1] + 4])) {
          if (b.player && (SG.World.pointInPoly(s[0], s[1], b.pts) || Math.hypot(b.cx - s[0], b.cy - s[1]) < Math.sqrt(b.area) / 2 + 3)) {
            s.gone = true; im.setMatrixAt(i, m4); changed = true; break;
          }
        }
      });
      if (changed) im.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- frame ----------
  sync() {
    const w = this.w, seen = this.seen;
    if (seen.v !== w.version) { this.syncBuildings(); this.pruneTrees(); this._miniDirty = true; }
    if (seen.r !== w.roadVersion) this.buildRoads();
    if (seen.r !== w.roadVersion || seen.a !== w.areaVersion) this.paintGround();
    this.seen = { v: w.version, r: w.roadVersion, a: w.areaVersion };
    const season = Renderer3D.seasonOf(this.sim.month);
    if (season !== this.season) this.applySeason(season);
  }
  lod() {
    const T = THREE;
    const frustum = this._fr || (this._fr = new T.Frustum());
    frustum.setFromProjectionMatrix((this._pm || (this._pm = new T.Matrix4())).multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const far2 = (this.dist * 4 + 1500) ** 2;
    for (const t of this.treeTiles) {
      const cx = (t.box.min.x + t.box.max.x) / 2, cz = (t.box.min.z + t.box.max.z) / 2;
      const d2 = (cx - this.tx) ** 2 + (cz - this.ty) ** 2;
      const vis = frustum.intersectsBox(t.box) && d2 < far2;
      const near = vis && this.q < 2 && this.dist < 2200 && d2 < 1300 * 1300;
      for (const m of t.meshes) m.visible = vis && !near;
      for (const m of t.hi) m.visible = near;
    }
    // windows, doors and roof details only near the camera; built a few chunks per frame
    const R = this.q >= 3 || this.dist > 2600 ? 0 : Math.max(650, Math.min(2300, this.dist * 1.7));
    let budget = 3;
    for (const c of this.chunks.values()) {
      const near = R > 0 && Math.hypot(c.cx - this.tx, c.cy - this.ty) < R;
      if (near && !c.detail) { if (budget-- > 0) this.buildDetail(c); else this.dirty = true; }
      if (c.detail) { c.detail.visible = near; c.win.visible = near; }
    }
    const night = this.todCur.night, close = this.dist < 2600;
    this.markMesh.visible = this.dist < 2200;
    this.walkMesh.visible = this.dist < 6000;
    const [poles, lamps, glows] = this.lightMeshes;
    poles.visible = close; lamps.visible = close && night > 0.2; glows.visible = night > 0.05 && this.dist < 9000;
    this.carMesh.visible = this.dist < 3800 && this.q < 3;
    this.carLights.visible = this.carMesh.visible && night > 0.2;
    this.cityLights.visible = night > 0.2;
  }
  draw(now) {
    if (now == null) now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000)); this.lastT = now;
    const anim = this.q < 3 && !this.freeze; // freeze: stop ambient animation (used by tests)
    // eased zoom and rotation
    if (Math.abs(this.pz) > 0.002) { const st = this.pz * 0.25; this.pz -= st; this.zoomAt(this.pzx, this.pzy, Math.exp(st)); } else this.pz = 0;
    if (Math.abs(this.pyaw) > 0.3 || Math.abs(this.ppitch) > 0.3) {
      const a = this.pyaw * 0.22, b = this.ppitch * 0.22; this.pyaw -= a; this.ppitch -= b; this.orbit(a, b);
    } else { this.pyaw = 0; this.ppitch = 0; }
    if (this.autoOrbit) { this.yaw += dt * 0.07; this.dirty = true; }
    if (this.todT < 1) {
      this.todT = Math.min(1, this.todT + dt / 1.6);
      const t = this.todT; this.applyTod(this.todLerp(this.todFrom, this.todTo, t * t * (3 - 2 * t)));
    }
    const cam = this.dirty;
    if (!cam && !anim) return;
    if (cam) {
      this.dirty = false;
      this.sync();
      if (this.zoneDirty) this.updateOverlay();
      this.updateCamera();
      this.lod();
      this.renderer.shadowMap.needsUpdate = true;
      this.hudDirty = true;
    }
    if (anim) {
      this.time += dt; this.uTime.value = this.time;
      if (this.carMesh.visible) this.moveCars(dt);
    }
    if (this.envDirty && (this.todT >= 1 || (this.envTick = (this.envTick || 0) + 1) % 8 === 0)) this.updateEnv();
    if (this.post) {
      const s = this.todCur, fx = this.q < 2;
      this.post.opts.ao = fx; this.post.opts.bloom = this.q < 3;
      this.post.render(this.scene, this.camera, {
        exposure: s.exposure, fogCol: s.fog, sunCol: s.sunCol, sunDir: s.sun, fogFar: this.dist * 14 + 14000,
        focus: this.camera.position.distanceTo(this.sun.target.position), maxCoC: fx ? (this.photo ? 10 : 1.5) * this.pr : 0,
        ao: 0.85, bloom: 0.85, vignette: this.photo ? 0.45 : 0.26, time: this.time,
      });
    } else this.renderer.render(this.scene, this.camera);
    if (this.hudDirty) { this.hudDirty = false; this.drawHud(); }
    // drop quality if this machine can't keep up
    if (this.gfxMode === 'auto' && anim && dt > 0) {
      this.ema = this.ema * 0.92 + dt * 0.08;
      this.slow = this.ema > 0.05 ? this.slow + 1 : Math.max(0, this.slow - 2);
      if (this.slow > 90) { this.q++; this.slow = 0; this.ema = 0.016; this.resize(); }
    }
  }

  // ---------- HUD: labels, selection, tool previews ----------
  drawHud() {
    const ctx = this.ctx, w = this.w;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    if (this.photo) return; // photo mode: nothing over the picture
    const on = (p) => p[2] < 1 && p[0] > -80 && p[1] > -40 && p[0] < this.vw + 80 && p[1] < this.vh + 40;
    const used = [];
    const free = (x, y, wd, h) => {
      for (const u of used) if (Math.abs(u[0] - x) < (u[2] + wd) / 2 && Math.abs(u[1] - y) < (u[3] + h) / 2) return false;
      used.push([x, y, wd, h]); return true;
    };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const s = this.scale, night = this.todCur.night > 0.5;
    const halo = night ? 'rgba(10,14,28,.85)' : 'rgba(255,255,255,.9)';

    const sel = this.selected;
    if (sel && sel.pts) {
      ctx.strokeStyle = '#ff3d7f'; ctx.lineWidth = 2.5;
      if (sel.cls != null) { this.hudLine(sel.pts, 1); ctx.stroke(); }
      else this.hudBox(sel.pts, (Math.max(1, sel.levels || 1) * 3.3) + (sel.kind === 'house' ? 3 : 0));
    }
    const g = this.ghost;
    if (g) {
      if (g.type === 'brush') {
        const ring = [];
        for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; ring.push(g.x + Math.cos(a) * g.r, g.y + Math.sin(a) * g.r); }
        ctx.beginPath(); this.hudPath(ring, 1, true);
        ctx.fillStyle = g.color + '66'; ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.stroke();
      } else if (g.type === 'line') {
        ctx.beginPath(); this.hudLine(g.pts, 1);
        ctx.strokeStyle = g.ok ? 'rgba(60,140,255,.85)' : 'rgba(230,60,60,.85)'; ctx.lineWidth = Math.max(3, 9 * s); ctx.lineCap = 'round'; ctx.stroke();
      } else if (g.type === 'poly') {
        ctx.strokeStyle = g.ok ? '#1f9a4e' : '#c42323';
        ctx.fillStyle = g.ok ? 'rgba(80,200,120,.35)' : 'rgba(230,70,60,.35)';
        ctx.lineWidth = 2;
        this.hudBox(g.pts, g.h || 6, true);
      }
    }

    const big = /^(Saratoga|Hakone|Villa Montalvo|Montalvo|West Valley|Saratoga High|Mountain Winery|Saratoga Village|Congress Springs|El Quito|Wildwood|Quito)/i;
    const list = w.pois.filter(p => p.kind === 'place' || p.kind === 'suburb' || p.kind === 'neighbourhood' || big.test(p.name) ||
      ['school', 'college', 'library', 'townhall', 'park', 'museum', 'attraction', 'fire_station', 'community_centre'].includes(p.kind));
    for (const a of w.areas) if (a.name && (a.kind === 'park' || a.kind === 'campus' || a.kind === 'golf')) {
      if (!a.c) a.c = SG.World.centroid(a.pts);
      if (!a.ha) a.ha = SG.World.polyArea(a.pts) / 10000;
      list.push({ name: a.name, kind: a.kind, x: a.c[0], y: a.c[1], ha: a.ha });
    }
    list.sort((a, b) => (b.ha || 0) - (a.ha || 0));
    for (const p of list) {
      const place = p.kind === 'place' || p.kind === 'suburb' || p.kind === 'neighbourhood';
      if (!place && s < 0.3 && !(p.ha > 8)) continue;
      if (!place && s < 0.12) continue;
      const q = this.toScreen(p.x, p.y, w.heightAt(p.x, p.y) + (place ? 60 : 25));
      if (!on(q)) continue;
      ctx.font = place ? `600 ${p.name === 'Saratoga' ? 20 : 14}px system-ui, sans-serif` : `600 12px system-ui, sans-serif`;
      const tw = ctx.measureText(p.name).width;
      if (!free(q[0], q[1], tw + 6, 16)) continue;
      ctx.lineWidth = 3.5; ctx.strokeStyle = halo; ctx.strokeText(p.name, q[0], q[1]);
      ctx.fillStyle = night ? (place ? '#f3c7e6' : '#dfe6f5') : place ? '#6b2b56' : p.kind === 'park' || p.kind === 'golf' ? '#2b5a20' : '#363352';
      ctx.fillText(p.name, q[0], q[1]);
    }
    if (s > 0.55) { // street names
      ctx.font = `${Math.min(13, 9 + s)}px system-ui, sans-serif`;
      const seen = new Set();
      for (const r of w.roadsIn(this.viewBB())) {
        if (!r.name || r.cls > 3 || seen.has(r.name)) continue;
        let best = 0, bi = 2; const p = r.pts;
        for (let i = 2; i < p.length; i += 2) { const L = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); if (L > best) { best = L; bi = i; } }
        const a = this.toScreen(p[bi - 2], p[bi - 1]), b = this.toScreen(p[bi], p[bi + 1]);
        if (!on(a) || !on(b)) continue;
        const tw = ctx.measureText(r.name).width;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < tw + 10) continue;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        if (!free(mx, my, tw, 14)) continue;
        seen.add(r.name);
        let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
        ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
        ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.strokeText(r.name, 0, 0);
        ctx.fillStyle = night ? '#e8edf5' : '#3e3a34'; ctx.fillText(r.name, 0, 0);
        ctx.restore();
      }
    }
    // compass
    ctx.save(); ctx.translate(this.vw - 34, 34); ctx.rotate(this.yaw);
    ctx.fillStyle = 'rgba(21,26,31,.8)'; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e5705f'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(5, 0); ctx.lineTo(-5, 0); ctx.fill();
    ctx.fillStyle = '#e8edf1'; ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(5, 0); ctx.lineTo(-5, 0); ctx.fill();
    ctx.fillStyle = '#e5705f'; ctx.font = '700 9px system-ui'; ctx.fillText('N', 0, -23);
    ctx.restore();
  }
  hudPath(flat, lift, close) {
    const ctx = this.ctx;
    let started = false;
    for (let i = 0; i < flat.length; i += 2) {
      const q = this.toScreen(flat[i], flat[i + 1], this.w.heightAt(flat[i], flat[i + 1]) + lift);
      if (q[2] > 1) continue;
      if (!started) { ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]);
    }
    if (close) ctx.closePath();
  }
  hudLine(flat, lift) { this.ctx.beginPath(); this.hudPath(flat, lift, false); }
  hudBox(flat, height, fill) {
    const ctx = this.ctx, n = flat.length / 2;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const h = this.w.heightAt(flat[2 * i], flat[2 * i + 1]); if (h < lo) lo = h; if (h > hi) hi = h; }
    const base = Math.min(hi, lo + 6);
    const P = (i, h) => this.toScreen(flat[2 * i], flat[2 * i + 1], base + h);
    const bot = [], top = [];
    for (let i = 0; i < n; i++) { bot.push(P(i, 0.3)); top.push(P(i, height)); }
    if (bot.some(q => q[2] > 1)) return;
    const poly = pts => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); };
    if (fill) {
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; poly([bot[i], bot[j], top[j], top[i]]); ctx.fill(); }
      poly(top); ctx.fill();
    }
    poly(bot); ctx.stroke(); poly(top); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < n; i++) { ctx.moveTo(bot[i][0], bot[i][1]); ctx.lineTo(top[i][0], top[i][1]); }
    ctx.stroke();
  }

  drawMinimap(mc) { SG.Renderer.prototype.drawMinimap.call(this, mc); }
  minimapToWorld(mx, my) { return SG.Renderer.prototype.minimapToWorld.call(this, mx, my); }
};

// palettes (sRGB); Renderer3D.colors() converts the detail colours to linear [r, g, b] once
SG.Renderer3D.PAL = {
  walls: ['#efe6d6', '#e8dcc4', '#f3efe6', '#ddd0b6', '#e9e3d7', '#d6cfc0', '#cfd6d2', '#e2d2bd'],
  shopWalls: ['#e6d6b8', '#d4b896', '#c48a66', '#efe4d2', '#b9a58c', '#d9c7a0'],
  roofs: ['#a85e45', '#8a8987', '#6d5b4d', '#9b5536', '#77767a', '#94694e', '#5f6466'],
  doors: ['#6b3b26', '#8c241f', '#293d61', '#33543d', '#e6e0d6', '#40332e'],
  awn: ['#9c2e2e', '#2e5c4a', '#26406b', '#c9a33b', '#7a2e4f', '#e6ded0'],
  lit: ['#ffd17a', '#ffe3a8', '#ffc763', '#e8f0ff', '#ffdb8c'],
};
SG.Renderer3D.colors = function () {
  if (SG.Renderer3D._C) return SG.Renderer3D._C;
  const L = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  const P = SG.Renderer3D.PAL;
  return (SG.Renderer3D._C = { crane: L('#e0b021'), craneCab: L('#737373'), garage: L('#dddbd1'), chimney: L('#80543f'), solar: L('#1a264d'),
    hvac: L('#9ea1a3'), store: L('#ffedc7'), doors: P.doors.map(L), awn: P.awn.map(L), lit: P.lit.map(L) });
};
SG.Renderer3D.NOISE = `
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }`;
