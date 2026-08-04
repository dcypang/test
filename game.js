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

  // rainbow cave portals (the tunnel arches from the drawing)
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
  }
  rainbowPortal(-52, -50, Math.PI / 4);
  rainbowPortal(50, 52, Math.PI + Math.PI / 4);

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
  const qBlocks = [];
  [[6, 3.2, -22], [-16, 3.2, 12], [30, 3.4, -30]].forEach(([x, y, z]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), qMat);
    b.position.set(x, y, z);
    b.castShadow = true;
    b.userData.baseY = y;
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

  // castle on a hill (from the framed picture in the drawing)
  (function castle() {
    const g = new THREE.Group();
    const hill = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 3, 20), MAT(0x35a035));
    hill.position.y = 1.5;
    hill.receiveShadow = true;
    g.add(hill);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), MAT(0xe8d44d));
    wall.position.y = 5;
    wall.castShadow = true;
    g.add(wall);
    [[-4, -3], [4, -3], [-4, 3], [4, 3]].forEach(([tx, tz]) => {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 6.5, 12), MAT(0xcf6ee0));
      tower.position.set(tx, 6, tz);
      tower.castShadow = true;
      g.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.2, 12), MAT(0x7a1fd0));
      roof.position.set(tx, 10.2, tz);
      roof.castShadow = true;
      g.add(roof);
    });
    const door = new THREE.Mesh(new THREE.CircleGeometry(1.2, 16, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x3a2410 }));
    door.position.set(0, 3.05, 3.01);
    g.add(door);
    g.position.set(44, 0, -44);
    scene.add(g);
  })();

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
  starSpots.forEach(([x, z]) => {
    const m = new THREE.Mesh(starGeoSmall, starMat);
    m.position.set(x, 1.2, z);
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
  $("starsTotal").textContent = stars.length;
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
    $("btnJump").addEventListener("pointerdown", e => { e.preventDefault(); wantJump = true; });
    $("btnDig").addEventListener("pointerdown", e => { e.preventDefault(); tryDig(); });
    // no long-press menus on the controls
    document.addEventListener("contextmenu", e => {
      if (e.target.closest(".tbtn, #joy")) e.preventDefault();
    });
  }
  // browsers only allow sound after a first tap/click — unlock it then
  window.addEventListener("pointerdown", () => ac(), { once: true });

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

  function tryDig() {
    ac();
    if (won || player.digging > 0 || !nearSpot || nearSpot.dug) return;
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
        setTimeout(() => {
          if (won) return;
          won = true;
          $("winStats").textContent = `You dug ${dugCount} spot${dugCount === 1 ? "" : "s"} and collected ${starCount} star${starCount === 1 ? "" : "s"}!`;
          $("win").style.display = "flex";
          confettiRain();
        }, 2100);
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
  window.__game = { player, digSpots, tryDig: () => tryDig(), treasureIndex };

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

    const moving = ilen > 0.15 && player.digging <= 0 && !won;
    if (moving) {
      player.pos.x += ix * SPEED * dt;
      player.pos.z += iz * SPEED * dt;
      player.facing = Math.atan2(ix, iz);
    }
    player.pos.x = Math.max(-WORLD, Math.min(WORLD, player.pos.x));
    player.pos.z = Math.max(-WORLD, Math.min(WORLD, player.pos.z));

    // jumping
    if ((keys.Space || wantJump) && player.onGround && player.digging <= 0 && !won) {
      player.vy = JUMP;
      player.onGround = false;
      sfx.jump();
    }
    wantJump = false;
    if (!player.onGround) {
      player.vy -= GRAVITY * dt;
      player.pos.y += player.vy * dt;
      if (player.pos.y <= 0) {
        player.pos.y = 0;
        player.vy = 0;
        player.onGround = true;
      }
    }
    if (player.digging > 0) player.digging -= dt;

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
    const camGoal = new THREE.Vector3(player.pos.x, player.pos.y + 6.5, player.pos.z + 10.5);
    camera.position.lerp(camGoal, Math.min(1, dt * 4));
    camera.lookAt(camTarget);

    // sun follows player so shadows stay crisp
    sun.position.set(player.pos.x + 20, 32, player.pos.z + 12);
    sun.target.position.copy(player.pos);

    // spin stars, check pickup
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      s.rotation.y = t * 2 + i;
      s.position.y = 1.2 + Math.sin(t * 2.5 + i) * 0.18;
      if (!won && s.position.distanceTo(hero.root.position.clone().setY(1.2)) < 1.4) {
        sfx.star();
        burst(s.position.clone(), 0xffd21f, 12, 3.2, 0.7);
        scene.remove(s);
        stars.splice(i, 1);
        starCount++;
        $("stars").textContent = starCount;
      }
    }

    // bob question blocks & lollipops
    qBlocks.forEach((b, i) => {
      b.position.y = b.userData.baseY + Math.sin(t * 1.8 + i * 2) * 0.25;
      b.rotation.y = t * 0.7 + i;
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
    if (nearSpot && player.digging <= 0 && !won) {
      setMission(isTouch ? "❌ found! Tap DIG to dig here!" : "❌ found! Press E to dig here!");
      nearSpot.mats.forEach(m => m.color.setHSL(0.83, 0.8, 0.5 + Math.sin(t * 6) * 0.2));
    } else if (!won && player.digging <= 0 && $("mission").textContent.startsWith("❌")) {
      setMission("Your Mission: find the ❌ marks and dig up the hidden treasure!");
    }

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
