/* Find the Hidden Treasure — a 3D web game starring the red-faced treasure hunter king. */
(function () {
  "use strict";

  // ---------- basic setup ----------
  const IS_TOUCH = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  const container = document.getElementById("game");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  // phones: lower pixel ratio keeps the frame rate smooth
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.6 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3aa0ff);
  scene.fog = new THREE.Fog(0x3aa0ff, 70, 160);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 6, 10);

  function fitCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    // portrait phones: widen the view so the world doesn't feel cramped
    camera.fov = aspect < 0.8 ? 68 : 55;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  fitCamera();
  window.addEventListener("resize", fitCamera);
  window.addEventListener("orientationchange", () => setTimeout(fitCamera, 250));

  // lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sky = new THREE.HemisphereLight(0xbfe8ff, 0x4a7a2f, 0.5);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 120;
  scene.add(sun, sun.target);

  const MAT = (color, opts) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0.05 }, opts || {}));

  // ---------- world ----------
  const WORLD = 62; // playable half-size

  // brown "underground" base, like the drawing's dirt border
  const dirtBase = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), MAT(0x7a5b3a));
  dirtBase.rotation.x = -Math.PI / 2;
  dirtBase.position.y = -0.05;
  dirtBase.receiveShadow = true;
  scene.add(dirtBase);

  // main green field
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), MAT(0x2fae2f));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  function groundPatch(w, d, x, z, color, y) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT(color));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y || 0.02, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // snowy white zone (right side of the map)
  groundPatch(56, 150, 47, 0, 0xf2f0ea);
  // brown dirt patch (bottom left)
  groundPatch(70, 45, -35, 48, 0x8a6134, 0.03);
  // yellow sandy path along the bottom
  groundPatch(150, 12, 0, 68, 0xe8d44d, 0.04);
  // yellow patch for the lake (top left, like the drawing)
  groundPatch(34, 30, -40, -34, 0xe8d44d, 0.03);

  // squiggly blue lake: overlapping blue discs
  const lakeMat = MAT(0x2f7df6, { roughness: 0.3, metalness: 0.15 });
  [[-46, -40, 5], [-38, -34, 6], [-44, -28, 4.5], [-33, -41, 4], [-36, -25, 3.4]].forEach(([x, z, r]) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 28), lakeMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, 0.06, z);
    scene.add(d);
  });

  // rainbow cave portals (the tunnel arches from the drawing) — they teleport!
  function rainbowPortal(x, z, rotY) {
    const g = new THREE.Group();
    const colors = [0xd8262c, 0x7a3b16, 0x2f6df6, 0x24b6c9, 0x2fae2f];
    colors.forEach((c, i) => {
      const r = 5.2 - i * 0.85;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 10, 40, Math.PI), MAT(c));
      arc.castShadow = true;
      g.add(arc);
    });
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshBasicMaterial({ color: 0x120a14 }));
    hole.position.y = 0.4;
    hole.position.z = 0.05;
    g.add(hole);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
    return g;
  }
  const portals = [
    rainbowPortal(-52, -50, Math.PI / 4),
    rainbowPortal(50, 52, Math.PI + Math.PI / 4)
  ];
  let portalCooldown = 0;
  let camSnap = false;

  // question-mark blocks
  function questionTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    x.fillStyle = "#e8b520";
    x.fillRect(0, 0, 128, 128);
    x.strokeStyle = "#a97b00";
    x.lineWidth = 10;
    x.strokeRect(5, 5, 118, 118);
    x.fillStyle = "#6b4a00";
    x.font = "bold 84px sans-serif";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("?", 64, 70);
    return new THREE.CanvasTexture(c);
  }
  const qMat = new THREE.MeshStandardMaterial({ map: questionTexture(), roughness: 0.6 });
  const qMatUsed = new THREE.MeshStandardMaterial({ color: 0x9a8a5a, roughness: 0.8 });
  const qBlocks = [];
  [[6, 3.2, -22], [-16, 3.2, 12], [30, 3.4, -30]].forEach(([x, y, z]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), qMat);
    b.position.set(x, y, z);
    b.castShadow = true;
    b.userData.baseY = y;
    b.userData.used = false;
    b.userData.pop = 0;
    scene.add(b);
    qBlocks.push(b);
  });

  // trees
  function tree(x, z, snowy) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 1.4, 8), MAT(0x7a4a1e));
    trunk.position.y = 0.7;
    trunk.castShadow = true;
    g.add(trunk);
    const leafColor = snowy ? 0xdfeee0 : 0x1d8a1d;
    for (let i = 0; i < 2; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5 - i * 0.45, 1.9, 9), MAT(leafColor));
      cone.position.y = 1.9 + i * 1.1;
      cone.castShadow = true;
      g.add(cone);
    }
    g.position.set(x, 0, z);
    scene.add(g);
  }
  [[-12, -12], [-24, 4], [14, 16], [22, 34], [-52, 20], [-20, -48], [8, -40], [-4, 44], [-55, 40], [18, 55]].forEach(p => tree(p[0], p[1], false));
  [[40, -12], [55, 8], [45, 30], [58, -30]].forEach(p => tree(p[0], p[1], true));

  // walk-in stone castle: two floors, stairs, battlements, and a pitched roof.
  // Walls and roof fade to glass while the player is inside so the camera can see.
  const castleThrone = { pos: new THREE.Vector3(), visited: false };
  const castleCourtyardStars = [];
  const castlePlatforms = []; // local-space rects the player can stand on
  const castleFade = { mats: [], level: 1 };
  // solid geometry the player cannot walk through, in the castle's local space
  const castleCollider = {
    cx: 44, cz: -44,
    cos: Math.cos(-Math.PI / 4), sin: Math.sin(-Math.PI / 4),
    boxes: [], circles: []
  };
  (function castle() {
    const g = new THREE.Group();
    function stoneTexture(light) {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const x = c.getContext("2d");
      x.fillStyle = light ? "#b7b3a9" : "#a19d94";
      x.fillRect(0, 0, 256, 256);
      x.strokeStyle = "#7e7a71";
      x.lineWidth = 3;
      for (let row = 0; row < 8; row++) {
        const y = row * 32;
        x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke();
        for (let bx = (row % 2) * 32; bx <= 256; bx += 64) {
          x.beginPath(); x.moveTo(bx, y); x.lineTo(bx, y + 32); x.stroke();
        }
      }
      x.fillStyle = "rgba(30,25,20,0.07)";
      for (let i = 0; i < 14; i++) {
        const row = Math.floor(Math.random() * 8);
        x.fillRect(((row % 2) * 32 + Math.floor(Math.random() * 4) * 64) % 256, row * 32, 64, 32);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    }
    const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTexture(false), roughness: 0.95, transparent: true });
    const stepMat = new THREE.MeshStandardMaterial({ map: stoneTexture(true), roughness: 0.95 });
    const roofMat = MAT(0x8a3b2e, { roughness: 0.8, transparent: true });
    const towerRoofMat = MAT(0x7a1fd0, { transparent: true });
    castleFade.mats.push(stoneMat, roofMat, towerRoofMat);
    const H = 6, TH = 0.8, W = 24, D = 18, GATE = 4.4, TR = 2.2, FLOOR2 = 4.2;
    const wall = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // front wall with the gateway (opening up to y=3.9, stone above it)
    const segW = (W - GATE) / 2;
    wall(segW, H, TH, GATE / 2 + segW / 2, H / 2, D / 2);
    wall(segW, H, TH, -GATE / 2 - segW / 2, H / 2, D / 2);
    wall(GATE, H - 3.9, TH, 0, (H + 3.9) / 2, D / 2);
    // back and side walls
    wall(W, H, TH, 0, H / 2, -D / 2);
    wall(TH, H, D, -W / 2, H / 2, 0);
    wall(TH, H, D, W / 2, H / 2, 0);
    // battlements (merlons) along every wall top, skipping the gate
    for (let mx = -W / 2 + 0.7; mx <= W / 2 - 0.6; mx += 1.9) {
      wall(1, 0.9, TH + 0.15, mx, H + 0.45, -D / 2);
      if (Math.abs(mx) > GATE / 2 + 0.7) wall(1, 0.9, TH + 0.15, mx, H + 0.45, D / 2);
    }
    for (let mz = -D / 2 + 0.9; mz <= D / 2 - 0.8; mz += 1.9) {
      wall(TH + 0.15, 0.9, 1, -W / 2, H + 0.45, mz);
      wall(TH + 0.15, 0.9, 1, W / 2, H + 0.45, mz);
    }
    // arrow-slit windows on the front wall
    [-8.5, -4.5, 4.5, 8.5].forEach(wx => {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.5, 0.12), new THREE.MeshBasicMaterial({ color: 0x1a140e }));
      slit.position.set(wx, 3.6, D / 2 + TH / 2 + 0.02);
      g.add(slit);
    });
    // stone corner towers with purple roofs
    [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]].forEach(([tx, tz], ti) => {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(TR, TR + 0.3, 9, 14), stoneMat);
      tower.position.set(tx, 4.5, tz);
      tower.castShadow = true;
      g.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(TR + 0.7, 3.6, 14), towerRoofMat);
      roof.position.set(tx, 10.8, tz);
      roof.castShadow = true;
      g.add(roof);
      castleCollider.circles.push({ x: tx, z: tz, r: TR });
      // flags on the two front towers
      if (ti >= 2) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), MAT(0x7a4a1e));
        pole.position.set(tx, 13.6, tz);
        g.add(pole);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.65, 0.06), MAT(0xd8262c));
        flag.position.set(tx + 0.65, 14.4, tz);
        g.add(flag);
      }
    });
    // red carpet from the gate to the throne
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(3.2, D - 2), MAT(0xc22432));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.06, 0.5);
    carpet.receiveShadow = true;
    g.add(carpet);
    // staircase along the left wall up to the second floor
    const stairMinX = -W / 2 + 0.4, stairMaxX = stairMinX + 2.4, zFront = 2.6;
    for (let i = 0; i < 8; i++) {
      const top = FLOOR2 * (i + 1) / 8;
      const step = new THREE.Mesh(new THREE.BoxGeometry(stairMaxX - stairMinX, 0.35, 0.6), stepMat);
      step.position.set((stairMinX + stairMaxX) / 2, top - 0.175, zFront - 0.6 * i - 0.3);
      step.castShadow = true;
      step.receiveShadow = true;
      g.add(step);
      castlePlatforms.push({ minX: stairMinX, maxX: stairMaxX, minZ: zFront - 0.6 * (i + 1), maxZ: zFront - 0.6 * i, top });
    }
    // solid banister on the open side of the stairs
    const banX = stairMaxX + 0.15;
    const banister = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 4.5), stoneMat);
    banister.position.set(banX, 2.2, 0.35);
    banister.castShadow = true;
    g.add(banister);
    castleCollider.boxes.push({ minX: banX - 0.15, maxX: banX + 0.15, minZ: -1.9, maxZ: 2.6 });
    // second floor over the throne hall
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W - 0.8, 0.5, 6.6), stoneMat);
    slab.position.set(0, FLOOR2 - 0.25, -5.3);
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
    castlePlatforms.push({ minX: -W / 2 + 0.4, maxX: W / 2 - 0.4, minZ: -8.6, maxZ: -2, top: FLOOR2 });
    // columns holding the hall ceiling
    [-5, 5].forEach(cx => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, FLOOR2 - 0.5, 12), stepMat);
      col.position.set(cx, (FLOOR2 - 0.5) / 2, -2.7);
      col.castShadow = true;
      g.add(col);
      castleCollider.circles.push({ x: cx, z: -2.7, r: 0.55 });
    });
    // pitched roof over the upper floor, high enough to walk under its eaves
    const eaveY = 7.4, ridgeY = 9.6, eaveF = -1.7, eaveB = -8.9, ridgeZ = -5.3;
    const panelLen = Math.hypot(ridgeZ - eaveF, ridgeY - eaveY);
    const pitch = Math.atan2(ridgeY - eaveY, Math.abs(ridgeZ - eaveF));
    const front = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.22, panelLen), roofMat);
    front.position.set(0, (eaveY + ridgeY) / 2, (eaveF + ridgeZ) / 2);
    front.rotation.x = pitch;
    front.castShadow = true;
    g.add(front);
    const backP = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.22, panelLen), roofMat);
    backP.position.set(0, (eaveY + ridgeY) / 2, (eaveB + ridgeZ) / 2);
    backP.rotation.x = -pitch;
    backP.castShadow = true;
    g.add(backP);
    // stone gable ends closing the roof sides
    const gable = new THREE.Shape();
    gable.moveTo(eaveF, H);
    gable.lineTo(eaveF, eaveY);
    gable.lineTo(ridgeZ, ridgeY);
    gable.lineTo(eaveB, eaveY);
    gable.lineTo(eaveB, H);
    gable.closePath();
    [-W / 2 + 0.4, W / 2 - 0.75].forEach(gx => {
      const end = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: 0.35, bevelEnabled: false }), stoneMat);
      end.rotation.y = -Math.PI / 2;
      end.position.set(gx, 0, 0);
      end.castShadow = true;
      g.add(end);
    });
    // wall colliders (front segments, back, sides)
    castleCollider.boxes.push(
      { minX: GATE / 2, maxX: W / 2, minZ: D / 2 - TH / 2, maxZ: D / 2 + TH / 2 },
      { minX: -W / 2, maxX: -GATE / 2, minZ: D / 2 - TH / 2, maxZ: D / 2 + TH / 2 },
      { minX: -W / 2, maxX: W / 2, minZ: -D / 2 - TH / 2, maxZ: -D / 2 + TH / 2 },
      { minX: -W / 2 - TH / 2, maxX: -W / 2 + TH / 2, minZ: -D / 2, maxZ: D / 2 },
      { minX: W / 2 - TH / 2, maxX: W / 2 + TH / 2, minZ: -D / 2, maxZ: D / 2 }
    );
    // golden throne with a red cushion
    const throne = new THREE.Group();
    const goldMat = MAT(0xd9a51f, { metalness: 0.6, roughness: 0.35 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.1), goldMat);
    seat.position.y = 0.55;
    seat.castShadow = true;
    throne.add(seat);
    const backRest = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.25), goldMat);
    backRest.position.set(0, 1.6, -0.45);
    backRest.castShadow = true;
    throne.add(backRest);
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.18, 0.9), MAT(0xc22432));
    cushion.position.y = 0.9;
    throne.add(cushion);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), goldMat);
    knob.position.set(0, 2.8, -0.45);
    throne.add(knob);
    throne.scale.setScalar(1.3);
    throne.position.set(0, 0, -D / 2 + 2);
    g.add(throne);
    castleCollider.circles.push({ x: 0, z: -D / 2 + 1.7, r: 1.1 });
    g.position.set(44, 0, -44);
    g.rotation.y = -Math.PI / 4; // gateway looks toward the middle of the map
    scene.add(g);
    g.updateMatrixWorld(true);
    castleThrone.pos.copy(throne.getWorldPosition(new THREE.Vector3()));
    // one star in the courtyard, one up on the second floor
    [new THREE.Vector3(6, 1.2, 1), new THREE.Vector3(-5, FLOOR2 + 1.2, -5)].forEach(local => {
      castleCourtyardStars.push(g.localToWorld(local.clone()));
    });
  })();
  // height of whatever the player can stand on at (x, z); py filters out
  // platforms more than a step above the player's feet
  function groundHeightAt(px, pz, py) {
    const cc = castleCollider;
    const dx0 = px - cc.cx, dz0 = pz - cc.cz;
    if (dx0 * dx0 + dz0 * dz0 > 700) return 0;
    const lx = cc.cos * dx0 - cc.sin * dz0;
    const lz = cc.sin * dx0 + cc.cos * dz0;
    let h = 0;
    for (const p of castlePlatforms) {
      if (lx > p.minX && lx < p.maxX && lz > p.minZ && lz < p.maxZ && p.top <= py + 0.65) {
        h = Math.max(h, p.top);
      }
    }
    return h;
  }
  function insideCastle() {
    const cc = castleCollider;
    const dx0 = player.pos.x - cc.cx, dz0 = player.pos.z - cc.cz;
    if (dx0 * dx0 + dz0 * dz0 > 400) return false;
    const lx = cc.cos * dx0 - cc.sin * dz0;
    const lz = cc.sin * dx0 + cc.cos * dz0;
    return Math.abs(lx) < 13.5 && Math.abs(lz) < 11;
  }
  // push the player out of castle walls, towers, and the throne
  function collideWithCastle() {
    const cc = castleCollider, r = 0.55;
    const dx0 = player.pos.x - cc.cx, dz0 = player.pos.z - cc.cz;
    if (dx0 * dx0 + dz0 * dz0 > 700) return; // nowhere near the castle
    let lx = cc.cos * dx0 - cc.sin * dz0;
    let lz = cc.sin * dx0 + cc.cos * dz0;
    for (const b of cc.boxes) {
      if (lx > b.minX - r && lx < b.maxX + r && lz > b.minZ - r && lz < b.maxZ + r) {
        const pL = lx - (b.minX - r), pR = (b.maxX + r) - lx;
        const pB = lz - (b.minZ - r), pF = (b.maxZ + r) - lz;
        const m = Math.min(pL, pR, pB, pF);
        if (m === pL) lx = b.minX - r;
        else if (m === pR) lx = b.maxX + r;
        else if (m === pB) lz = b.minZ - r;
        else lz = b.maxZ + r;
      }
    }
    for (const c of cc.circles) {
      const ddx = lx - c.x, ddz = lz - c.z, rr = c.r + r;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        lx = c.x + ddx / d * rr;
        lz = c.z + ddz / d * rr;
      }
    }
    player.pos.x = cc.cx + cc.cos * lx + cc.sin * lz;
    player.pos.z = cc.cz - cc.sin * lx + cc.cos * lz;
  }

  // swirl lollipops (the colorful spirals in the snowy zone)
  function spiralTexture(c1, c2) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d");
    x.fillStyle = c2;
    x.beginPath();
    x.arc(128, 128, 126, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = c1;
    x.lineWidth = 22;
    x.beginPath();
    for (let a = 0; a < Math.PI * 8; a += 0.05) {
      const r = 4 + a * 4.6;
      const px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
      a === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    }
    x.stroke();
    return new THREE.CanvasTexture(c);
  }
  function lollipop(x, z, c1, c2, s) {
    const g = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 8), MAT(0xffffff));
    stick.position.y = 1.5;
    g.add(stick);
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(1.4 * s, 32),
      new THREE.MeshStandardMaterial({ map: spiralTexture(c1, c2), side: THREE.DoubleSide, roughness: 0.5 })
    );
    face.position.y = 3 + 1.2 * s;
    g.add(face);
    g.position.set(x, 0, z);
    g.userData.face = face;
    scene.add(g);
    lollipops.push(g);
  }
  const lollipops = [];
  lollipop(38, 12, "#d8262c", "#f5d020", 1);
  lollipop(46, 22, "#2fae2f", "#f2f0ea", 0.8);
  lollipop(33, 26, "#7a1fd0", "#ff9ad5", 0.7);

  // signposts with arrows
  function signpost(x, z, rotY) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8), MAT(0x7a4a1e));
    post.position.y = 1.1;
    post.castShadow = true;
    g.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.12), MAT(0x9a6a2e));
    board.position.y = 2;
    g.add(board);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 4), MAT(0xd8262c));
    tip.rotation.z = -Math.PI / 2;
    tip.position.set(0.95, 2, 0);
    g.add(tip);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
  }
  signpost(10, 6, 0.4);
  signpost(-14, -20, -2.2);
  signpost(28, 44, 2.6);

  // red wavy ribbon in the sky (the squiggly platform line from the drawing)
  (function ribbon() {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = -50 + t * 100;
      pts.push(new THREE.Vector3(x, 9 + Math.sin(t * Math.PI * 6) * 0.9, -58 + Math.sin(t * 9) * 1.5));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.35, 8), MAT(0xe8355f));
    scene.add(tube);
  })();

  // ---------- the hero: red-faced treasure hunter king ----------
  function buildHero() {
    const root = new THREE.Group();
    const body = new THREE.Group(); // bobs up/down
    root.add(body);

    const shadowify = m => { m.castShadow = true; return m; };

    // legs (blue), pivoted at the hip so they can swing
    const legGeo = new THREE.CapsuleGeometry(0.14, 0.55, 4, 10);
    const legMat = MAT(0x2f6df6);
    const mkLeg = x => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.95, 0);
      const leg = shadowify(new THREE.Mesh(legGeo, legMat));
      leg.position.y = -0.42;
      pivot.add(leg);
      body.add(pivot);
      return pivot;
    };
    const legL = mkLeg(-0.22), legR = mkLeg(0.22);
    // little shoes
    [legL, legR].forEach(p => {
      const shoe = shadowify(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.45), MAT(0x203040)));
      shoe.position.set(0, -0.82, 0.08);
      p.add(shoe);
    });

    // yellow egg body
    const torso = shadowify(new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 20), MAT(0xf0c92e)));
    torso.scale.set(1, 1.12, 0.82);
    torso.position.y = 1.42;
    body.add(torso);

    // diamond emblem on the chest (blue with red center)
    const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), MAT(0x2f3df0));
    emblem.scale.set(1, 1.15, 0.25);
    emblem.position.set(0, 1.5, 0.47);
    body.add(emblem);
    const emblemCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), MAT(0xd8262c, { emissive: 0x550000 }));
    emblemCore.scale.set(1, 1.15, 0.3);
    emblemCore.position.set(0, 1.5, 0.52);
    body.add(emblemCore);

    // arms (blue), pivoted at shoulders
    const armGeo = new THREE.CapsuleGeometry(0.11, 0.5, 4, 10);
    const mkArm = x => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.78, 0);
      const arm = shadowify(new THREE.Mesh(armGeo, legMat));
      arm.position.y = -0.35;
      pivot.add(arm);
      body.add(pivot);
      return pivot;
    };
    const armL = mkArm(-0.6), armR = mkArm(0.6);
    armL.rotation.z = 0.5;
    armR.rotation.z = -0.5;

    // magic star wand in the right hand
    const wand = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), MAT(0x7a4a1e));
    wand.add(stick);
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.17 : 0.075;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i === 0 ? starShape.moveTo(px, py) : starShape.lineTo(px, py);
    }
    const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.06, bevelEnabled: false });
    const star = new THREE.Mesh(starGeo, MAT(0xffd21f, { emissive: 0x664400, roughness: 0.3, metalness: 0.4 }));
    star.position.set(0, 0.48, -0.03);
    star.rotation.y = 0; // faces forward-ish; it spins in the loop
    wand.add(star);
    wand.position.set(0, -0.75, 0.15);
    wand.rotation.x = -0.5;
    armR.add(wand);

    // head
    const head = new THREE.Group();
    head.position.y = 2.55;
    body.add(head);
    const face = shadowify(new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 22), MAT(0xd8262c)));
    head.add(face);
    // round black ears
    [-1, 1].forEach(s => {
      const ear = shadowify(new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), MAT(0x14100e)));
      ear.scale.z = 0.45;
      ear.position.set(0.44 * s, 0.36, 0);
      head.add(ear);
    });
    // left eye: friendly black oval
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), MAT(0x14100e));
    eyeL.scale.y = 1.5;
    eyeL.position.set(-0.18, 0.1, 0.45);
    head.add(eyeL);
    // right eye: BIG googly eye behind a golden magnifier ring
    const gEye = new THREE.Group();
    gEye.position.set(0.2, 0.1, 0.4);
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14), MAT(0xffffff, { roughness: 0.35 }));
    gEye.add(white);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), MAT(0x7a1fd0));
    iris.position.z = 0.13;
    gEye.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), MAT(0x14100e));
    pupil.position.z = 0.2;
    gEye.add(pupil);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.03, 8, 26), MAT(0xd9a51f, { metalness: 0.6, roughness: 0.35 }));
    ring.position.z = 0.12;
    gEye.add(ring);
    head.add(gEye);
    // smile
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 20, Math.PI), MAT(0x14100e));
    smile.position.set(0, -0.12, 0.42);
    smile.rotation.z = Math.PI;
    head.add(smile);
    // golden crown
    const crown = new THREE.Group();
    crown.position.y = 0.5;
    const band = shadowify(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.18, 12), MAT(0xd9a51f, { metalness: 0.7, roughness: 0.3 })));
    crown.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 6), MAT(0xd9a51f, { metalness: 0.7, roughness: 0.3 }));
      spike.position.set(Math.cos(a) * 0.24, 0.16, Math.sin(a) * 0.24);
      crown.add(spike);
    }
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), MAT(0xd8262c, { emissive: 0x660000 }));
    gem.position.set(0, 0.05, 0.29);
    crown.add(gem);
    head.add(crown);

    return { root, body, head, legL, legR, armL, armR, star, gEye };
  }

  const hero = buildHero();
  scene.add(hero.root);

  // ---------- collectible stars ----------
  const starGeoSmall = (() => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.45 : 0.2;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i === 0 ? s.moveTo(px, py) : s.lineTo(px, py);
    }
    return new THREE.ExtrudeGeometry(s, { depth: 0.15, bevelEnabled: false });
  })();
  const starMat = MAT(0xffd21f, { emissive: 0x775500, roughness: 0.3, metalness: 0.5 });
  const stars = [];
  const starSpots = [
    [-6, -10], [12, -4], [-20, 18], [4, 24], [-34, -14],
    [26, 6], [36, -20], [-44, 34], [16, -34], [-8, 56], [44, 40], [-28, -44]
  ];
  castleCourtyardStars.forEach(p => starSpots.push([p.x, p.z, p.y]));
  starSpots.forEach(([x, z, baseY]) => {
    const m = new THREE.Mesh(starGeoSmall, starMat);
    m.userData.baseY = baseY || 1.2;
    m.position.set(x, m.userData.baseY, z);
    m.castShadow = true;
    scene.add(m);
    stars.push(m);
  });

  // ---------- X marks / dig spots ----------
  function makeX(x, z) {
    const g = new THREE.Group();
    const mat = MAT(0xc03ad0);
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.55), mat.clone());
    b1.rotation.y = Math.PI / 4;
    const b2 = b1.clone();
    b2.rotation.y = -Math.PI / 4;
    g.add(b1, b2);
    g.position.set(x, 0.08, z);
    scene.add(g);
    return { group: g, pos: new THREE.Vector3(x, 0, z), dug: false, mats: [b1.material, b2.material] };
  }
  const digSpots = [
    makeX(-28, -32), makeX(27, -8), makeX(-10, 30),
    makeX(14, 44), makeX(-46, 14), makeX(50, -16)
  ];
  const treasureIndex = Math.floor(Math.random() * digSpots.length);
  const decoyLoot = [
    "Just a wiggly worm! 🪱 Keep looking...",
    "An old boot! 👢 Not treasure...",
    "A shiny rock! 🪨 Pretty, but keep digging!",
    "Whoops — an angry crab! 🦀 Run!",
    "A rusty spoon! 🥄 The treasure is elsewhere..."
  ];

  // ---------- HUD ----------
  const $ = id => document.getElementById(id);
  $("starsTotal").textContent = stars.length + qBlocks.length; // blocks hide one star each
  $("dugTotal").textContent = digSpots.length;
  let starCount = 0, dugCount = 0;
  let missionTimer = null;
  function setMission(text, revertMs) {
    $("mission").textContent = text;
    if (missionTimer) clearTimeout(missionTimer);
    if (revertMs) {
      missionTimer = setTimeout(() => {
        $("mission").textContent = "Your Mission: find the ❌ marks and dig up the hidden treasure!";
      }, revertMs);
    }
  }

  // ---------- sound (tiny WebAudio bleeps) ----------
  let audio = null;
  function ac() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    return audio;
  }
  function beep(freq, dur, type, delay, vol) {
    try {
      const a = ac();
      const t = a.currentTime + (delay || 0);
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur);
    } catch (e) { /* audio blocked — fine */ }
  }
  const sfx = {
    star: () => { beep(880, 0.09); beep(1320, 0.12, "square", 0.07); },
    dig: () => { beep(160, 0.15, "sawtooth"); beep(120, 0.18, "sawtooth", 0.12); },
    decoy: () => { beep(300, 0.15, "triangle"); beep(220, 0.25, "triangle", 0.15); },
    fanfare: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => beep(f, 0.22, "square", i * 0.14, 0.14)),
    jump: () => beep(440, 0.1, "triangle", 0, 0.08)
  };

  // ---------- particles ----------
  const bursts = [];
  function burst(pos, color, count, speed, life) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const vels = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      vels.push(new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.9 + speed * 0.4,
        (Math.random() - 0.5) * speed
      ));
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.28, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    bursts.push({ pts, vels, life, age: 0 });
  }
  function updateBursts(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.age += dt;
      const arr = b.pts.geometry.attributes.position.array;
      for (let j = 0; j < b.vels.length; j++) {
        b.vels[j].y -= 12 * dt;
        arr[j * 3] += b.vels[j].x * dt;
        arr[j * 3 + 1] += b.vels[j].y * dt;
        arr[j * 3 + 2] += b.vels[j].z * dt;
        if (arr[j * 3 + 1] < 0.05) arr[j * 3 + 1] = 0.05;
      }
      b.pts.geometry.attributes.position.needsUpdate = true;
      b.pts.material.opacity = Math.max(0, 1 - b.age / b.life);
      b.pts.material.transparent = true;
      if (b.age > b.life) {
        scene.remove(b.pts);
        b.pts.geometry.dispose();
        b.pts.material.dispose();
        bursts.splice(i, 1);
      }
    }
  }

  // ---------- final boss: the Giant Hand Girl ----------
  const SKIN = 0xf2c9a0;
  function buildGiantHand(mirror) {
    const g = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 16), MAT(SKIN));
    palm.scale.set(1, 1.15, 0.45);
    palm.castShadow = true;
    g.add(palm);
    const fingerGeo = new THREE.CapsuleGeometry(0.17, 0.6, 4, 10);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(fingerGeo, MAT(SKIN));
      f.position.set(-0.55 + i * 0.37, 1.15, 0);
      f.castShadow = true;
      g.add(f);
    }
    const thumb = new THREE.Mesh(fingerGeo, MAT(SKIN));
    thumb.position.set(0.85 * (mirror ? -1 : 1), 0.35, 0);
    thumb.rotation.z = 0.7 * (mirror ? 1 : -1);
    thumb.castShadow = true;
    g.add(thumb);
    g.scale.setScalar(1.7);
    return g;
  }
  function buildBossGirl() {
    const g = new THREE.Group();
    // green-pants legs + rainbow sneakers
    [-1, 1].forEach(s => {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.8, 4, 10), MAT(0x2c8a3d));
      leg.position.set(0.28 * s, 0.75, 0);
      leg.castShadow = true;
      g.add(leg);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.66), MAT(s < 0 ? 0xe8a020 : 0x3fb6e0));
      shoe.position.set(0.28 * s, 0.14, 0.1);
      shoe.castShadow = true;
      g.add(shoe);
    });
    // blue shirt
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.62, 22, 18), MAT(0x2f6df6));
    torso.scale.set(1, 1.2, 0.75);
    torso.position.y = 1.75;
    torso.castShadow = true;
    g.add(torso);
    // shoulder anchors — stretchy sleeves connect these to her giant hands
    const shoulders = [-1, 1].map(s => {
      const anchor = new THREE.Object3D();
      anchor.position.set(0.62 * s, 2.15, 0);
      g.add(anchor);
      return anchor;
    });
    // head
    const head = new THREE.Group();
    head.position.y = 3.05;
    g.add(head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.52, 24, 20), MAT(SKIN));
    face.castShadow = true;
    head.add(face);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.56, 24, 20), MAT(0x241a14));
    hair.position.set(0, 0.1, -0.12);
    head.add(hair);
    const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), MAT(0x241a14));
    bangs.position.set(0, 0.16, 0.06);
    head.add(bangs);
    [-1, 1].forEach(s => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), MAT(0x241a14));
      eye.scale.y = 1.4;
      eye.position.set(0.18 * s, 0.05, 0.47);
      head.add(eye);
    });
    // excited open mouth
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), MAT(0x6b2020));
    mouth.scale.set(1, 1.25, 0.4);
    mouth.position.set(0, -0.2, 0.46);
    head.add(mouth);
    // the cat on her head
    const cat = new THREE.Group();
    cat.position.set(0.05, 0.62, 0.05);
    const catBody = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), MAT(0xe08a30));
    catBody.scale.set(1.25, 0.8, 1);
    cat.add(catBody);
    [-1, 1].forEach(s => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 6), MAT(0xe08a30));
      ear.position.set(0.12 * s, 0.18, 0);
      cat.add(ear);
    });
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.3, 4, 8), MAT(0xe08a30));
    tail.position.set(-0.28, 0.08, -0.05);
    tail.rotation.z = 0.9;
    cat.add(tail);
    [-1, 1].forEach(s => {
      const ce = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), MAT(0x241a14));
      ce.position.set(0.08 * s + 0.12, 0.05, 0.16);
      cat.add(ce);
    });
    head.add(cat);
    g.scale.setScalar(1.55);
    return { group: g, head, cat, shoulders };
  }

  const boss = {
    active: false, defeated: false, hp: 3,
    body: null, hands: [], shadowRing: null,
    attackTimer: 2, handIndex: 0
  };
  function startBossFight(treasurePos) {
    const b = buildBossGirl();
    b.group.position.set(treasurePos.x, 0, treasurePos.z - 6);
    scene.add(b.group);
    boss.body = b;
    [true, false].forEach((mirror, i) => {
      const h = buildGiantHand(mirror);
      const side = i === 0 ? -1 : 1;
      h.position.set(treasurePos.x + side * 6, 5, treasurePos.z - 5);
      scene.add(h);
      // stretchy blue sleeve from her shoulder to this hand
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 1, 12), MAT(0x2f6df6));
      sleeve.castShadow = true;
      scene.add(sleeve);
      boss.hands.push({
        mesh: h, side, state: "idle", t: 0, sleeve,
        shoulder: b.shoulders[i],
        home: h.position.clone(), target: new THREE.Vector3()
      });
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 2.2, 32),
      new THREE.MeshBasicMaterial({ color: 0x201010, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    ring.visible = false;
    scene.add(ring);
    boss.shadowRing = ring;
    boss.active = true;
    boss.hp = 3;
    $("bossPill").style.display = "";
    $("bossHp").textContent = "❤️❤️❤️";
    const digBtn = $("btnDig");
    digBtn.querySelector(".ico").textContent = "⭐";
    digBtn.querySelector(".lbl").textContent = "BONK";
    setMission(isTouch
      ? "😱 The Giant Hand Girl wants the treasure! Dodge her hands, then BONK them when they land!"
      : "😱 The Giant Hand Girl wants the treasure! Dodge her hands, then press E to bonk them when they land!");
    sfx.decoy();
  }
  function bonkHand(hand) {
    boss.hp--;
    $("bossHp").textContent = "❤️".repeat(boss.hp) || "💫";
    player.digging = 0.45; // quick wand-swing pose
    sfx.star();
    beep(200, 0.2, "sawtooth", 0, 0.15);
    burst(hand.mesh.position.clone(), 0xffd21f, 20, 5, 0.9);
    hand.state = "return";
    hand.t = 0;
    if (boss.hp <= 0) {
      boss.active = false;
      boss.defeated = true;
      boss.shadowRing.visible = false;
      boss.hands.forEach(h => { h.state = "idle"; });
      sfx.fanfare();
      setMission("😄 She just wanted to play! The treasure is yours!");
      confettiRain();
      setTimeout(() => {
        won = true;
        $("winStats").textContent =
          `You dug ${dugCount} spot${dugCount === 1 ? "" : "s"}, collected ${starCount} star${starCount === 1 ? "" : "s"}, and beat the Giant Hand Girl!`;
        $("win").style.display = "flex";
        confettiRain();
      }, 2400);
    } else {
      setMission(`Great bonk! ${boss.hp} more to go! 💪`, 2500);
    }
  }
  const _shoulderPos = new THREE.Vector3(), _armDir = new THREE.Vector3(), _armUp = new THREE.Vector3(0, 1, 0);
  function updateSleeves() {
    boss.hands.forEach(h => {
      h.shoulder.getWorldPosition(_shoulderPos);
      _armDir.copy(h.mesh.position).sub(_shoulderPos);
      const len = Math.max(0.001, _armDir.length());
      h.sleeve.position.copy(_shoulderPos).addScaledVector(_armDir, 0.5);
      h.sleeve.quaternion.setFromUnitVectors(_armUp, _armDir.normalize());
      h.sleeve.scale.set(1, len, 1);
    });
  }
  function updateBoss(dt, t) {
    if (!boss.body) return;
    // the girl hovers and wobbles excitedly
    const bg = boss.body.group;
    bg.position.y = 1.6 + Math.sin(t * 2.1) * 0.35;
    bg.rotation.y = Math.atan2(player.pos.x - bg.position.x, player.pos.z - bg.position.z);
    bg.rotation.z = Math.sin(t * 2.6) * 0.06;
    boss.body.cat.rotation.z = Math.sin(t * 3.2) * 0.15;
    if (boss.defeated) {
      bg.rotation.y += Math.sin(t * 4) * 0.15;
      boss.hands.forEach(h => {
        h.mesh.position.lerp(h.home, dt * 2);
        h.mesh.rotation.z = Math.sin(t * 6 + h.side) * 0.4; // happy waving
      });
      updateSleeves();
      return;
    }
    if (!boss.active) return;
    // attack scheduling
    boss.attackTimer -= dt;
    if (boss.attackTimer <= 0) {
      const hand = boss.hands[boss.handIndex % 2];
      boss.handIndex++;
      if (hand.state === "idle") {
        hand.state = "telegraph";
        hand.t = 0;
        hand.target.set(player.pos.x, 0, player.pos.z);
      }
      boss.attackTimer = 4.2;
    }
    boss.hands.forEach(hand => {
      hand.t += dt;
      const m = hand.mesh;
      switch (hand.state) {
        case "idle": {
          const idlePos = hand.home.clone();
          idlePos.y = 5 + Math.sin(t * 1.8 + hand.side) * 0.5;
          m.position.lerp(idlePos, dt * 2.5);
          m.rotation.set(0, 0, Math.sin(t * 1.5 + hand.side) * 0.15);
          break;
        }
        case "telegraph": {
          // hover above the player's marked spot, fingers down
          const hover = hand.target.clone();
          hover.y = 7;
          m.position.lerp(hover, dt * 5);
          m.rotation.x = Math.PI; // palm down
          boss.shadowRing.visible = true;
          boss.shadowRing.position.set(hand.target.x, 0.07, hand.target.z);
          const p = Math.min(1, hand.t / 1.1);
          boss.shadowRing.scale.setScalar(0.4 + p * 0.8);
          if (hand.t > 1.1) { hand.state = "slam"; hand.t = 0; }
          break;
        }
        case "slam": {
          m.position.y = Math.max(1.1, 7 - hand.t * 26);
          if (m.position.y <= 1.1) {
            // impact!
            burst(new THREE.Vector3(m.position.x, 0.5, m.position.z), 0x8a6134, 20, 5, 0.8);
            beep(90, 0.3, "sawtooth", 0, 0.2);
            shake = 0.5;
            const dx = player.pos.x - m.position.x, dz = player.pos.z - m.position.z;
            const dd = Math.hypot(dx, dz);
            if (dd < 2.6) {
              knock.set(dx / (dd || 1) * 14, 0, dz / (dd || 1) * 14);
              setMission("Whoa! Watch out for the giant hands! 🖐️", 2000);
            }
            hand.state = "stunned";
            hand.t = 0;
            boss.shadowRing.visible = false;
          }
          break;
        }
        case "stunned": {
          m.position.y = 1.1 + Math.sin(hand.t * 3) * 0.05;
          m.rotation.x = Math.PI;
          m.rotation.z = Math.sin(hand.t * 20) * 0.04; // trembling — bonk it now!
          if (hand.t > 3.0) { hand.state = "return"; hand.t = 0; }
          break;
        }
        case "return": {
          const back = hand.home.clone();
          back.y = 5;
          m.position.lerp(back, dt * 3);
          m.rotation.x *= (1 - dt * 4);
          if (hand.t > 1.2) { hand.state = "idle"; hand.t = 0; }
          break;
        }
      }
    });
    updateSleeves();
  }
  function nearestStunnedHand() {
    let bestHand = null, best = 3.4;
    for (const h of boss.hands) {
      if (h.state !== "stunned") continue;
      const dd = Math.hypot(player.pos.x - h.mesh.position.x, player.pos.z - h.mesh.position.z);
      if (dd < best) { best = dd; bestHand = h; }
    }
    return bestHand;
  }

  // ---------- treasure chest ----------
  let chest = null;
  function spawnChest(pos) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1.2), MAT(0x8a5a22));
    base.position.y = 0.5;
    base.castShadow = true;
    g.add(base);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 1.3), MAT(0xd9a51f, { metalness: 0.7, roughness: 0.3 }));
    trim.position.y = 0.95;
    g.add(trim);
    const lid = new THREE.Group();
    lid.position.set(0, 1, -0.6);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.2), MAT(0x9a6a2e));
    lidMesh.position.set(0, 0.25, 0.6);
    lidMesh.castShadow = true;
    lid.add(lidMesh);
    g.add(lid);
    const gold = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), MAT(0xffd21f, { emissive: 0xaa7700, roughness: 0.2, metalness: 0.6 }));
    gold.scale.y = 0.5;
    gold.position.y = 1.05;
    g.add(gold);
    const glow = new THREE.PointLight(0xffcc33, 0, 12);
    glow.position.y = 2;
    g.add(glow);
    g.position.copy(pos);
    g.position.y = -1.4;
    scene.add(g);
    chest = { group: g, lid, glow, t: 0 };
  }

  // ---------- input ----------
  const keys = {};
  window.addEventListener("keydown", e => {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyE") tryDig();
  });
  window.addEventListener("keyup", e => { keys[e.code] = false; });

  // touch controls
  const isTouch = IS_TOUCH;
  const joyVec = { x: 0, y: 0 };
  if (isTouch) {
    document.body.classList.add("touch");
    const joy = $("joy"), knob = $("joyKnob");
    let joyId = null;
    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    const joyMove = e => {
      const r = joy.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      const cl = Math.min(len, 46);
      dx = dx / len * cl; dy = dy / len * cl;
      setKnob(dx, dy);
      joyVec.x = dx / 46; joyVec.y = dy / 46;
    };
    joy.addEventListener("pointerdown", e => {
      e.preventDefault();
      joyId = e.pointerId;
      joy.setPointerCapture(joyId);
      joyMove(e); // start steering from the very first touch
    });
    joy.addEventListener("pointermove", e => {
      if (e.pointerId === joyId) joyMove(e);
    });
    const joyEnd = e => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      joyVec.x = joyVec.y = 0;
      setKnob(0, 0);
    };
    joy.addEventListener("pointerup", joyEnd);
    joy.addEventListener("pointercancel", joyEnd);
    const pressable = (btn, onPress) => {
      btn.addEventListener("pointerdown", e => {
        e.preventDefault();
        btn.classList.add("pressed");
        onPress();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach(ev =>
        btn.addEventListener(ev, () => btn.classList.remove("pressed")));
    };
    pressable($("btnJump"), () => { wantJump = true; });
    pressable($("btnDig"), () => tryDig());
    // no long-press menus on the controls
    document.addEventListener("contextmenu", e => {
      if (e.target.closest(".tbtn, #joy")) e.preventDefault();
    });
  }
  // browsers only allow sound after a first tap/click — unlock it then
  window.addEventListener("pointerdown", () => ac(), { once: true });

  // camera orbit: drag anywhere on the world (not the buttons/joystick) to look around
  let camYaw = 0;                 // angle around the player
  let camPitch = 0.55;            // how high the camera sits
  const CAM_DIST = 12.4;
  {
    const canvas = renderer.domElement;
    let dragId = null, lastX = 0, lastY = 0;
    canvas.addEventListener("pointerdown", e => {
      dragId = e.pointerId;
      lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(dragId);
    });
    canvas.addEventListener("pointermove", e => {
      if (e.pointerId !== dragId) return;
      camYaw -= (e.clientX - lastX) * 0.006;
      camPitch = Math.min(1.15, Math.max(0.18, camPitch + (e.clientY - lastY) * 0.004));
      lastX = e.clientX; lastY = e.clientY;
    });
    const dragEnd = e => { if (e.pointerId === dragId) dragId = null; };
    canvas.addEventListener("pointerup", dragEnd);
    canvas.addEventListener("pointercancel", dragEnd);
  }

  // ---------- game state ----------
  const player = {
    pos: new THREE.Vector3(0, 0, 8),
    vel: new THREE.Vector3(),
    vy: 0,
    onGround: true,
    facing: 0,
    digging: 0
  };
  let wantJump = false;
  let won = false;
  let nearSpot = null;
  let shake = 0;
  const knock = new THREE.Vector3();

  function tryDig() {
    ac();
    if (won || player.digging > 0) return;
    // during the boss fight the wand bonks stunned giant hands
    if (boss.active) {
      const hand = nearestStunnedHand();
      if (hand) bonkHand(hand);
      return;
    }
    if (!nearSpot || nearSpot.dug) return;
    const spot = nearSpot;
    player.digging = 0.8;
    sfx.dig();
    burst(new THREE.Vector3(spot.pos.x, 0.4, spot.pos.z), 0x8a6134, 26, 4.5, 0.9);
    setTimeout(() => {
      spot.dug = true;
      spot.mats.forEach(m => m.color.set(0x8f8f8f));
      dugCount++;
      $("dug").textContent = dugCount;
      const isTreasure = digSpots.indexOf(spot) === treasureIndex;
      if (isTreasure) {
        spawnChest(spot.pos);
        sfx.fanfare();
        setMission("💛 TREASURE!!! 💛");
        // ...but the treasure has a guardian!
        setTimeout(() => startBossFight(spot.pos), 2300);
      } else {
        sfx.decoy();
        burst(new THREE.Vector3(spot.pos.x, 0.6, spot.pos.z), 0xffd21f, 10, 3, 0.8);
        setMission(decoyLoot[Math.floor(Math.random() * decoyLoot.length)], 3500);
      }
    }, 550);
  }

  function confettiRain() {
    const colors = [0xd8262c, 0x2f6df6, 0xffd21f, 0x2fae2f, 0xc03ad0];
    for (let i = 0; i < 5; i++) {
      const p = hero.root.position;
      burst(new THREE.Vector3(p.x + (Math.random() - 0.5) * 6, 5 + Math.random() * 3, p.z + (Math.random() - 0.5) * 6),
        colors[i % colors.length], 30, 5, 2.2);
    }
  }
  $("again").addEventListener("click", () => location.reload());

  // small hook for automated testing
  window.__game = { player, digSpots, tryDig: () => tryDig(), treasureIndex, boss };

  // ---------- main loop ----------
  const clock = new THREE.Clock();
  const SPEED = 8.5, GRAVITY = 26, JUMP = 9.5;
  const camTarget = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // input direction (screen-relative: up = away from camera)
    let ix = 0, iz = 0;
    if (keys.KeyW || keys.ArrowUp) iz -= 1;
    if (keys.KeyS || keys.ArrowDown) iz += 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1;
    if (keys.KeyD || keys.ArrowRight) ix += 1;
    ix += joyVec.x; iz += joyVec.y;
    const ilen = Math.hypot(ix, iz);
    if (ilen > 1) { ix /= ilen; iz /= ilen; }

    // keyboard camera turn
    if (keys.KeyZ) camYaw += 2.2 * dt;
    if (keys.KeyC) camYaw -= 2.2 * dt;

    // steer relative to the camera so "up" is always away from it
    const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
    const mx = ix * cy + iz * sy;
    const mz = -ix * sy + iz * cy;

    const moving = ilen > 0.15 && player.digging <= 0 && !won;
    if (moving) {
      player.pos.x += mx * SPEED * dt;
      player.pos.z += mz * SPEED * dt;
      player.facing = Math.atan2(mx, mz);
    }
    // knockback from giant-hand slams
    if (knock.lengthSq() > 0.01) {
      player.pos.x += knock.x * dt;
      player.pos.z += knock.z * dt;
      knock.multiplyScalar(Math.max(0, 1 - dt * 5));
    }
    player.pos.x = Math.max(-WORLD, Math.min(WORLD, player.pos.x));
    player.pos.z = Math.max(-WORLD, Math.min(WORLD, player.pos.z));
    collideWithCastle();

    // jumping + standing on floors/stairs
    if ((keys.Space || wantJump) && player.onGround && player.digging <= 0 && !won) {
      player.vy = JUMP;
      player.onGround = false;
      sfx.jump();
    }
    wantJump = false;
    const gh = groundHeightAt(player.pos.x, player.pos.z, player.pos.y);
    if (player.onGround) {
      if (player.pos.y - gh > 0.6) {
        player.onGround = false; // walked off a ledge
        player.vy = 0;
      } else {
        player.pos.y = gh; // climb or descend steps smoothly
      }
    }
    if (!player.onGround) {
      player.vy -= GRAVITY * dt;
      player.pos.y += player.vy * dt;
      if (player.vy <= 0 && player.pos.y <= gh) {
        player.pos.y = gh;
        player.vy = 0;
        player.onGround = true;
      }
    }
    if (player.digging > 0) player.digging -= dt;

    // rainbow cave teleport
    portalCooldown -= dt;
    // sparkles drifting out of the cave mouths so they're easy to spot
    if (Math.random() < dt * 4) {
      const p = portals[Math.floor(Math.random() * portals.length)].position;
      const rainbow = [0xd8262c, 0xe8a020, 0xffd21f, 0x2fae2f, 0x2f6df6, 0xc03ad0];
      burst(new THREE.Vector3(p.x, 1, p.z), rainbow[Math.floor(Math.random() * rainbow.length)], 3, 2, 1);
    }
    if (portalCooldown <= 0 && !won) {
      for (let i = 0; i < portals.length; i++) {
        const p = portals[i].position;
        if (Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < 3.6) {
          const dest = portals[1 - i].position;
          burst(new THREE.Vector3(p.x, 1.5, p.z), 0x24b6c9, 24, 5, 1);
          // land a few steps in front of the other cave, toward the map middle
          const inward = Math.hypot(dest.x, dest.z) || 1;
          player.pos.set(dest.x - dest.x / inward * 4.5, 0, dest.z - dest.z / inward * 4.5);
          burst(new THREE.Vector3(player.pos.x, 1.5, player.pos.z), 0xd8262c, 24, 5, 1);
          [660, 880, 1100, 1320].forEach((f, j) => beep(f, 0.1, "triangle", j * 0.06, 0.1));
          portalCooldown = 3;
          camSnap = true;
          setMission("🌈 Wheee! The rainbow cave teleported you across the map!", 3500);
          break;
        }
      }
    }

    // hero transform + animation
    hero.root.position.copy(player.pos);
    let targetRot = player.facing;
    let d = targetRot - hero.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    hero.root.rotation.y += d * Math.min(1, dt * 12);

    const runPhase = t * 11;
    if (moving && player.onGround) {
      hero.legL.rotation.x = Math.sin(runPhase) * 0.8;
      hero.legR.rotation.x = -Math.sin(runPhase) * 0.8;
      hero.armL.rotation.x = -Math.sin(runPhase) * 0.6;
      hero.armR.rotation.x = Math.sin(runPhase) * 0.6;
      hero.body.position.y = Math.abs(Math.sin(runPhase)) * 0.08;
    } else if (!player.onGround) {
      hero.legL.rotation.x = 0.5; hero.legR.rotation.x = -0.4;
      hero.armL.rotation.x = -1.6; hero.armR.rotation.x = -1.6;
    } else {
      hero.legL.rotation.x *= 0.8; hero.legR.rotation.x *= 0.8;
      hero.armL.rotation.x *= 0.8; hero.armR.rotation.x *= 0.8;
      hero.body.position.y = Math.sin(t * 2.2) * 0.03;
    }
    if (player.digging > 0) {
      const s = 1 - Math.sin(player.digging * Math.PI / 0.8) * 0.25;
      hero.body.scale.set(1 / s, s, 1 / s);
      hero.armR.rotation.x = -2 + Math.sin(t * 30) * 0.5;
    } else {
      hero.body.scale.set(1, 1, 1);
    }
    hero.star.rotation.y = t * 3;
    hero.head.rotation.y = Math.sin(t * 0.8) * 0.15;

    // camera follow
    camTarget.set(player.pos.x, player.pos.y + 2, player.pos.z);
    const camGoal = new THREE.Vector3(
      player.pos.x + Math.sin(camYaw) * CAM_DIST * Math.cos(camPitch),
      player.pos.y + CAM_DIST * Math.sin(camPitch),
      player.pos.z + Math.cos(camYaw) * CAM_DIST * Math.cos(camPitch)
    );
    if (camSnap) {
      camera.position.copy(camGoal);
      camSnap = false;
    } else {
      camera.position.lerp(camGoal, Math.min(1, dt * 4));
    }
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      shake = Math.max(0, shake - dt * 1.6);
    }
    camera.lookAt(camTarget);

    // sun follows player so shadows stay crisp
    sun.position.set(player.pos.x + 20, 32, player.pos.z + 12);
    sun.target.position.copy(player.pos);

    // spin stars, check pickup
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      s.rotation.y = t * 2 + i;
      s.position.y = s.userData.baseY + Math.sin(t * 2.5 + i) * 0.18;
      const horiz = Math.hypot(s.position.x - player.pos.x, s.position.z - player.pos.z);
      if (!won && horiz < 1.4 && Math.abs(s.position.y - (player.pos.y + 1.2)) < 1.8) {
        sfx.star();
        burst(s.position.clone(), 0xffd21f, 12, 3.2, 0.7);
        scene.remove(s);
        stars.splice(i, 1);
        starCount++;
        $("stars").textContent = starCount;
      }
    }

    // question blocks: bob, and pop a hidden star when bonked from below
    qBlocks.forEach((b, i) => {
      const u = b.userData;
      if (u.pop > 0) u.pop -= dt;
      const bob = u.used ? 0.08 : 0.25;
      b.position.y = u.baseY + Math.sin(t * 1.8 + i * 2) * bob + Math.max(0, u.pop) * 1.6;
      b.rotation.y = u.used ? 0 : t * 0.7 + i;
      if (!u.used && !won) {
        const hd = Math.hypot(player.pos.x - b.position.x, player.pos.z - b.position.z);
        if (hd < 1.5 && !player.onGround && player.vy > 0 && player.pos.y + 3.1 >= b.position.y - 0.8) {
          u.used = true;
          u.pop = 0.35;
          b.material = qMatUsed;
          starCount++;
          $("stars").textContent = starCount;
          sfx.star();
          burst(b.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xffd21f, 16, 4, 0.9);
          setMission("❓ Surprise! A star was hidden in the block! ⭐", 2800);
        }
      }
    });
    lollipops.forEach((l, i) => { l.userData.face.rotation.z = t * (0.8 + i * 0.3); });

    // near a dig spot?
    nearSpot = null;
    let best = 2.6;
    for (const s of digSpots) {
      if (s.dug) continue;
      const dd = s.pos.distanceTo(player.pos);
      if (dd < best) { best = dd; nearSpot = s; }
    }
    if (nearSpot && player.digging <= 0 && !won && !boss.active && !boss.defeated) {
      setMission(isTouch ? "❌ found! Tap DIG to dig here!" : "❌ found! Press E to dig here!");
      nearSpot.mats.forEach(m => m.color.setHSL(0.83, 0.8, 0.5 + Math.sin(t * 6) * 0.2));
    } else if (!won && !boss.active && !boss.defeated && player.digging <= 0 && $("mission").textContent.startsWith("❌")) {
      setMission("Your Mission: find the ❌ marks and dig up the hidden treasure!");
    }

    // walls and roof turn to glass while the player is inside the castle
    const fadeTarget = insideCastle() ? 0.22 : 1;
    if (Math.abs(castleFade.level - fadeTarget) > 0.005) {
      castleFade.level += (fadeTarget - castleFade.level) * Math.min(1, dt * 6);
      castleFade.mats.forEach(m => { m.opacity = castleFade.level; });
    }

    // reaching the throne earns a royal welcome
    if (!castleThrone.visited &&
        Math.hypot(player.pos.x - castleThrone.pos.x, player.pos.z - castleThrone.pos.z) < 2) {
      castleThrone.visited = true;
      sfx.fanfare();
      burst(castleThrone.pos.clone().add(new THREE.Vector3(0, 2, 0)), 0xffd21f, 24, 4, 1.2);
      setMission("👑 Welcome to your castle, Treasure King!", 4000);
    }

    updateBoss(dt, t);

    // chest animation
    if (chest) {
      chest.t += dt;
      if (chest.group.position.y < 0) {
        chest.group.position.y = Math.min(0, -1.4 + chest.t * 1.6);
      } else if (chest.t > 1) {
        chest.lid.rotation.x = Math.max(-1.9, chest.lid.rotation.x - dt * 2.4);
        chest.glow.intensity = Math.min(30, chest.glow.intensity + dt * 40);
        if (Math.random() < 0.3) {
          burst(chest.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 0xffd21f, 6, 4, 1);
        }
      }
    }

    updateBursts(dt);
    renderer.render(scene, camera);
  }
  animate();
})();
