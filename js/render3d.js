// 3D renderer (three.js): terrain, extruded buildings with pitched roofs, streets, creeks, trees
// and planning overlays. It exposes the same camera interface as the 2D renderer
// (cx, cy, scale, toWorld, toScreen, pan, zoomAt, viewBB...) so every tool works in both views.
'use strict';

SG.Renderer3D = class Renderer3D {
  static supported() {
    try { const c = document.createElement('canvas'); return !!(window.THREE && (c.getContext('webgl2') || c.getContext('webgl'))); }
    catch (e) { return false; }
  }

  constructor(glCanvas, hudCanvas, world, sim) {
    this.gl = glCanvas; this.hud = hudCanvas; this.ctx = hudCanvas.getContext('2d');
    this.sim = sim;
    this.overlay = 'none';
    this.dirty = true; this.zoneDirty = true;
    this.ghost = null; this.selected = null;
    this.yaw = 0.35; this.pitch = 0.75; this.dist = 3000; this.tx = 0; this.ty = 0;
    this.fov = 45;

    const T = THREE;
    this.renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene = new T.Scene();
    this.scene.background = new T.Color('#a9c9e6');
    this.scene.fog = new T.Fog('#b9d4e8', 4000, 16000);
    this.camera = new T.PerspectiveCamera(this.fov, 1, 5, 40000);

    this.hemi = new T.HemisphereLight('#eef6ff', '#6f7d50', 0.62);
    this.scene.add(this.hemi);
    this.sun = new T.DirectionalLight('#fff1d6', 0.78);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    this.raycaster = new T.Raycaster();
    this.chunks = new Map();
    this.bldMat = new T.MeshLambertMaterial({ vertexColors: true });
    this.roadMat = new T.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.waterMat = new T.MeshLambertMaterial({ color: '#5f9fd0', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.setWorld(world);
    this.resize();
    this.fit();
  }

  setSim(sim) { this.sim = sim; this.dirty = this.zoneDirty = true; }
  get w() { return this._w; }
  set w(world) { if (world !== this._w && this._w) this.setWorld(world); else this._w = world; }

  setWorld(world) {
    this._w = world;
    for (const c of this.chunks.values()) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    this.chunks.clear();
    for (const o of [this.terrain, this.overlayMesh, this.roadMesh, this.waterMesh]) if (o) { this.scene.remove(o); o.geometry.dispose(); }
    if (this.treeTiles) for (const t of this.treeTiles) for (const m of t.meshes) this.scene.remove(m);
    this.buildTerrain();
    this.buildRoads();
    this.buildWater();
    this.syncBuildings(true);
    this.buildTrees();
    this.seen = { v: world.version, r: world.roadVersion, a: world.areaVersion };
    this._miniDirty = true;
    this.dirty = this.zoneDirty = true;
  }

  // ---------- camera interface shared with the 2D renderer ----------
  get cx() { return this.tx; } set cx(v) { this.tx = v; this.dirty = true; }
  get cy() { return this.ty; } set cy(v) { this.ty = v; this.dirty = true; }
  get scale() { return this.vh / (2 * this.dist * Math.tan(this.fov * Math.PI / 360)); }
  set scale(s) { this.dist = Math.max(60, Math.min(14000, this.vh / (2 * Math.tan(this.fov * Math.PI / 360) * s))); this.dirty = true; }
  get minScale() { return this.vh / (2 * 14000 * Math.tan(this.fov * Math.PI / 360)); }

  resize() {
    const r = this.gl.getBoundingClientRect();
    this.vw = Math.max(1, r.width); this.vh = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.vw, this.vh, false);
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
    this.ty = (Math.min(...ys) + Math.max(...ys)) / 2 + 400;
    this.dist = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.05;
    this.yaw = 0.35; this.pitch = 0.75;
    this.dirty = true;
  }
  updateCamera() {
    const h = this.w.heightAt(this.tx, this.ty);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cam = this.camera;
    cam.position.set(this.tx + this.dist * cp * Math.sin(this.yaw), h + this.dist * sp, this.ty + this.dist * cp * Math.cos(this.yaw));
    // keep the camera above the hills
    const ground = this.w.heightAt(cam.position.x, cam.position.z);
    if (cam.position.y < ground + 25) cam.position.y = ground + 25;
    cam.lookAt(this.tx, h, this.ty);
    cam.near = Math.max(2, this.dist / 200); cam.far = this.dist * 6 + 20000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.scene.fog.near = this.dist * 1.6; this.scene.fog.far = this.dist * 5 + 6000;

    // sun from the south-west, afternoon; shadow box follows the view
    const ext = Math.min(2600, Math.max(160, this.dist * 0.9));
    this.sun.position.set(this.tx - ext * 0.9, h + ext * 1.6, this.ty + ext * 0.7);
    this.sun.target.position.set(this.tx, h, this.ty);
    this.sun.target.updateMatrixWorld();
    const sc = this.sun.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = ext * 5;
    sc.updateProjectionMatrix();
    this.sun.castShadow = this.dist < 5000;
  }
  toScreen(x, y, h) {
    const v = this._v || (this._v = new THREE.Vector3());
    v.set(x, h == null ? this.w.heightAt(x, y) : h, y).project(this.camera);
    return [(v.x + 1) / 2 * this.vw, (1 - v.y) / 2 * this.vh, v.z];
  }
  ray(sx, sy) {
    const T = THREE;
    this.raycaster.setFromCamera(new T.Vector2(sx / this.vw * 2 - 1, -(sy / this.vh) * 2 + 1), this.camera);
    return this.raycaster.ray;
  }
  toWorld(sx, sy) {
    this.updateCamera();
    const { origin: o, direction: d } = this.ray(sx, sy);
    if (d.y > -0.02) { // above the horizon: clamp far out
      const f = 12000; return [o.x + d.x * f, o.z + d.z * f];
    }
    let h = this.w.heightAt(this.tx, this.ty), x = o.x, z = o.z;
    for (let k = 0; k < 6; k++) {
      const t = (h - o.y) / d.y;
      x = o.x + d.x * t; z = o.z + d.z * t;
      h = this.w.heightAt(x, z);
    }
    return [x, z];
  }
  // Like toWorld, but hits buildings first (for inspecting and bulldozing tall buildings).
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
        return [hit.point.x + dx / L * 0.4, hit.point.z + dz / L * 0.4];
      }
    }
    return this.toWorld(sx, sy);
  }
  pan(dx, dy) {
    const s = this.scale, sy = Math.max(0.35, Math.sin(this.pitch));
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
    this.dist = Math.max(60, Math.min(14000, this.dist / f));
    const after = this.toWorld(sx, sy);
    if (Math.abs(before[0] - after[0]) < 20000) { this.tx += before[0] - after[0]; this.ty += before[1] - after[1]; }
    this.clampTarget();
    this.dirty = true;
  }
  orbit(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.22, Math.min(1.5, this.pitch + dy * 0.004));
    this.dirty = true;
  }
  viewBB() {
    const pts = [[0, 0], [this.vw, 0], [0, this.vh], [this.vw, this.vh], [this.vw / 2, this.vh / 2]].map(([x, y]) => this.toWorld(x, y));
    const lim = Math.max(400, this.dist * 3);
    const xs = pts.map(p => Math.max(this.tx - lim, Math.min(this.tx + lim, p[0])));
    const ys = pts.map(p => Math.max(this.ty - lim, Math.min(this.ty + lim, p[1])));
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  // ---------- terrain and ground texture ----------
  buildTerrain() {
    const T = THREE, w = this.w;
    const TW = w.TW, TH = w.TH, S = w.TCELL;
    const EW = (TW - 1) * S, EH = (TH - 1) * S;
    const pos = new Float32Array(TW * TH * 3), uv = new Float32Array(TW * TH * 2);
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = j * TW + i, x = w.x0 + i * S, y = w.y0 + j * S;
      pos[3 * k] = x; pos[3 * k + 1] = w.hgt[k]; pos[3 * k + 2] = y;
      uv[2 * k] = i / (TW - 1); uv[2 * k + 1] = 1 - j / (TH - 1);
    }
    const idx = [];
    for (let j = 0; j < TH - 1; j++) for (let i = 0; i < TW - 1; i++) {
      const a = j * TW + i, b = a + 1, c = a + TW, d = c + 1;
      // same split as World.heightAt: (a,b,c) and (b,d,c); wound so normals point up
      idx.push(a, c, b, b, c, d);
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
    this.groundTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.paintGround();
    this.terrain = new T.Mesh(g, new T.MeshLambertMaterial({ map: this.groundTex }));
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    this.overlayTex = null;
    this.overlayMesh = new T.Mesh(g, new T.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.overlayMesh.visible = false;
    this.overlayMesh.renderOrder = 2;
    this.scene.add(this.overlayMesh);
  }
  paintGround() {
    const w = this.w, c = this.groundCanvas, g = c.getContext('2d'), k = this.groundK;
    const path = (p, close = true) => {
      g.moveTo((p[0] - w.x0) * k, (p[1] - w.y0) * k);
      for (let i = 2; i < p.length; i += 2) g.lineTo((p[i] - w.x0) * k, (p[i + 1] - w.y0) * k);
      if (close) g.closePath();
    };
    g.fillStyle = '#9db27f'; g.fillRect(0, 0, c.width, c.height);
    g.beginPath(); for (const r of w.boundary) path(r);
    g.fillStyle = '#bcc68f'; g.fill('evenodd');
    // lawns around homes, a little greener than open land
    g.fillStyle = '#a7bb7a';
    for (const b of w.buildings) {
      if (b.removed || (b.kind !== 'house' && b.kind !== 'duplex')) continue;
      const r = Math.min(30, Math.sqrt(b.area) * 1.4) * k;
      g.fillRect((b.cx - w.x0) * k - r, (b.cy - w.y0) * k - r, 2 * r, 2 * r);
    }
    const col = Object.assign({}, SG.AREA_COLORS, { forest: '#5f8a4c', park: '#8fbd6e', golf: '#9fcb7d', residential: null, commercial: '#d8d2c6', parking: '#c9c5bc' });
    for (const a of w.areas) {
      if (a.removed || !col[a.kind]) continue;
      g.beginPath(); path(a.pts); g.fillStyle = col[a.kind]; g.fill();
    }
    // paths and trails are painted; streets are real geometry
    g.strokeStyle = '#b9a47c'; g.lineWidth = Math.max(1, 2 * k); g.setLineDash([3, 2]);
    g.beginPath(); for (const r of w.roads) if (!r.removed && r.cls >= 5) path(r.pts, false); g.stroke();
    g.setLineDash([]);
    // street shadow on the ground so roads read from far away
    g.strokeStyle = '#a8a493'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of w.roads) {
      if (r.removed || r.cls > 4) continue;
      g.lineWidth = Math.max(1, SG.ROAD_STYLE[r.cls][0] * k * 1.25);
      g.beginPath(); path(r.pts, false); g.stroke();
    }
    g.beginPath(); for (const r of w.boundary) path(r);
    g.setLineDash([10, 6]); g.strokeStyle = 'rgba(120,40,90,.6)'; g.lineWidth = 3; g.stroke(); g.setLineDash([]);
    this.groundTex.needsUpdate = true;
  }
  updateOverlay() {
    const T = THREE;
    if (this.overlay === 'none') { this.overlayMesh.visible = false; this.zoneDirty = false; return; }
    SG.Renderer.prototype.buildOverlay.call(this);
    const w = this.w, oc = this.overlayCanvas;
    // the overlay grid covers W*CELL; the terrain covers (TW-1)*TCELL — draw into a matching canvas
    const [EW, EH] = this.groundExtent;
    const c = this._ovc || (this._ovc = document.createElement('canvas'));
    c.width = Math.round(EW / SG.CELL); c.height = Math.round(EH / SG.CELL);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(oc, 0, 0);
    if (!this.overlayTex) {
      this.overlayTex = new T.CanvasTexture(c);
      this.overlayTex.magFilter = T.NearestFilter; this.overlayTex.minFilter = T.LinearFilter;
      this.overlayMesh.material.map = this.overlayTex;
      this.overlayMesh.material.needsUpdate = true;
    }
    this.overlayTex.needsUpdate = true;
    this.overlayMesh.visible = true;
    void w;
  }
  gridCanvas(fill) { return SG.Renderer.prototype.gridCanvas.call(this, fill); }

  // ---------- streets and creeks ----------
  ribbon(list, widthFn, colorFn, lift) {
    const w = this.w, pos = [], col = [];
    const color = new THREE.Color();
    for (const item of list) {
      const p = item.pts;
      // densify so the ribbon follows the terrain
      const pts = [];
      for (let i = 0; i < p.length - 2; i += 2) {
        const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 18));
        for (let s = 0; s < n; s++) pts.push([ax + (bx - ax) * s / n, ay + (by - ay) * s / n]);
      }
      pts.push([p[p.length - 2], p[p.length - 1]]);
      if (pts.length < 2) continue;
      const hw = widthFn(item) / 2;
      color.set(colorFn(item));
      const L = [], R = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        const [x, y] = pts[i];
        const nx = -dy * hw, ny = dx * hw;
        L.push([x + nx, y + ny]); R.push([x - nx, y - ny]);
      }
      const H = q => w.heightAt(q[0], q[1]) + lift;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = L[i], b = R[i], c = L[i + 1], d = R[i + 1];
        // two triangles with upward normals
        pos.push(a[0], H(a), a[1], c[0], H(c), c[1], b[0], H(b), b[1]);
        pos.push(b[0], H(b), b[1], c[0], H(c), c[1], d[0], H(d), d[1]);
        for (let k = 0; k < 6; k++) col.push(color.r, color.g, color.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // make sure every triangle faces up
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 9) {
      const ux = P[i + 3] - P[i], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vz = P[i + 8] - P[i + 2];
      if (uz * vx - ux * vz < 0) for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; }
    }
    g.computeVertexNormals();
    return g;
  }
  buildRoads() {
    if (this.roadMesh) { this.scene.remove(this.roadMesh); this.roadMesh.geometry.dispose(); }
    const roads = this.w.roads.filter(r => !r.removed && r.cls <= 4).sort((a, b) => b.cls - a.cls);
    const colors = ['#e2b25a', '#8d8c88', '#9a9995', '#a3a29d', '#b5b1a6'];
    const g = this.ribbon(roads, r => SG.ROAD_STYLE[r.cls][0], r => colors[r.cls], 0.35);
    this.roadMesh = new THREE.Mesh(g, this.roadMat);
    this.roadMesh.receiveShadow = true;
    this.scene.add(this.roadMesh);
  }
  buildWater() {
    if (this.waterMesh) { this.scene.remove(this.waterMesh); this.waterMesh.geometry.dispose(); }
    const g = this.ribbon(this.w.water, () => 7, () => '#5f9fd0', 0.2);
    this.waterMesh = new THREE.Mesh(g, this.waterMat);
    this.scene.add(this.waterMesh);
  }

  // ---------- buildings ----------
  static hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }
  chunkKey(b) { return Math.floor(b.cx / 400) + ',' + Math.floor(b.cy / 400); }
  syncBuildings(all) {
    const w = this.w;
    if (all) this.bChunk = new Map();
    const sigs = new Map();
    for (const b of w.buildings) {
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
  buildChunk(key, sig) {
    const T = THREE, w = this.w;
    const old = this.chunks.get(key);
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
    const list = w.buildings.filter(b => !b.removed && this.chunkKey(b) === key);
    const pos = [], col = [], triIds = [];
    const wallC = new T.Color(), roofC = new T.Color();
    const walls = ['#efe6d6', '#e8dcc4', '#f3efe6', '#ddd0b6', '#e9e3d7', '#d6cfc0'];
    const shopWalls = ['#e6d6b8', '#d4b896', '#c48a66', '#efe4d2', '#b9a58c', '#d9c7a0'];
    const roofs = ['#a85e45', '#8a8987', '#6d5b4d', '#9b5536', '#77767a', '#94694e', '#5f6466'];
    for (const b of list) {
      const hsh = Renderer3D.hash(b.id + 1);
      const kind = SG.KIND[b.kind] || SG.KIND.other;
      const resi = b.kind === 'house' || b.kind === 'adu' || b.kind === 'duplex' || b.kind === 'townhomes' || b.kind === 'accessory';
      const shops = b.kind === 'commercial' || b.kind === 'mixeduse';
      wallC.set(resi ? walls[Math.floor(hsh * walls.length)] : shops ? shopWalls[Math.floor(hsh * shopWalls.length)] : kind.color);
      roofC.set(resi ? roofs[Math.floor(Renderer3D.hash(b.id * 7 + 3) * roofs.length)] : shops ? '#7b7772' : kind.roof);
      let levelH = b.kind === 'accessory' ? 2.8 : 3.3;
      let top = Math.max(1, b.levels || 1) * levelH + (b.kind === 'commercial' || b.kind === 'mixeduse' ? 1 : 0);
      if (b.construction) {
        const prog = 1 - b.months / Math.max(1, b.totalMonths || 18);
        top = Math.max(0.6, top * prog);
        wallC.set('#e3c27a'); roofC.set('#c9a25a');
      }
      this.extrude(b, top, wallC, roofC, resi && !b.construction, pos, col, triIds);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, this.bldMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const chunk = { key, sig, mesh, triIds: Int32Array.from(triIds) };
    mesh.userData.chunk = chunk;
    this.scene.add(mesh);
    this.chunks.set(key, chunk);
  }
  extrude(b, wallH, wallC, roofC, pitched, pos, col, triIds) {
    const w = this.w, T = THREE;
    let p = Array.from(b.pts);
    // drop a duplicated closing vertex
    if (p.length > 4 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) p = p.slice(0, -2);
    const n = p.length / 2;
    if (n < 3) return;
    // orientation so wall normals point outward (see notes in the README)
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1];
    if (area > 0) { const q = []; for (let i = n - 1; i >= 0; i--) q.push(p[2 * i], p[2 * i + 1]); p = q; }
    let base = Infinity;
    for (let i = 0; i < n; i++) base = Math.min(base, w.heightAt(p[2 * i], p[2 * i + 1]));
    const bot = base - 1.5, top = base + wallH;
    const push = (a, b2, c, color) => {
      pos.push(...a, ...b2, ...c);
      for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b);
      triIds.push(b.id);
    };
    const tri = (a, b2, c, color, ref) => {
      // flip if the normal disagrees with the reference direction
      const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * ref[0] + ny * ref[1] + nz * ref[2] < 0) push(a, c, b2, color); else push(a, b2, c, color);
    };
    // walls, slightly darker toward the bottom is handled by lighting
    const wc = wallC;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[2 * i], az = p[2 * i + 1], bx = p[2 * j], bz = p[2 * j + 1];
      const out = [-(bz - az), 0, bx - ax];
      tri([ax, bot, az], [bx, bot, bz], [bx, top, bz], wc, out);
      tri([ax, bot, az], [bx, top, bz], [ax, top, az], wc, out);
    }
    const up = [0, 1, 0];
    if (pitched && n === 4) {
      // gable roof along the long axis
      const P = i => [p[2 * i], p[2 * i + 1]];
      let [q0, q1, q2, q3] = [P(0), P(1), P(2), P(3)];
      const l01 = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]), l12 = Math.hypot(q2[0] - q1[0], q2[1] - q1[1]);
      if (l12 > l01) [q0, q1, q2, q3] = [q1, q2, q3, q0];
      const short = Math.min(l01, l12);
      const rh = Math.min(4.5, short * 0.32);
      const m = (a, c) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const r1 = m(q1, q2), r0 = m(q3, q0);
      const V = (q, h) => [q[0], h, q[1]];
      const ridgeH = top + rh;
      const cx = b.cx, cz = b.cy;
      const outFrom = (...qs) => { const mx = qs.reduce((s, q) => s + q[0], 0) / qs.length, mz = qs.reduce((s, q) => s + q[1], 0) / qs.length; return [mx - cx, 0.6, mz - cz]; };
      // eaves overhang a little
      tri(V(q0, top), V(q1, top), V(r1, ridgeH), roofC, outFrom(q0, q1));
      tri(V(q0, top), V(r1, ridgeH), V(r0, ridgeH), roofC, outFrom(q0, q1));
      tri(V(q2, top), V(q3, top), V(r0, ridgeH), roofC, outFrom(q2, q3));
      tri(V(q2, top), V(r0, ridgeH), V(r1, ridgeH), roofC, outFrom(q2, q3));
      tri(V(q1, top), V(q2, top), V(r1, ridgeH), wc, outFrom(q1, q2));
      tri(V(q3, top), V(q0, top), V(r0, ridgeH), wc, outFrom(q3, q0));
      return;
    }
    // flat roof
    const contour = [];
    for (let i = 0; i < n; i++) contour.push(new T.Vector2(p[2 * i], p[2 * i + 1]));
    let faces;
    try { faces = T.ShapeUtils.triangulateShape(contour, []); } catch (e) { faces = []; }
    for (const [a, b2, c] of faces)
      tri([p[2 * a], top, p[2 * a + 1]], [p[2 * b2], top, p[2 * b2 + 1]], [p[2 * c], top, p[2 * c + 1]], roofC, up);
  }

  // ---------- trees ----------
  buildTrees() {
    const T = THREE, w = this.w;
    const rnd = (() => { let s = 20250101; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    const spots = []; // [x, y, scale, type]
    const free = (x, y, clear) => {
      for (const b of w.buildingsIn([x - clear, y - clear, x + clear, y + clear])) {
        if (SG.World.pointInPoly(x, y, b.pts)) return false;
        if (Math.hypot(b.cx - x, b.cy - y) < clear + Math.sqrt(b.area) / 2) return false;
      }
      const c = w.cellOf(x, y);
      if (c < 0) return false;
      const nr = w.nearestRoad(x, y, 9, false);
      return !nr;
    };
    // yard trees around homes
    for (const b of w.buildings) {
      if (b.removed || (b.kind !== 'house' && b.kind !== 'duplex')) continue;
      const nTrees = 1 + Math.floor(rnd() * 3.2);
      for (let k = 0; k < nTrees; k++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(b.area) * 0.7 + 4 + rnd() * 14;
        const x = b.cx + Math.cos(a) * d, y = b.cy + Math.sin(a) * d;
        if (free(x, y, 3)) spots.push([x, y, 0.7 + rnd() * 0.8, rnd() < 0.2 ? 1 : 0]);
      }
    }
    // woods, parks and orchards
    for (const a of w.areas) {
      const spacing = { forest: 13, park: 28, golf: 45, orchard: 9, sports: 60, cemetery: 30, campus: 40 }[a.kind];
      if (!spacing) continue;
      const bb = SG.World.bbox(a.pts);
      const cnt = Math.min(20000, ((bb[2] - bb[0]) * (bb[3] - bb[1])) / (spacing * spacing));
      for (let k = 0; k < cnt; k++) {
        let x, y;
        if (a.kind === 'orchard') { // rows
          const i = k % Math.ceil((bb[2] - bb[0]) / spacing), j = Math.floor(k / Math.ceil((bb[2] - bb[0]) / spacing));
          x = bb[0] + i * spacing; y = bb[1] + j * spacing;
        } else { x = bb[0] + rnd() * (bb[2] - bb[0]); y = bb[1] + rnd() * (bb[3] - bb[1]); }
        if (!SG.World.pointInPoly(x, y, a.pts)) continue;
        if (a.kind !== 'forest' && a.kind !== 'orchard' && !free(x, y, 3)) continue;
        if (a.kind === 'forest' && w.roadDist[w.cellOf(x, y)] === 0) continue;
        spots.push([x, y, a.kind === 'orchard' ? 0.55 : 0.8 + rnd() * 0.9, a.kind === 'forest' && rnd() < 0.45 ? 1 : 0]);
      }
    }
    // oak woodland on unbuilt hillside land
    for (let i = 0; i < w.zone.length; i++) {
      const z = w.zone[i];
      if ((z !== SG.Z.HR && z !== SG.Z.OS && z !== SG.Z.R_1_40_000) || w.claim[i] !== -1 || w.roadDist[i] === 0 || w.areaK[i]) continue;
      if (rnd() > (z === SG.Z.R_1_40_000 ? 0.25 : 0.55)) continue;
      const [cx, cy] = w.cellCenter(i);
      const x = cx + (rnd() - 0.5) * SG.CELL, y = cy + (rnd() - 0.5) * SG.CELL;
      spots.push([x, y, 0.9 + rnd() * 0.9, rnd() < 0.35 ? 1 : 0]);
    }
    this.treeSpots = spots;

    // geometry: round broadleaf and conifer, each trunk + crown with vertex colours
    const make = (crown, crownY, crownColor) => {
      const trunk = new T.CylinderGeometry(0.35, 0.5, 3, 5, 1, true).toNonIndexed();
      trunk.translate(0, 1.5, 0);
      const cr = crown.index ? crown.toNonIndexed() : crown; cr.translate(0, crownY, 0);
      const parts = [[trunk, new T.Color('#6b4f36')], [cr, new T.Color(crownColor)]];
      const pos = [], nor = [], colr = [];
      for (const [geo, c] of parts) {
        geo.computeVertexNormals();
        pos.push(...geo.attributes.position.array); nor.push(...geo.attributes.normal.array);
        for (let i = 0; i < geo.attributes.position.count; i++) colr.push(c.r, c.g, c.b);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
      return g;
    };
    const geos = [make(new T.IcosahedronGeometry(3.6, 0), 5.2, '#5e8c47'), make(new T.ConeGeometry(2.8, 9, 6), 6.8, '#3f6b3d')];
    const mat = new T.MeshLambertMaterial({ vertexColors: true });
    // tiles of 800 m so we can cull them by hand (InstancedMesh culls as a whole)
    const tiles = new Map();
    for (const s of spots) {
      const key = Math.floor(s[0] / 800) + ',' + Math.floor(s[1] / 800);
      let t = tiles.get(key); if (!t) tiles.set(key, t = [[], []]); t[s[3]].push(s);
    }
    this.treeTiles = [];
    const m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3(), color = new T.Color();
    for (const [key, groups] of tiles) {
      const [kx, ky] = key.split(',').map(Number);
      const box = new T.Box3(new T.Vector3(kx * 800, -100, ky * 800), new T.Vector3(kx * 800 + 800, 1200, ky * 800 + 800));
      const meshes = [];
      groups.forEach((list, type) => {
        if (!list.length) return;
        const im = new T.InstancedMesh(geos[type], mat, list.length);
        list.forEach((s, i) => {
          q.setFromAxisAngle(v.set(0, 1, 0), (s[0] * 13.7 + s[1]) % 6.28);
          sc.set(s[2], s[2] * (0.85 + ((s[0] * 7.3) % 1) * 0.4), s[2]);
          m4.compose(v.set(s[0], w.heightAt(s[0], s[1]) - 0.3, s[1]), q, sc);
          im.setMatrixAt(i, m4);
          color.setHSL(0.27 + ((s[1] * 3.1) % 1) * 0.07, 0.35 + ((s[0] * 1.7) % 1) * 0.2, 0.75 + ((s[0] + s[1]) % 1) * 0.35);
          im.setColorAt(i, color);
        });
        im.castShadow = true; im.receiveShadow = false;
        im.frustumCulled = false;
        im.userData.spots = list;
        this.scene.add(im);
        meshes.push(im);
      });
      this.treeTiles.push({ box, meshes });
    }
  }
  // hide trees that a new building or road now sits on
  pruneTrees() {
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
        if (!s.gone && w.playerParks.length) for (const a of w.playerParks) if (SG.World.pointInPoly(s[0], s[1], a.pts) && i % 3) { /* parks keep some trees */ }
      });
      if (changed) im.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- frame ----------
  sync() {
    const w = this.w, seen = this.seen;
    if (seen.v !== w.version) { this.syncBuildings(false); this.pruneTrees(); this._miniDirty = true; }
    if (seen.r !== w.roadVersion) this.buildRoads();
    if (seen.r !== w.roadVersion || seen.a !== w.areaVersion) this.paintGround();
    this.seen = { v: w.version, r: w.roadVersion, a: w.areaVersion };
  }
  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    this.sync();
    if (this.zoneDirty) this.updateOverlay();
    this.updateCamera();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const far2 = (this.dist * 4 + 1500) ** 2;
    for (const t of this.treeTiles) {
      const cx = (t.box.min.x + t.box.max.x) / 2, cz = (t.box.min.z + t.box.max.z) / 2;
      const vis = frustum.intersectsBox(t.box) && ((cx - this.tx) ** 2 + (cz - this.ty) ** 2) < far2;
      for (const m of t.meshes) m.visible = vis;
    }
    this.renderer.render(this.scene, this.camera);
    this.drawHud();
  }

  // ---------- HUD: labels, selection, tool previews ----------
  drawHud() {
    const ctx = this.ctx, w = this.w;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    const on = (p) => p[2] < 1 && p[0] > -80 && p[1] > -40 && p[0] < this.vw + 80 && p[1] < this.vh + 40;
    const used = [];
    const free = (x, y, wd, h) => {
      for (const u of used) if (Math.abs(u[0] - x) < (u[2] + wd) / 2 && Math.abs(u[1] - y) < (u[3] + h) / 2) return false;
      used.push([x, y, wd, h]); return true;
    };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const s = this.scale;

    // selection
    const sel = this.selected;
    if (sel && sel.pts) {
      ctx.strokeStyle = '#ff3d7f'; ctx.lineWidth = 2.5;
      if (sel.cls != null) { this.hudLine(sel.pts, 1); ctx.stroke(); }
      else this.hudBox(sel.pts, (Math.max(1, sel.levels || 1) * 3.3) + (sel.kind === 'house' ? 3 : 0));
    }
    // ghost
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

    // place labels
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
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(p.name, q[0], q[1]);
      ctx.fillStyle = place ? '#6b2b56' : p.kind === 'park' || p.kind === 'golf' ? '#2b5a20' : '#363352';
      ctx.fillText(p.name, q[0], q[1]);
    }
    // street names
    if (s > 0.55) {
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
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(r.name, 0, 0);
        ctx.fillStyle = '#3e3a34'; ctx.fillText(r.name, 0, 0);
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
    let base = Infinity;
    for (let i = 0; i < n; i++) base = Math.min(base, this.w.heightAt(flat[2 * i], flat[2 * i + 1]));
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
