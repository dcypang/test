/* Find the Hidden Treasure — a voxel 3D web game starring the red-faced
   treasure hunter king. Everything is built from blocks: a procedural
   pixel-art texture atlas, instanced cubes, and a blocky cast. */
(function () {
  "use strict";

  // ---------- renderer ----------
  const IS_TOUCH = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  const container = document.getElementById("game");
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  // phones already antialias via MSAA; capping the ratio keeps the fill rate sane
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (THREE.SRGBColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  container.appendChild(renderer.domElement);
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

  const SKY_HORIZON = 0xa8d0f2; // matches the sky dome's horizon band exactly
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_HORIZON, 75, 170);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 8, 12);

  function fitCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.fov = aspect < 0.8 ? 70 : 58;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  fitCamera();
  window.addEventListener("resize", fitCamera);
  window.addEventListener("orientationchange", () => setTimeout(fitCamera, 250));

  // gradient sky dome — a flat background colour is what makes voxel scenes
  // look cheap, so the horizon fades up into a deeper blue
  {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, "#2f6fc8");
    grad.addColorStop(0.38, "#4f93dd");
    grad.addColorStop(0.62, "#84bbee");
    grad.addColorStop(0.82, "#a8d0f2");
    grad.addColorStop(1.0, "#c2ddf6");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(260, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    dome.renderOrder = -1;
    scene.add(dome);
    scene.userData.skyDome = dome;
  }

  // Lighting: most of the block shading is baked per face (see blockGeo), so the
  // lights stay soft and mainly carry sun warmth, sky fill and shadows.
  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  scene.add(new THREE.HemisphereLight(0xbcdcf7, 0x5a6b3f, 0.38));
  const sun = new THREE.DirectionalLight(0xfff1cf, 0.85);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
  sun.shadow.camera.left = -32; sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // ---------- procedural 16x16 pixel-art texture atlas ----------
  // Each tile gets an 8px gutter of edge-repeat above and below so mipmapping
  // (which kills distant shimmer) can't bleed one tile into its neighbour.
  const TILE = 16, PAD = 8, CELL = TILE + PAD * 2, ATLAS_TILES = 64;
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = TILE;
  atlasCanvas.height = CELL * ATLAS_TILES;
  const ax = atlasCanvas.getContext("2d");
  ax.imageSmoothingEnabled = false;
  let tileCount = 0;
  const T = {}; // name -> tile index

  // deterministic noise, so the art is the same on every load
  let seed = 1337;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  const pick = arr => arr[(rnd() * arr.length) | 0];

  function px(x, y, color) { ax.fillStyle = color; ax.fillRect(x, y, 1, 1); }
  function fillTile(oy, color) { ax.fillStyle = color; ax.fillRect(0, oy, TILE, TILE); }

  // soft clustered grain: picks shades in 1-2px clumps rather than per-pixel
  // static, which is what made the first pass look like TV snow
  function grain(oy, shades, density, clump) {
    const c = clump || 2;
    for (let y = 0; y < TILE; y += 1) {
      for (let x = 0; x < TILE; x += 1) {
        if (rnd() < density) {
          const shade = pick(shades);
          const w = 1 + ((rnd() * c) | 0), h = 1 + ((rnd() * c) | 0);
          ax.fillStyle = shade;
          ax.fillRect(x, oy + y, Math.min(w, TILE - x), Math.min(h, TILE - y));
        }
      }
    }
  }

  function tile(name, draw) {
    const i = tileCount++;
    const oy = i * CELL + PAD;
    draw(oy);
    // fill the gutters with the tile's edge rows
    const img = ax.getImageData(0, oy, TILE, 1);
    const imgB = ax.getImageData(0, oy + TILE - 1, TILE, 1);
    for (let p = 1; p <= PAD; p++) {
      ax.putImageData(img, 0, oy - p);
      ax.putImageData(imgB, 0, oy + TILE - 1 + p);
    }
    T[name] = i;
    return i;
  }

  // --- terrain ---
  tile("grass_top", oy => {
    fillTile(oy, "#6aa740");
    grain(oy, ["#5f9a38", "#74b249", "#568e32", "#7cba50"], 0.3, 3);
    grain(oy, ["#4f8a2e"], 0.06, 2);
  });
  tile("grass_side", oy => {
    fillTile(oy, "#8a6136");
    grain(oy, ["#7d5730", "#966c3e", "#714d29"], 0.28, 3);
    // grassy fringe hanging over the dirt, with a ragged lower edge
    ax.fillStyle = "#6aa740"; ax.fillRect(0, oy, TILE, 3);
    for (let x = 0; x < TILE; x++) {
      const drop = (rnd() * 3) | 0;
      ax.fillStyle = pick(["#6aa740", "#5f9a38", "#74b249"]);
      ax.fillRect(x, oy + 3, 1, drop);
    }
  });
  tile("dirt", oy => {
    fillTile(oy, "#8a6136");
    grain(oy, ["#7d5730", "#966c3e", "#714d29", "#a17a49"], 0.32, 3);
  });
  tile("sand", oy => {
    fillTile(oy, "#e2d29a");
    grain(oy, ["#d8c68b", "#ecdfab", "#cdba7f"], 0.28, 3);
  });
  tile("snow", oy => {
    fillTile(oy, "#f4f7fa");
    grain(oy, ["#e8edf4", "#ffffff", "#dde5ef"], 0.22, 3);
  });
  tile("water", oy => {
    fillTile(oy, "#3070cf");
    grain(oy, ["#3b7cdd", "#2a63bb", "#4a8ae8"], 0.3, 4);
    // a couple of lighter ripple streaks
    ax.fillStyle = "#5b9bf0";
    ax.fillRect(2, oy + 4, 5, 1); ax.fillRect(9, oy + 10, 4, 1);
  });

  // --- stone family ---
  tile("cobble", oy => {
    fillTile(oy, "#79797a"); // mortar
    const stones = [[0, 0, 7, 5], [8, 0, 8, 7], [0, 6, 5, 5], [6, 8, 5, 4],
                    [12, 8, 4, 5], [0, 12, 6, 4], [7, 13, 4, 3], [12, 14, 4, 2]];
    stones.forEach(([sx, sy, sw, sh]) => {
      ax.fillStyle = pick(["#b0b0b1", "#bcbcbd", "#a5a5a6"]);
      ax.fillRect(sx, oy + sy, sw - 1, sh - 1);
      ax.fillStyle = "#cacacb"; ax.fillRect(sx, oy + sy, sw - 1, 1);          // lit top
      ax.fillStyle = "#8e8e8f"; ax.fillRect(sx, oy + sy + sh - 2, sw - 1, 1); // shaded base
    });
  });
  tile("stonebrick", oy => {
    fillTile(oy, "#84817b"); // mortar
    const brick = (bx, by, bw, bh) => {
      ax.fillStyle = pick(["#bcb9b1", "#b3b0a8", "#c3c0b8"]);
      ax.fillRect(bx, oy + by, bw, bh);
      ax.fillStyle = "#cecbc3"; ax.fillRect(bx, oy + by, bw, 1);
      ax.fillStyle = "#a09d96"; ax.fillRect(bx, oy + by + bh - 1, bw, 1);
    };
    brick(0, 0, 7, 7); brick(8, 0, 8, 7);
    brick(0, 8, 3, 7); brick(4, 8, 7, 7); brick(12, 8, 4, 7);
  });
  tile("stone_dark", oy => {
    fillTile(oy, "#77746f");
    ax.fillStyle = "#9c9993"; ax.fillRect(0, oy, TILE, 7);
    ax.fillStyle = "#928f8a"; ax.fillRect(0, oy + 8, TILE, 7);
    ax.fillStyle = "#aeaba5"; ax.fillRect(0, oy, TILE, 1); ax.fillRect(0, oy + 8, TILE, 1);
    grain(oy, ["#8a8782", "#a4a19b"], 0.12, 2);
  });
  tile("obsidian", oy => {
    fillTile(oy, "#1b1226");
    grain(oy, ["#241a33", "#150e1e"], 0.3, 3);
    ax.fillStyle = "#5a3f80"; px(4, oy + 4, "#5a3f80"); px(11, oy + 9, "#5a3f80"); px(7, oy + 13, "#4a3568");
  });

  // --- wood & leaves ---
  tile("log_side", oy => {
    fillTile(oy, "#70502c");
    for (let x = 0; x < TILE; x++) {
      const shade = pick(["#7a5832", "#684a28", "#815f38", "#5f4423"]);
      ax.fillStyle = shade;
      ax.fillRect(x, oy, 1, TILE);
      if (rnd() < 0.35) { ax.fillStyle = "#553a1e"; ax.fillRect(x, oy + ((rnd() * 12) | 0), 1, 2 + ((rnd() * 3) | 0)); }
    }
  });
  tile("log_top", oy => {
    fillTile(oy, "#a5763f");
    grain(oy, ["#b0814a", "#9a6c38"], 0.2, 2);
    ax.strokeStyle = "#70502c"; ax.lineWidth = 1;
    ax.strokeRect(2.5, oy + 2.5, 11, 11);
    ax.strokeRect(5.5, oy + 5.5, 5, 5);
    px(8, oy + 8, "#70502c");
  });
  tile("leaves", oy => {
    fillTile(oy, "#357f2c");
    // clustered leaf blobs rather than static
    for (let i = 0; i < 26; i++) {
      const bx = (rnd() * TILE) | 0, by = (rnd() * TILE) | 0;
      ax.fillStyle = pick(["#3f9134", "#2c6d24", "#4aa33d", "#245c1e"]);
      ax.fillRect(bx, oy + by, 2, 2);
    }
    // a few dark gaps so it reads as foliage, not a solid slab
    for (let i = 0; i < 5; i++) px((rnd() * TILE) | 0, oy + ((rnd() * TILE) | 0), "#1b4718");
  });
  tile("leaves_snow", oy => {
    fillTile(oy, "#e7eff0");
    for (let i = 0; i < 22; i++) {
      const bx = (rnd() * TILE) | 0, by = (rnd() * TILE) | 0;
      ax.fillStyle = pick(["#f3f8f9", "#d3dfe1", "#cfe0d2"]);
      ax.fillRect(bx, oy + by, 2, 2);
    }
    for (let i = 0; i < 6; i++) px((rnd() * TILE) | 0, oy + ((rnd() * TILE) | 0), "#3f9134");
  });
  tile("planks", oy => {
    fillTile(oy, "#b58a4e");
    for (let row = 0; row < 3; row++) {
      const y0 = row * 5.5;
      ax.fillStyle = pick(["#b98e52", "#ac8248", "#c1975a"]);
      ax.fillRect(0, oy + y0, TILE, 5);
      ax.fillStyle = "#c9a066"; ax.fillRect(0, oy + y0, TILE, 1);
      ax.fillStyle = "#8a6636"; ax.fillRect(0, oy + y0 + 4, TILE, 1);
      for (let i = 0; i < 3; i++) {
        ax.fillStyle = "#9d7440";
        ax.fillRect((rnd() * TILE) | 0, oy + y0 + 1 + ((rnd() * 3) | 0), 2 + ((rnd() * 3) | 0), 1);
      }
    }
  });

  // --- treasure & special ---
  tile("gold", oy => {
    fillTile(oy, "#f0c73c"); grain(oy, ["#ffdf5e", "#d9ad2a", "#ffe98a"], 0.5);
    ax.fillStyle = "#c99a1e"; ax.fillRect(0, oy, TILE, 1); ax.fillRect(0, oy + 15, TILE, 1);
  });
  tile("diamond", oy => {
    fillTile(oy, "#2f5be0"); grain(oy, ["#4a78f5", "#2449bb"], 0.4);
    ax.fillStyle = "#9fc4ff";
    [[7, 4], [8, 4], [6, 5], [9, 5], [7, 6], [8, 6]].forEach(([x, y]) => ax.fillRect(x, oy + y, 1, 1));
    ax.fillStyle = "#d8262c"; ax.fillRect(7, oy + 9, 2, 2);
  });
  tile("question", oy => {
    fillTile(oy, "#e8b520"); grain(oy, ["#f2c33a", "#d4a316"], 0.3);
    ax.fillStyle = "#8a6300"; ax.fillRect(0, oy, TILE, 1); ax.fillRect(0, oy + 15, TILE, 1);
    ax.fillRect(0, oy, 1, TILE); ax.fillRect(15, oy, 1, TILE);
    ax.fillStyle = "#6b4a00";
    const q = ["..####..", ".#....#.", "......#.", "....##..", "...#....", "........", "...#....", "...#...."];
    q.forEach((row, ry) => row.split("").forEach((c, cx) => { if (c === "#") ax.fillRect(4 + cx, oy + 3 + ry, 1, 1); }));
  });
  tile("question_used", oy => {
    fillTile(oy, "#9a8a5a"); grain(oy, ["#a8975f", "#8b7c50"], 0.4);
    ax.fillStyle = "#6b5f3a"; ax.fillRect(0, oy, TILE, 1); ax.fillRect(0, oy + 15, TILE, 1);
    ax.fillRect(0, oy, 1, TILE); ax.fillRect(15, oy, 1, TILE);
  });
  tile("chest_side", oy => {
    fillTile(oy, "#9a6a2e"); grain(oy, ["#a87838", "#8a5e28"], 0.35);
    ax.fillStyle = "#5e3f18"; ax.fillRect(0, oy + 4, TILE, 1); ax.fillRect(0, oy, TILE, 1); ax.fillRect(0, oy + 15, TILE, 1);
  });
  tile("chest_front", oy => {
    fillTile(oy, "#9a6a2e"); grain(oy, ["#a87838", "#8a5e28"], 0.35);
    ax.fillStyle = "#5e3f18"; ax.fillRect(0, oy + 4, TILE, 1); ax.fillRect(0, oy, TILE, 1); ax.fillRect(0, oy + 15, TILE, 1);
    ax.fillStyle = "#d9c04a"; ax.fillRect(7, oy + 3, 2, 4);
    ax.fillStyle = "#4a3a10"; ax.fillRect(7, oy + 4, 2, 1);
  });
  tile("chest_top", oy => {
    fillTile(oy, "#a87838"); grain(oy, ["#b6844a", "#96682e"], 0.35);
    ax.fillStyle = "#5e3f18"; ax.strokeRect(0.5, oy + 0.5, 15, 15);
    ax.fillRect(0, oy, TILE, 1);
  });

  // --- wool / cloth colours ---
  function wool(name, base, shades) {
    tile(name, oy => { fillTile(oy, base); grain(oy, shades, 0.35); });
  }
  wool("wool_red", "#c8302c", ["#d6403a", "#ad2724"]);
  wool("wool_purple", "#7a2fc0", ["#8b40d0", "#6726a5"]);
  wool("wool_magenta", "#c03ad0", ["#cf4ade", "#a52fb4"]);
  wool("wool_blue", "#2f6df6", ["#4380ff", "#2559d0"]);
  wool("wool_yellow", "#f0c93c", ["#ffd955", "#d4ae2a"]);
  wool("wool_green", "#3aa03a", ["#48b448", "#2f8a2f"]);
  wool("wool_white", "#f4f4f4", ["#ffffff", "#e2e2e2"]);
  wool("wool_black", "#191316", ["#241c20", "#0f0b0d"]);
  wool("wool_orange", "#e08a30", ["#f09a3e", "#c67626"]);
  wool("wool_cyan", "#24b6c9", ["#33c7da", "#1d9aab"]);
  wool("wool_brown", "#7a4a1e", ["#8a5726", "#673d18"]);

  // --- characters ---
  tile("skin", oy => { fillTile(oy, "#f0c39a"); grain(oy, ["#f7cca6", "#e2b189"], 0.3); });
  tile("hair", oy => { fillTile(oy, "#2a1d15"); grain(oy, ["#38271c", "#1f1510"], 0.4); });
  tile("red_face", oy => { fillTile(oy, "#d8262c"); grain(oy, ["#e4373c", "#c01f25"], 0.3); });
  tile("red_face_front", oy => {
    fillTile(oy, "#d8262c"); grain(oy, ["#e4373c", "#c01f25"], 0.22);
    // small friendly eye (left)
    ax.fillStyle = "#141014"; ax.fillRect(2, oy + 4, 3, 4);
    ax.fillStyle = "#ffffff"; ax.fillRect(2, oy + 4, 1, 1);
    // the big googly eye behind its golden magnifier ring
    ax.fillStyle = "#c8991c"; ax.fillRect(7, oy + 2, 8, 8);           // ring
    ax.fillStyle = "#e8c840"; ax.fillRect(8, oy + 3, 6, 6);           // ring highlight
    ax.fillStyle = "#ffffff"; ax.fillRect(8, oy + 3, 6, 6);           // eye white
    ax.fillStyle = "#e6e6ee"; ax.fillRect(8, oy + 7, 6, 2);           // lower shading
    ax.fillStyle = "#7a1fd0"; ax.fillRect(9, oy + 4, 4, 4);           // iris
    ax.fillStyle = "#141014"; ax.fillRect(10, oy + 5, 2, 2);          // pupil
    ax.fillStyle = "#ffffff"; ax.fillRect(10, oy + 5, 1, 1);          // glint
    ax.fillStyle = "#c8991c";                                          // ring outline
    ax.fillRect(7, oy + 2, 8, 1); ax.fillRect(7, oy + 9, 8, 1);
    ax.fillRect(7, oy + 2, 1, 8); ax.fillRect(14, oy + 2, 1, 8);
    // smile
    ax.fillStyle = "#141014";
    ax.fillRect(3, oy + 11, 1, 1); ax.fillRect(4, oy + 12, 6, 1); ax.fillRect(10, oy + 11, 1, 1);
  });
  tile("girl_face", oy => {
    fillTile(oy, "#f0c39a"); grain(oy, ["#f7cca6", "#e2b189"], 0.25);
    ax.fillStyle = "#2a1d15"; ax.fillRect(0, oy, TILE, 4); // fringe
    ax.fillStyle = "#141014"; ax.fillRect(4, oy + 6, 2, 2); ax.fillRect(10, oy + 6, 2, 2);
    ax.fillStyle = "#7a2020"; ax.fillRect(6, oy + 10, 4, 3); // open mouth
  });
  tile("cat_face", oy => {
    fillTile(oy, "#e08a30"); grain(oy, ["#f09a3e", "#c67626"], 0.3);
    ax.fillStyle = "#141014"; ax.fillRect(3, oy + 6, 2, 2); ax.fillRect(11, oy + 6, 2, 2);
    ax.fillStyle = "#a85a1a"; ax.fillRect(7, oy + 9, 2, 2);
  });
  tile("shirt_blue", oy => {
    fillTile(oy, "#2f6df6"); grain(oy, ["#4380ff", "#2559d0"], 0.3);
  });
  tile("belly", oy => {
    fillTile(oy, "#f0c93c"); grain(oy, ["#ffd955", "#d4ae2a"], 0.3);
  });
  tile("belly_front", oy => {
    fillTile(oy, "#f0c93c"); grain(oy, ["#ffd955", "#d4ae2a"], 0.25);
    // blue diamond emblem with a red core (widest through the middle row)
    ax.fillStyle = "#2f3df0";
    for (let i = 0; i <= 4; i++) {
      const w = 1 + i * 2, x0 = 7 - i;
      ax.fillRect(x0, oy + 3 + i, w, 1);
      ax.fillRect(x0, oy + 11 - i, w, 1);
    }
    ax.fillStyle = "#d8262c"; ax.fillRect(6, oy + 6, 3, 3);
  });
  tile("carpet", oy => {
    fillTile(oy, "#b52b32"); grain(oy, ["#c53a41", "#9e2229"], 0.35);
    ax.fillStyle = "#e0c04a"; ax.fillRect(0, oy, 1, TILE); ax.fillRect(15, oy, 1, TILE);
  });
  tile("portal", oy => {
    fillTile(oy, "#b04ae0"); grain(oy, ["#d06afa", "#8a2fbc", "#e79aff", "#6a1fa0"], 0.8);
  });
  tile("glow_star", oy => {
    fillTile(oy, "#ffd21f"); grain(oy, ["#fff08a", "#e8b800"], 0.4);
    ax.fillStyle = "#fff6c0"; ax.fillRect(6, oy + 6, 4, 4);
  });

  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.magFilter = THREE.NearestFilter;              // crisp pixels up close
  atlas.minFilter = THREE.LinearMipmapLinearFilter;   // no shimmer far away
  atlas.generateMipmaps = true;
  atlas.anisotropy = MAX_ANISO;
  if (THREE.SRGBColorSpace !== undefined) atlas.colorSpace = THREE.SRGBColorSpace;

  const blockMaterial = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });
  const blockMaterialCutout = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, transparent: true, opacity: 1 });

  // Minecraft's signature look: each face of a cube carries a fixed brightness
  // (top brightest, sides mid, bottom dark) baked into vertex colours, so cubes
  // read as solid volumes instead of flatly-lit blobs.
  const FACE_SHADE = [0.66, 0.66, 1.0, 0.46, 0.84, 0.84]; // +x, -x, +y, -y, +z, -z
  function bakeFaceShading(geo) {
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let f = 0; f < 6; f++) {
      const s = FACE_SHADE[f];
      for (let v = 0; v < 4; v++) {
        const i = (f * 4 + v) * 3;
        colors[i] = colors[i + 1] = colors[i + 2] = s;
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  // map a box face's UVs onto one atlas cell
  function faceUV(geo, faceTiles) {
    const uv = geo.attributes.uv;
    const H = atlasCanvas.height;
    for (let f = 0; f < 6; f++) {
      const t = faceTiles[f];
      const top = t * CELL + PAD;
      const vMin = 1 - (top + TILE) / H, vMax = 1 - top / H;
      for (let v = 0; v < 4; v++) {
        const idx = f * 4 + v;
        uv.setY(idx, vMin + uv.getY(idx) * (vMax - vMin));
      }
    }
    uv.needsUpdate = true;
  }

  // ---------- block geometry: one BoxGeometry per (top, side, bottom) combo ----------
  const geoCache = new Map();
  function blockGeo(top, side, bottom) {
    const key = top + "|" + side + "|" + bottom;
    if (geoCache.has(key)) return geoCache.get(key);
    const g = new THREE.BoxGeometry(1, 1, 1);
    // BoxGeometry face order: +x, -x, +y(top), -y(bottom), +z, -z — 4 verts each
    faceUV(g, [side, side, top, bottom, side, side]);
    bakeFaceShading(g);
    geoCache.set(key, g);
    return g;
  }
  // convenience: a block with the same texture everywhere
  const soloGeo = name => blockGeo(T[name], T[name], T[name]);

  // ---------- instanced block batches ----------
  const batches = new Map();
  const _m4 = new THREE.Matrix4();
  function addBlock(geo, x, y, z, opts) {
    const key = geo.uuid + (opts && opts.mat ? "|" + opts.mat : "");
    let b = batches.get(key);
    if (!b) { b = { geo, mats: [], mat: (opts && opts.mat) || "solid" }; batches.set(key, b); }
    b.mats.push([x, y, z]);
  }
  function buildBatches() {
    batches.forEach(b => {
      const mesh = new THREE.InstancedMesh(
        b.geo, b.mat === "solid" ? blockMaterial : blockMaterialCutout, b.mats.length
      );
      b.mats.forEach((p, i) => {
        _m4.makeTranslation(p[0], p[1], p[2]);
        mesh.setMatrixAt(i, _m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = b.mat !== "ground";
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      b.mesh = mesh;
    });
  }
  // a single standalone block (for things that move or change)
  function singleBlock(geo, x, y, z, matOverride) {
    const m = new THREE.Mesh(geo, matOverride || blockMaterial.clone());
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  // fill an inclusive-exclusive box of blocks
  function fillBlocks(geo, x0, x1, y0, y1, z0, z1) {
    for (let x = x0; x < x1; x++)
      for (let y = y0; y < y1; y++)
        for (let z = z0; z < z1; z++)
          addBlock(geo, x + 0.5, y + 0.5, z + 0.5);
  }

  // ---------- world ----------
  const WORLD = 70;
  const COBBLE = soloGeo("cobble");
  const STONEBRICK = soloGeo("stonebrick");
  const STONE_DARK = soloGeo("stone_dark");
  const OBSIDIAN = soloGeo("obsidian");
  const LOG = blockGeo(T.log_top, T.log_side, T.log_top);
  const LEAVES = soloGeo("leaves");
  const LEAVES_SNOW = soloGeo("leaves_snow");
  const PLANKS = soloGeo("planks");
  const GOLD = soloGeo("gold");
  const CARPET = soloGeo("carpet");
  const PORTAL_G = soloGeo("portal");

  const lakeDiscs = [[-46, -40, 6], [-38, -34, 7], [-44, -28, 5.5], [-33, -41, 5], [-36, -25, 4.5]];
  function isWater(x, z) {
    return lakeDiscs.some(([cx, cz, r]) => (x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r);
  }

  // Flat ground is drawn as tiled planes rather than ~23k cubes: with one
  // texture tile per world block it is pixel-identical from above, and it keeps
  // the frame rate high on phones. Everything with height is a real block.
  function tileTexture(tileName) {
    const c = document.createElement("canvas");
    c.width = c.height = TILE;
    c.getContext("2d").drawImage(atlasCanvas, 0, T[tileName] * CELL + PAD, TILE, TILE, 0, 0, TILE, TILE);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = MAX_ANISO;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function groundPlane(tileName, w, d, x, z, y) {
    const tex = tileTexture(tileName);
    tex.repeat.set(w, d); // one texture tile per world block
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  // stacked in painter order, a hair apart so they never z-fight
  groundPlane("grass_top", 640, 640, 0, 0, 0);
  groundPlane("dirt", 72, 46, -34, 47, 0.004);
  groundPlane("sand", 38, 34, -40, -34, 0.006);          // lake shore
  groundPlane("snow", 600, 640, 19 + 300, 0, 0.008);
  groundPlane("sand", 640, 580, 0, 61 + 290, 0.01);      // sandy path along the south

  // drifting blocky clouds overhead — a signature part of the look
  const clouds = (() => {
    const cells = [];
    for (let i = 0; i < 26; i++) {
      const cx = (rnd() * 460 - 230) | 0, cz = (rnd() * 460 - 230) | 0;
      const w = 4 + ((rnd() * 6) | 0), d = 3 + ((rnd() * 5) | 0);
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
        if (rnd() < 0.22) continue; // ragged edges
        cells.push([cx + x * 6, cz + z * 6]);
      }
    }
    const geo = new THREE.BoxGeometry(6, 2.5, 6);
    bakeFaceShading(geo);
    const mesh = new THREE.InstancedMesh(
      geo,
      // unlit so they stay bright white; the baked face shading still gives them form
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.85, fog: false }),
      cells.length
    );
    cells.forEach(([x, z], i) => {
      _m4.makeTranslation(x, 62, z);
      mesh.setMatrixAt(i, _m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  })();

  // the lake itself: one flat water quad per block, in the drawing's blobby shape
  {
    const waterTex = tileTexture("water");
    const waterGeo = new THREE.PlaneGeometry(1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const cells = [];
    for (let x = -60; x < -20; x++) for (let z = -52; z < -16; z++) if (isWater(x, z)) cells.push([x, z]);
    const mesh = new THREE.InstancedMesh(
      waterGeo, new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.85 }), cells.length
    );
    cells.forEach(([x, z], i) => {
      _m4.makeTranslation(x + 0.5, 0.05, z + 0.5);
      mesh.setMatrixAt(i, _m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // trees: log trunk + leaf canopy
  function tree(bx, bz, snowy) {
    const h = 4 + ((Math.abs(bx * 31 + bz * 17)) % 2);
    for (let y = 0; y < h; y++) addBlock(LOG, bx + 0.5, y + 0.5, bz + 0.5);
    const lv = snowy ? LEAVES_SNOW : LEAVES;
    for (let dy = 0; dy < 3; dy++) {
      const r = dy === 0 ? 2 : dy === 1 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && r === 2) continue; // clipped corners
        if (dy === 0 && dx === 0 && dz === 0) continue;
        addBlock(lv, bx + dx + 0.5, h - 1 + dy + 0.5, bz + dz + 0.5);
      }
    }
    addBlock(lv, bx + 0.5, h + 2 + 0.5, bz + 0.5);
  }
  [[-12, -12], [-24, 4], [14, 16], [-52, 20], [-20, -48], [8, -40], [-4, 44], [-55, 40], [18, 55],
   [-40, 8], [2, -55], [-64, -8], [26, 62], [-30, 60]].forEach(p => tree(p[0], p[1], false));
  // (keep the approach to the castle gate clear)
  [[30, -8], [55, 8], [45, 30], [66, -20], [30, 44], [60, 40]].forEach(p => tree(p[0], p[1], true));

  // rainbow cave portals — obsidian frame around a glowing portal
  const portals = [];
  function rainbowPortal(bx, bz) {
    // concentric rainbow arches, like the cave mouths in the drawing
    const rainbow = ["wool_red", "wool_orange", "wool_yellow", "wool_green", "wool_cyan", "wool_purple"];
    for (let ring = 0; ring < 3; ring++) {
      const halfW = 3 + ring, top = 5 + ring;
      const geo = soloGeo(rainbow[(ring * 2) % rainbow.length]);
      const geo2 = soloGeo(rainbow[(ring * 2 + 1) % rainbow.length]);
      for (let y = 0; y <= top; y++) {
        [-halfW, halfW].forEach(dx => addBlock(y > top - 2 ? geo2 : geo, bx + dx + 0.5, y + 0.5, bz + 0.5));
      }
      for (let dx = -halfW + 1; dx <= halfW - 1; dx++) {
        addBlock(geo2, bx + dx + 0.5, top + 0.5, bz + 0.5);
      }
    }
    // the glowing gateway itself
    for (let y = 0; y < 5; y++) for (let dx = -2; dx <= 2; dx++) {
      addBlock(PORTAL_G, bx + dx + 0.5, y + 0.5, bz + 0.5, { mat: "portal" });
    }
    for (let dx = -2; dx <= 2; dx++) addBlock(OBSIDIAN, bx + dx + 0.5, 0.5, bz + 0.5 - 1);
    const p = new THREE.Vector3(bx + 0.5, 0, bz + 0.5);
    portals.push(p);
    return p;
  }
  rainbowPortal(-52, -50);
  rainbowPortal(50, 52);
  let portalCooldown = 0;
  let camSnap = false;

  // candy lollipops in the snow (blocky mushrooms of wool)
  function lollipop(bx, bz, c1, c2) {
    for (let y = 0; y < 4; y++) addBlock(soloGeo("wool_white"), bx + 0.5, y + 0.5, bz + 0.5);
    const g1 = soloGeo(c1), g2 = soloGeo(c2);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      addBlock(ring % 2 ? g1 : g2, bx + dx + 0.5, 4.5, bz + dz + 0.5);
    }
  }
  lollipop(38, 12, "wool_red", "wool_white");
  lollipop(46, 22, "wool_green", "wool_white");
  lollipop(33, 26, "wool_purple", "wool_magenta");

  // signposts
  // a post with an upright board, not a tabletop
  function signpost(bx, bz) {
    addBlock(LOG, bx + 0.5, 0.5, bz + 0.5);
    addBlock(LOG, bx + 0.5, 1.5, bz + 0.5);
    for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy < 2; dy++) {
      addBlock(PLANKS, bx + dx + 0.5, 2.5 + dy, bz + 0.5);
    }
    // a red arrow-tip block pointing onward
    addBlock(soloGeo("wool_red"), bx + 2.5, 3.5, bz + 0.5);
  }
  signpost(10, 6); signpost(-14, -20); signpost(28, 44);

  // ---------- castle: axis-aligned so it lines up with the block grid ----------
  const CX = 44, CZ = -44;                    // castle centre in world blocks
  const castleThrone = { pos: new THREE.Vector3(), visited: false };
  const castleStars = [];
  const castlePlatforms = [];
  const castleArrows = [];
  const castleFade = { meshes: [], level: 1 };
  const castleCollider = { cx: CX, cz: CZ, cos: 1, sin: 0, boxes: [], circles: [] };

  const W = 40, D = 30, H = 10, GATE = 6, FLOOR2 = 5, ROOF = 10, TR = 3;
  (function castle() {
    const wallB = (x0, x1, y0, y1, z0, z1, geo) => {
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++)
        addBlock(geo || STONEBRICK, CX + x + 0.5, y + 0.5, CZ + z + 0.5, { mat: "castle" });
    };
    const hw = W / 2, hd = D / 2;
    // front wall with a gateway
    wallB(-hw, -GATE / 2, 0, H, hd - 1, hd);
    wallB(GATE / 2, hw, 0, H, hd - 1, hd);
    wallB(-GATE / 2, GATE / 2, 5, H, hd - 1, hd);
    // back and sides
    wallB(-hw, hw, 0, H, -hd, -hd + 1);
    wallB(-hw, -hw + 1, 0, H, -hd + 1, hd - 1);
    wallB(hw - 1, hw, 0, H, -hd + 1, hd - 1);
    // battlements around the rooftop
    for (let x = -hw; x < hw; x += 2) {
      wallB(x, x + 1, H, H + 1, -hd, -hd + 1, COBBLE);
      wallB(x, x + 1, H, H + 1, hd - 1, hd, COBBLE);
    }
    for (let z = -hd; z < hd; z += 2) {
      wallB(-hw, -hw + 1, H, H + 1, z, z + 1, COBBLE);
      wallB(hw - 1, hw, H, H + 1, z, z + 1, COBBLE);
    }
    // corner towers
    [[-hw, -hd], [hw - 1, -hd], [-hw, hd - 1], [hw - 1, hd - 1]].forEach(([tx, tz], ti) => {
      for (let y = 0; y < 14; y++) for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 2; dz++) {
        if (Math.abs(dx - 0.5) > 1.6 && Math.abs(dz - 0.5) > 1.6) continue;
        addBlock(COBBLE, CX + tx + dx + 0.5, y + 0.5, CZ + tz + dz + 0.5, { mat: "castle" });
      }
      // purple spire
      for (let y = 0; y < 4; y++) {
        const r = 2 - Math.floor(y / 1.6);
        for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 2; dz++) {
          if (Math.abs(dx - 0.5) + Math.abs(dz - 0.5) > r) continue;
          addBlock(soloGeo("wool_purple"), CX + tx + dx + 0.5, 14 + y + 0.5, CZ + tz + dz + 0.5, { mat: "castle" });
        }
      }
      if (ti >= 2) { // banners on the front towers
        for (let y = 0; y < 3; y++) addBlock(LOG, CX + tx + 0.5, 18 + y + 0.5, CZ + tz + 0.5, { mat: "castle" });
        for (let y = 0; y < 2; y++) for (let dx = 1; dx <= 2; dx++)
          addBlock(soloGeo("wool_red"), CX + tx + dx + 0.5, 19 + y + 0.5, CZ + tz + 0.5, { mat: "castle" });
      }
      castleCollider.circles.push({ x: tx + 0.5, z: tz + 0.5, r: TR });
    });
    // red carpet from the gate to the throne
    for (let z = -hd + 2; z < hd - 1; z++) for (let x = -2; x <= 1; x++)
      addBlock(CARPET, CX + x + 0.5, 0.06, CZ + z + 0.5, { mat: "castle" });

    // --- flight 1: courtyard up to the second floor, along the left wall ---
    const s1x0 = -hw + 1, s1x1 = s1x0 + 3, s1Front = 3;
    for (let i = 0; i < 10; i++) {
      const top = FLOOR2 * (i + 1) / 10;               // 0.5 per step
      const z = s1Front - i - 1;
      for (let x = s1x0; x < s1x1; x++)
        addBlock(STONE_DARK, CX + x + 0.5, top - 0.25, CZ + z + 0.5, { mat: "castle" });
      castlePlatforms.push({ minX: s1x0, maxX: s1x1, minZ: z, maxZ: z + 1, top });
    }
    // banister beside flight 1
    for (let z = s1Front - 10; z < s1Front; z++) for (let y = 0; y < 6; y++)
      addBlock(COBBLE, CX + s1x1 + 0.5, y + 0.5, CZ + z + 0.5, { mat: "castle" });
    castleCollider.boxes.push({ minX: s1x1, maxX: s1x1 + 1, minZ: s1Front - 10, maxZ: s1Front, maxY: FLOOR2 + 1 });

    // --- second floor over the throne hall ---
    for (let x = -hw + 1; x < hw - 1; x++) for (let z = -hd + 1; z < -4; z++)
      addBlock(PLANKS, CX + x + 0.5, FLOOR2 - 0.5, CZ + z + 0.5, { mat: "castle" });
    castlePlatforms.push({ minX: -hw + 1, maxX: hw - 1, minZ: -hd + 1, maxZ: -4, top: FLOOR2 });
    // columns holding it up
    [[-9, -6], [9, -6], [-9, -13], [9, -13]].forEach(([cx, cz]) => {
      for (let y = 0; y < FLOOR2 - 1; y++) addBlock(COBBLE, CX + cx + 0.5, y + 0.5, CZ + cz + 0.5, { mat: "castle" });
      castleCollider.circles.push({ x: cx + 0.5, z: cz + 0.5, r: 0.85, maxY: FLOOR2 - 0.6 });
    });

    // --- flight 2: second floor up to the rooftop, along the right wall ---
    const s2x0 = hw - 4, s2x1 = hw - 1, s2Bottom = -13;
    for (let i = 0; i < 10; i++) {
      const top = FLOOR2 + (ROOF - FLOOR2) * (i + 1) / 10;
      const z = s2Bottom + i;
      for (let x = s2x0; x < s2x1; x++)
        addBlock(STONE_DARK, CX + x + 0.5, top - 0.25, CZ + z + 0.5, { mat: "castle" });
      castlePlatforms.push({ minX: s2x0, maxX: s2x1, minZ: z, maxZ: z + 1, top });
    }
    const s2Top = s2Bottom + 10; // -3, where the stairs meet the roof
    for (let z = s2Bottom; z < s2Top; z++) for (let y = FLOOR2; y < ROOF + 1; y++)
      addBlock(COBBLE, CX + s2x0 - 1 + 0.5, y + 0.5, CZ + z + 0.5, { mat: "castle" });
    castleCollider.boxes.push({ minX: s2x0 - 1, maxX: s2x0, minZ: s2Bottom, maxZ: s2Top, minY: FLOOR2 - 0.5 });

    // --- parapet along the second floor's open edge (gap where flight 1 lands) ---
    const railZ = -4;
    for (let x = s1x1; x < hw - 1; x++) {
      addBlock(COBBLE, CX + x + 0.5, FLOOR2 + 0.5, CZ + railZ + 0.5, { mat: "castle" });
      if (x % 2 === 0) addBlock(COBBLE, CX + x + 0.5, FLOOR2 + 1.5, CZ + railZ + 0.5, { mat: "castle" });
    }
    castleCollider.boxes.push({
      minX: s1x1, maxX: hw - 1, minZ: railZ, maxZ: railZ + 1,
      minY: FLOOR2 - 0.5, maxY: FLOOR2 + 3
    });

    // --- the walkable rooftop, with a stairwell opening over flight 2 ---
    const holeX0 = s2x0 - 1;
    const roofBits = [
      { x0: -hw + 1, x1: holeX0, z0: -hd + 1, z1: hd - 1 },
      { x0: holeX0, x1: hw - 1, z0: s2Top, z1: hd - 1 },
      { x0: holeX0, x1: hw - 1, z0: -hd + 1, z1: s2Bottom }
    ];
    roofBits.forEach(r => {
      for (let x = r.x0; x < r.x1; x++) for (let z = r.z0; z < r.z1; z++)
        addBlock(STONEBRICK, CX + x + 0.5, ROOF - 0.5, CZ + z + 0.5, { mat: "castle" });
      castlePlatforms.push({ minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1, top: ROOF });
    });
    // rooftop banner
    for (let y = 0; y < 5; y++) addBlock(LOG, CX + 0.5, ROOF + y + 0.5, CZ + 0.5, { mat: "castle" });
    for (let y = 0; y < 3; y++) for (let dx = 1; dx <= 3; dx++)
      addBlock(soloGeo("wool_red"), CX + dx + 0.5, ROOF + 2 + y + 0.5, CZ + 0.5, { mat: "castle" });

    // --- throne: gold blocks with a red cushion ---
    const thZ = -hd + 3;
    for (let dx = -1; dx <= 1; dx++) {
      addBlock(GOLD, CX + dx + 0.5, 0.5, CZ + thZ + 0.5, { mat: "castle" });
      for (let y = 1; y < 4; y++) addBlock(GOLD, CX + dx + 0.5, y + 0.5, CZ + thZ - 1 + 0.5, { mat: "castle" });
    }
    for (let dx = -1; dx <= 1; dx++) addBlock(soloGeo("wool_red"), CX + dx + 0.5, 1.5, CZ + thZ + 0.5, { mat: "castle" });
    castleThrone.pos.set(CX + 0.5, 0, CZ + thZ + 0.5);
    castleCollider.circles.push({ x: 0.5, z: thZ + 0.5, r: 1.4, maxY: FLOOR2 - 0.6 });

    // --- outer wall colliders ---
    castleCollider.boxes.push(
      { minX: GATE / 2, maxX: hw, minZ: hd - 1, maxZ: hd },
      { minX: -hw, maxX: -GATE / 2, minZ: hd - 1, maxZ: hd },
      { minX: -hw, maxX: hw, minZ: -hd, maxZ: -hd + 1 },
      { minX: -hw, maxX: -hw + 1, minZ: -hd, maxZ: hd },
      { minX: hw - 1, maxX: hw, minZ: -hd, maxZ: hd }
    );

    // --- route arrows ---
    const arrowTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const g = c.getContext("2d");
      g.fillStyle = "#ffd21f";
      const rows = ["0000011110000000", "0000111111000000", "0001111111100000", "0011111111110000",
                    "0111111111111000", "1111111111111100", "0111111111111000", "0011111111110000",
                    "0001111111100000", "0000111111000000", "0000011110000000", "0000000000000000",
                    "0000000000000000", "0000000000000000", "0000000000000000", "0000000000000000"];
      rows.forEach((row, y) => row.split("").forEach((v, x) => { if (v === "1") g.fillRect(x, y, 1, 1); }));
      const t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      return t;
    })();
    const arrowGeo = new THREE.PlaneGeometry(2.6, 2.6);
    function routeArrow(x, y, z, headingDeg) {
      const mat = new THREE.MeshBasicMaterial({
        map: arrowTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false
      });
      const a = new THREE.Mesh(arrowGeo, mat);
      a.rotation.x = -Math.PI / 2;
      a.rotation.z = THREE.MathUtils.degToRad(headingDeg - 90);
      a.position.set(CX + x, y + 0.14, CZ + z);
      scene.add(a);
      castleArrows.push(mat);
    }
    // heading 0 = toward -z (into the castle); 90 = -x, 180 = +z, 270 = +x
    [[-5, 9], [-10, 7], [-14.5, 5]].forEach(([x, z]) => routeArrow(x, 0, z, 45));
    routeArrow(-17.5, 0, 4.2, 0);
    [[-14, -5.5], [-8, -8], [-1, -10.3], [7, -12], [13, -13.4]].forEach(([x, z]) => routeArrow(x, FLOOR2, z, 315));
    routeArrow(17.5, FLOOR2, -14.2, 180);
    [[4, -1], [10, -2.5]].forEach(([x, z]) => routeArrow(x, ROOF, z, 270));
    [[17.5, 4], [17.5, 1], [17.5, -2]].forEach(([x, z]) => routeArrow(x, ROOF, z, 0));

    // stars: courtyard, second floor, rooftop
    castleStars.push(
      new THREE.Vector3(CX + 8, 1.4, CZ + 2),
      new THREE.Vector3(CX - 8, FLOOR2 + 1.4, CZ - 9),
      new THREE.Vector3(CX + 5, ROOF + 1.4, CZ + 5)
    );
  })();

  buildBatches();
  // the castle's blocks fade to glass while the player is inside
  batches.forEach(b => { if (b.mat === "castle") castleFade.meshes.push(b.mesh); });
  castleFade.meshes.forEach(m => {
    m.material = blockMaterial.clone();
    m.material.transparent = true;
  });
  // portal + water get their own look
  batches.forEach(b => {
    if (b.mat === "portal") {
      b.mesh.material = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, opacity: 0.72 });
      b.mesh.castShadow = false;
    } else if (b.mat === "water") {
      b.mesh.material = new THREE.MeshLambertMaterial({ map: atlas, transparent: true, opacity: 0.78 });
      b.mesh.castShadow = false;
    } else if (b.mat === "ground") {
      b.mesh.castShadow = false;
    }
  });

  // ---------- the hero: a blocky treasure-hunter king ----------
  function boxPart(w, h, d, texTop, texSide, texFront) {
    const g = new THREE.BoxGeometry(w, h, d);
    faceUV(g, [texSide, texSide, texTop, texTop, texFront !== undefined ? texFront : texSide, texSide]);
    bakeFaceShading(g);
    const m = new THREE.Mesh(g, blockMaterial);
    m.castShadow = true;
    return m;
  }

  function buildHero() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const mkLimb = (x, tex) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.95, 0);
      const limb = boxPart(0.34, 0.8, 0.34, tex, tex, tex);
      limb.position.y = -0.4;
      pivot.add(limb);
      body.add(pivot);
      return pivot;
    };
    const legL = mkLimb(-0.2, T.wool_blue), legR = mkLimb(0.2, T.wool_blue);
    [legL, legR].forEach(p => {
      const shoe = boxPart(0.38, 0.18, 0.44, T.wool_black, T.wool_black, T.wool_black);
      shoe.position.set(0, -0.86, 0.04);
      p.add(shoe);
    });

    const torso = boxPart(0.78, 0.9, 0.46, T.belly, T.belly, T.belly_front);
    torso.position.y = 1.4;
    body.add(torso);

    const mkArm = x => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.72, 0);
      const arm = boxPart(0.28, 0.78, 0.28, T.wool_blue, T.wool_blue, T.wool_blue);
      arm.position.y = -0.39;
      pivot.add(arm);
      body.add(pivot);
      return pivot;
    };
    const armL = mkArm(-0.53), armR = mkArm(0.53);

    // magic star wand in the right hand
    const wand = new THREE.Group();
    const stick = boxPart(0.1, 0.7, 0.1, T.log_top, T.log_side, T.log_side);
    wand.add(stick);
    const starBlock = boxPart(0.3, 0.3, 0.12, T.glow_star, T.glow_star, T.glow_star);
    starBlock.position.y = 0.44;
    wand.add(starBlock);
    wand.position.set(0, -0.72, 0.14);
    wand.rotation.x = -0.5;
    armR.add(wand);

    // head
    const head = new THREE.Group();
    head.position.y = 2.24;
    body.add(head);
    const face = boxPart(0.68, 0.68, 0.68, T.red_face, T.red_face, T.red_face_front);
    head.add(face);
    [-1, 1].forEach(s => {
      const ear = boxPart(0.2, 0.34, 0.3, T.wool_black, T.wool_black, T.wool_black);
      ear.position.set(0.42 * s, 0.28, 0);
      head.add(ear);
    });
    // crown
    for (let i = -1; i <= 1; i++) {
      const band = boxPart(0.24, 0.14, 0.7, T.gold, T.gold, T.gold);
      band.position.set(i * 0.24, 0.41, 0);
      head.add(band);
      const spike = boxPart(0.18, 0.18, 0.18, T.gold, T.gold, T.gold);
      spike.position.set(i * 0.26, 0.55, 0);
      head.add(spike);
    }
    const gem = boxPart(0.12, 0.12, 0.12, T.diamond, T.diamond, T.diamond);
    gem.position.set(0, 0.44, 0.36);
    head.add(gem);

    return { root, body, head, legL, legR, armL, armR, star: starBlock };
  }
  const hero = buildHero();
  scene.add(hero.root);

  // ---------- collectible stars (spinning gold blocks) ----------
  const starGeo = (() => {
    const g = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const t = T.glow_star;
    faceUV(g, [t, t, t, t, t, t]);
    bakeFaceShading(g);
    return g;
  })();
  const starMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true });
  const stars = [];
  const starSpots = [
    [-6, -10], [12, -4], [-20, 18], [4, 24], [-34, -14],
    [26, 6], [36, -20], [-44, 34], [16, -34], [-8, 56], [-28, -44], [62, 20]
  ];
  starSpots.forEach(([x, z]) => {
    const m = new THREE.Mesh(starGeo, starMat);
    m.userData.baseY = 1.2;
    m.position.set(x, 1.2, z);
    scene.add(m);
    stars.push(m);
  });
  castleStars.forEach(p => {
    const m = new THREE.Mesh(starGeo, starMat);
    m.userData.baseY = p.y;
    m.position.copy(p);
    scene.add(m);
    stars.push(m);
  });

  // ---------- question blocks ----------
  const qGeo = soloGeo("question");
  const qGeoUsed = soloGeo("question_used");
  const qBlocks = [];
  [[6, 3.5, -22], [-16, 3.5, 12], [30, 3.5, -30]].forEach(([x, y, z]) => {
    const b = new THREE.Mesh(qGeo, blockMaterial);
    b.position.set(x + 0.5, y, z + 0.5);
    b.castShadow = true;
    b.userData = { baseY: y, used: false, pop: 0 };
    scene.add(b);
    qBlocks.push(b);
  });

  // ---------- X marks / dig spots ----------
  const xGeo = soloGeo("wool_magenta");
  const digSpots = [
    [-28, -32], [27, -8], [-10, 30], [14, 44], [-46, 14], [56, -16]
  ].map(([bx, bz]) => {
    const meshes = [];
    for (let d = -2; d <= 2; d++) {
      [[d, d], [d, -d]].forEach(([ox, oz]) => {
        const m = new THREE.Mesh(xGeo, blockMaterial.clone());
        m.position.set(bx + ox + 0.5, 0.06, bz + oz + 0.5);
        m.scale.y = 0.12;
        m.receiveShadow = true;
        scene.add(m);
        meshes.push(m);
      });
    }
    return { pos: new THREE.Vector3(bx + 0.5, 0, bz + 0.5), dug: false, meshes };
  });
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
  $("starsTotal").textContent = stars.length + qBlocks.length;
  $("dugTotal").textContent = digSpots.length;
  let starCount = 0, dugCount = 0;
  let missionTimer = null;
  const DEFAULT_MISSION = "Your Mission: find the ❌ marks and dig up the hidden treasure!";
  function setMission(text, revertMs) {
    $("mission").textContent = text;
    if (missionTimer) clearTimeout(missionTimer);
    if (revertMs) missionTimer = setTimeout(() => { $("mission").textContent = DEFAULT_MISSION; }, revertMs);
  }

  // ---------- sound ----------
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

  // ---------- blocky particle bursts ----------
  const bursts = [];
  const burstGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  function burst(pos, color, count, speed, life) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const mesh = new THREE.InstancedMesh(burstGeo, mat, count);
    mesh.frustumCulled = false;
    const parts = [];
    for (let i = 0; i < count; i++) {
      parts.push({
        p: pos.clone(),
        v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.9 + speed * 0.4, (Math.random() - 0.5) * speed)
      });
    }
    scene.add(mesh);
    bursts.push({ mesh, parts, life, age: 0, mat });
  }
  function updateBursts(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.age += dt;
      b.parts.forEach((p, j) => {
        p.v.y -= 14 * dt;
        p.p.addScaledVector(p.v, dt);
        if (p.p.y < 0.1) { p.p.y = 0.1; p.v.set(0, 0, 0); }
        _m4.makeTranslation(p.p.x, p.p.y, p.p.z);
        b.mesh.setMatrixAt(j, _m4);
      });
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mat.opacity = Math.max(0, 1 - b.age / b.life);
      if (b.age > b.life) {
        scene.remove(b.mesh);
        b.mesh.dispose();
        b.mat.dispose();
        bursts.splice(i, 1);
      }
    }
  }

  // ---------- final boss: the Giant Hand Girl ----------
  function buildGiantHand(mirror) {
    const g = new THREE.Group();
    const palm = boxPart(1.7, 1.9, 0.7, T.skin, T.skin, T.skin);
    g.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = boxPart(0.34, 1.1, 0.6, T.skin, T.skin, T.skin);
      f.position.set(-0.62 + i * 0.42, 1.45, 0);
      g.add(f);
    }
    const thumb = boxPart(0.42, 0.95, 0.6, T.skin, T.skin, T.skin);
    thumb.position.set(1.02 * (mirror ? -1 : 1), 0.4, 0);
    thumb.rotation.z = 0.6 * (mirror ? 1 : -1);
    g.add(thumb);
    g.scale.setScalar(1.5);
    return g;
  }
  function buildBossGirl() {
    const g = new THREE.Group();
    [-1, 1].forEach(s => {
      const leg = boxPart(0.36, 0.95, 0.36, T.wool_green, T.wool_green, T.wool_green);
      leg.position.set(0.26 * s, 0.5, 0);
      g.add(leg);
      const shoe = boxPart(0.42, 0.2, 0.5, s < 0 ? T.wool_orange : T.wool_cyan,
        s < 0 ? T.wool_orange : T.wool_cyan, s < 0 ? T.wool_orange : T.wool_cyan);
      shoe.position.set(0.26 * s, 0.08, 0.06);
      g.add(shoe);
    });
    const torso = boxPart(0.8, 1.05, 0.44, T.shirt_blue, T.shirt_blue, T.shirt_blue);
    torso.position.y = 1.5;
    g.add(torso);
    const head = new THREE.Group();
    head.position.y = 2.45;
    g.add(head);
    const face = boxPart(0.72, 0.72, 0.72, T.hair, T.hair, T.girl_face);
    head.add(face);
    const hairBack = boxPart(0.78, 0.8, 0.3, T.hair, T.hair, T.hair);
    hairBack.position.z = -0.32;
    head.add(hairBack);
    // the cat riding on her head
    const cat = new THREE.Group();
    cat.position.set(0, 0.55, 0.02);
    const catBody = boxPart(0.5, 0.34, 0.6, T.wool_orange, T.wool_orange, T.wool_orange);
    cat.add(catBody);
    const catHead = boxPart(0.36, 0.34, 0.34, T.wool_orange, T.wool_orange, T.cat_face);
    catHead.position.set(0, 0.16, 0.34);
    cat.add(catHead);
    [-1, 1].forEach(s => {
      const ear = boxPart(0.12, 0.14, 0.1, T.wool_orange, T.wool_orange, T.wool_orange);
      ear.position.set(0.11 * s, 0.38, 0.34);
      cat.add(ear);
    });
    const tail = boxPart(0.12, 0.44, 0.12, T.wool_orange, T.wool_orange, T.wool_orange);
    tail.position.set(0, 0.22, -0.34);
    tail.rotation.x = -0.5;
    cat.add(tail);
    head.add(cat);
    const shoulders = [-1, 1].map(s => {
      const anchor = new THREE.Object3D();
      anchor.position.set(0.5 * s, 1.9, 0);
      g.add(anchor);
      return anchor;
    });
    g.scale.setScalar(1.5);
    return { group: g, head, cat, shoulders };
  }

  const boss = { active: false, defeated: false, hp: 3, body: null, hands: [], shadowRing: null, attackTimer: 2, handIndex: 0 };
  function startBossFight(treasurePos) {
    const b = buildBossGirl();
    b.group.position.set(treasurePos.x, 0, treasurePos.z - 6);
    scene.add(b.group);
    boss.body = b;
    [true, false].forEach((mirror, i) => {
      const h = buildGiantHand(mirror);
      const side = i === 0 ? -1 : 1;
      h.position.set(treasurePos.x + side * 7, 6, treasurePos.z - 5);
      scene.add(h);
      const sleeve = boxPart(0.55, 1, 0.55, T.shirt_blue, T.shirt_blue, T.shirt_blue);
      scene.add(sleeve);
      boss.hands.push({
        mesh: h, side, state: "idle", t: 0, sleeve, shoulder: b.shoulders[i],
        home: h.position.clone(), target: new THREE.Vector3()
      });
    });
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ color: 0x1a0d18, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
    ring.visible = false;
    scene.add(ring);
    boss.shadowRing = ring;
    boss.active = true;
    boss.hp = 3;
    playerHp = 3;
    $("bossPill").style.display = "";
    $("bossHp").textContent = "❤️❤️❤️";
    $("playerPill").style.display = "";
    $("playerHp").textContent = "❤️❤️❤️";
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
    player.digging = 0.45;
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
    const bg = boss.body.group;
    bg.position.y = 1.8 + Math.sin(t * 2.1) * 0.35;
    bg.rotation.y = Math.atan2(player.pos.x - bg.position.x, player.pos.z - bg.position.z);
    bg.rotation.z = Math.sin(t * 2.6) * 0.05;
    boss.body.cat.rotation.z = Math.sin(t * 3.2) * 0.12;
    if (boss.defeated) {
      bg.rotation.y += Math.sin(t * 4) * 0.15;
      boss.hands.forEach(h => {
        h.mesh.position.lerp(h.home, dt * 2);
        h.mesh.rotation.z = Math.sin(t * 6 + h.side) * 0.4;
      });
      updateSleeves();
      return;
    }
    if (!boss.active) return;
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
          idlePos.y = 6 + Math.sin(t * 1.8 + hand.side) * 0.5;
          m.position.lerp(idlePos, dt * 2.5);
          m.rotation.set(0, 0, Math.sin(t * 1.5 + hand.side) * 0.12);
          break;
        }
        case "telegraph": {
          const hover = hand.target.clone();
          hover.y = 8;
          m.position.lerp(hover, dt * 5);
          m.rotation.x = Math.PI;
          boss.shadowRing.visible = true;
          boss.shadowRing.position.set(hand.target.x, 0.09, hand.target.z);
          const p = Math.min(1, hand.t / 1.1);
          boss.shadowRing.scale.setScalar(0.4 + p * 0.7);
          if (hand.t > 1.1) { hand.state = "slam"; hand.t = 0; }
          break;
        }
        case "slam": {
          m.position.y = Math.max(1.2, 8 - hand.t * 28);
          if (m.position.y <= 1.2) {
            burst(new THREE.Vector3(m.position.x, 0.5, m.position.z), 0x8a6134, 20, 5, 0.8);
            beep(90, 0.3, "sawtooth", 0, 0.2);
            shake = 0.5;
            const dx = player.pos.x - m.position.x, dz = player.pos.z - m.position.z;
            const dd = Math.hypot(dx, dz);
            if (dd < 2.8 && hurtCooldown <= 0) {
              knock.set(dx / (dd || 1) * 14, 0, dz / (dd || 1) * 14);
              hurtPlayer();
            }
            hand.state = "stunned";
            hand.t = 0;
            boss.shadowRing.visible = false;
          }
          break;
        }
        case "stunned": {
          m.position.y = 1.2 + Math.sin(hand.t * 3) * 0.05;
          m.rotation.x = Math.PI;
          m.rotation.z = Math.sin(hand.t * 20) * 0.04;
          if (hand.t > 3.0) { hand.state = "return"; hand.t = 0; }
          break;
        }
        case "return": {
          const back = hand.home.clone();
          back.y = 6;
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
    let bestHand = null, best = 3.6;
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
    const base = boxPart(1.7, 1, 1.3, T.chest_top, T.chest_side, T.chest_front);
    base.position.y = 0.5;
    g.add(base);
    const lid = new THREE.Group();
    lid.position.set(0, 1, -0.65);
    const lidMesh = boxPart(1.7, 0.6, 1.3, T.chest_top, T.chest_side, T.chest_front);
    lidMesh.position.set(0, 0.3, 0.65);
    lid.add(lidMesh);
    g.add(lid);
    const gold = boxPart(1.2, 0.35, 0.9, T.gold, T.gold, T.gold);
    gold.position.y = 1.05;
    g.add(gold);
    const glow = new THREE.PointLight(0xffcc33, 0, 14);
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

  const isTouch = IS_TOUCH;
  const joyVec = { x: 0, y: 0 };
  if (isTouch) {
    document.body.classList.add("touch");
    const joy = $("joy"), knob = $("joyKnob");
    let joyId = null;
    const setKnob = (dx, dy) => { knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
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
      joyMove(e);
    });
    joy.addEventListener("pointermove", e => { if (e.pointerId === joyId) joyMove(e); });
    const joyEnd = e => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      joyVec.x = joyVec.y = 0;
      setKnob(0, 0);
    };
    joy.addEventListener("pointerup", joyEnd);
    joy.addEventListener("pointercancel", joyEnd);
    const pressable = (btn, onPress) => {
      btn.addEventListener("pointerdown", e => { e.preventDefault(); btn.classList.add("pressed"); onPress(); });
      ["pointerup", "pointercancel", "pointerleave"].forEach(ev =>
        btn.addEventListener(ev, () => btn.classList.remove("pressed")));
    };
    pressable($("btnJump"), () => { wantJump = true; });
    pressable($("btnDig"), () => tryDig());
    document.addEventListener("contextmenu", e => { if (e.target.closest(".tbtn, #joy")) e.preventDefault(); });
  }
  window.addEventListener("pointerdown", () => ac(), { once: true });

  // camera orbit
  let camYaw = 0, camPitch = 0.55;
  const CAM_DIST = 13;
  {
    const canvas = renderer.domElement;
    let dragId = null, lastX = 0, lastY = 0;
    canvas.addEventListener("pointerdown", e => {
      dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
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

  // ---------- castle helpers ----------
  function groundHeightAt(px, pz, py) {
    const dx = px - CX, dz = pz - CZ;
    if (dx * dx + dz * dz > 1600) return 0;
    let h = 0;
    // bounds are inclusive: standing exactly on the seam between two steps must
    // match both and resolve to the higher one, or the player falls through it
    for (const p of castlePlatforms) {
      if (dx >= p.minX && dx <= p.maxX && dz >= p.minZ && dz <= p.maxZ && p.top <= py + 0.65) {
        h = Math.max(h, p.top);
      }
    }
    return h;
  }
  function insideCastle() {
    const dx = player.pos.x - CX, dz = player.pos.z - CZ;
    return Math.abs(dx) < 22 && Math.abs(dz) < 17;
  }
  function collideWithCastle() {
    const r = 0.45;
    let lx = player.pos.x - CX, lz = player.pos.z - CZ;
    if (lx * lx + lz * lz > 1600) return;
    for (const b of castleCollider.boxes) {
      if (b.minY !== undefined && player.pos.y < b.minY) continue;
      if (b.maxY !== undefined && player.pos.y > b.maxY) continue;
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
    for (const c of castleCollider.circles) {
      if (c.minY !== undefined && player.pos.y < c.minY) continue;
      if (c.maxY !== undefined && player.pos.y > c.maxY) continue;
      const ddx = lx - c.x, ddz = lz - c.z, rr = c.r + r;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        lx = c.x + ddx / d * rr;
        lz = c.z + ddz / d * rr;
      }
    }
    player.pos.x = CX + lx;
    player.pos.z = CZ + lz;
  }

  // ---------- game state ----------
  const player = { pos: new THREE.Vector3(0, 0, 8), vy: 0, onGround: true, facing: 0, digging: 0 };
  let wantJump = false, won = false, lost = false, nearSpot = null;
  let shake = 0, playerHp = 3, hurtCooldown = 0, castleHintShown = false;
  const knock = new THREE.Vector3();

  function hurtPlayer() {
    if (hurtCooldown > 0 || lost || won) return;
    playerHp--;
    hurtCooldown = 1.5;
    $("playerHp").textContent = "❤️".repeat(playerHp) || "💫";
    beep(180, 0.25, "sawtooth", 0, 0.18);
    beep(120, 0.3, "sawtooth", 0.12, 0.18);
    if (playerHp <= 0) {
      lost = true;
      won = true;
      boss.active = false;
      if (boss.shadowRing) boss.shadowRing.visible = false;
      [392, 330, 262, 196].forEach((f, i) => beep(f, 0.3, "triangle", i * 0.18, 0.14));
      setTimeout(() => { $("lose").style.display = "flex"; }, 700);
    } else {
      setMission(`Ouch! ${playerHp} heart${playerHp === 1 ? "" : "s"} left — dodge the shadow squares! 🖐️`, 2500);
    }
  }

  function tryDig() {
    ac();
    if (won || player.digging > 0) return;
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
      spot.meshes.forEach(m => { m.material = blockMaterial; m.visible = false; });
      dugCount++;
      $("dug").textContent = dugCount;
      if (digSpots.indexOf(spot) === treasureIndex) {
        spawnChest(spot.pos);
        sfx.fanfare();
        setMission("💛 TREASURE!!! 💛");
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
      burst(new THREE.Vector3(p.x + (Math.random() - 0.5) * 6, 6 + Math.random() * 3, p.z + (Math.random() - 0.5) * 6),
        colors[i % colors.length], 30, 5, 2.2);
    }
  }
  $("again").addEventListener("click", () => location.reload());
  $("retry").addEventListener("click", () => location.reload());

  window.__game = {
    player, digSpots, tryDig: () => tryDig(), treasureIndex, boss, hurtPlayer, portals,
    groundHeightAt, collideWithCastle, castlePlatforms
  };

  // ---------- main loop ----------
  const clock = new THREE.Clock();
  const SPEED = 8.5, GRAVITY = 26, JUMP = 9.5;
  const camTarget = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    let ix = 0, iz = 0;
    if (keys.KeyW || keys.ArrowUp) iz -= 1;
    if (keys.KeyS || keys.ArrowDown) iz += 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1;
    if (keys.KeyD || keys.ArrowRight) ix += 1;
    ix += joyVec.x; iz += joyVec.y;
    const ilen = Math.hypot(ix, iz);
    if (ilen > 1) { ix /= ilen; iz /= ilen; }

    if (keys.KeyZ) camYaw += 2.2 * dt;
    if (keys.KeyC) camYaw -= 2.2 * dt;

    const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
    const mx = ix * cy + iz * sy;
    const mz = -ix * sy + iz * cy;

    const moving = ilen > 0.15 && player.digging <= 0 && !won;
    if (moving) {
      player.pos.x += mx * SPEED * dt;
      player.pos.z += mz * SPEED * dt;
      player.facing = Math.atan2(mx, mz);
    }
    if (knock.lengthSq() > 0.01) {
      player.pos.x += knock.x * dt;
      player.pos.z += knock.z * dt;
      knock.multiplyScalar(Math.max(0, 1 - dt * 5));
    }
    player.pos.x = Math.max(-WORLD, Math.min(WORLD, player.pos.x));
    player.pos.z = Math.max(-WORLD, Math.min(WORLD, player.pos.z));
    collideWithCastle();

    if ((keys.Space || wantJump) && player.onGround && player.digging <= 0 && !won) {
      player.vy = JUMP;
      player.onGround = false;
      sfx.jump();
    }
    wantJump = false;
    const gh = groundHeightAt(player.pos.x, player.pos.z, player.pos.y);
    if (player.onGround) {
      if (player.pos.y - gh > 0.6) { player.onGround = false; player.vy = 0; }
      else player.pos.y = gh;
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
    if (Math.random() < dt * 5) {
      const p = portals[Math.floor(Math.random() * portals.length)];
      const rainbow = [0xd8262c, 0xe8a020, 0xffd21f, 0x2fae2f, 0x2f6df6, 0xc03ad0];
      burst(new THREE.Vector3(p.x, 1.5, p.z), rainbow[Math.floor(Math.random() * rainbow.length)], 3, 2, 1);
    }
    if (portalCooldown <= 0 && !won) {
      for (let i = 0; i < portals.length; i++) {
        const p = portals[i];
        if (Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < 3.6) {
          const dest = portals[1 - i];
          burst(new THREE.Vector3(p.x, 1.5, p.z), 0x24b6c9, 24, 5, 1);
          const inward = Math.hypot(dest.x, dest.z) || 1;
          player.pos.set(dest.x - dest.x / inward * 5, 0, dest.z - dest.z / inward * 5);
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
    let d = player.facing - hero.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    hero.root.rotation.y += d * Math.min(1, dt * 12);

    const runPhase = t * 10;
    if (moving && player.onGround) {
      hero.legL.rotation.x = Math.sin(runPhase) * 0.85;
      hero.legR.rotation.x = -Math.sin(runPhase) * 0.85;
      hero.armL.rotation.x = -Math.sin(runPhase) * 0.7;
      hero.armR.rotation.x = Math.sin(runPhase) * 0.7;
      hero.body.position.y = Math.abs(Math.sin(runPhase)) * 0.06;
    } else if (!player.onGround) {
      hero.legL.rotation.x = 0.5; hero.legR.rotation.x = -0.4;
      hero.armL.rotation.x = -1.6; hero.armR.rotation.x = -1.6;
    } else {
      hero.legL.rotation.x *= 0.8; hero.legR.rotation.x *= 0.8;
      hero.armL.rotation.x *= 0.8; hero.armR.rotation.x *= 0.8;
      hero.body.position.y = Math.sin(t * 2.2) * 0.02;
    }
    if (player.digging > 0) hero.armR.rotation.x = -2 + Math.sin(t * 30) * 0.5;
    hero.star.rotation.z = t * 3;
    hero.head.rotation.y = Math.sin(t * 0.8) * 0.12;

    // camera
    camTarget.set(player.pos.x, player.pos.y + 1.8, player.pos.z);
    const camGoal = new THREE.Vector3(
      player.pos.x + Math.sin(camYaw) * CAM_DIST * Math.cos(camPitch),
      player.pos.y + CAM_DIST * Math.sin(camPitch),
      player.pos.z + Math.cos(camYaw) * CAM_DIST * Math.cos(camPitch)
    );
    if (camSnap) { camera.position.copy(camGoal); camSnap = false; }
    else camera.position.lerp(camGoal, Math.min(1, dt * 4));
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      shake = Math.max(0, shake - dt * 1.6);
    }
    camera.lookAt(camTarget);
    sun.position.set(player.pos.x + 26, 46, player.pos.z + 18);
    sun.target.position.copy(player.pos);
    // sky dome rides with the camera; clouds drift slowly overhead
    scene.userData.skyDome.position.copy(camera.position);
    clouds.position.x = (t * 0.55) % 60;
    clouds.position.z = (t * 0.18) % 60;

    // stars
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      s.rotation.y = t * 1.6 + i;
      s.position.y = s.userData.baseY + Math.sin(t * 2.5 + i) * 0.18;
      const horiz = Math.hypot(s.position.x - player.pos.x, s.position.z - player.pos.z);
      if (!won && horiz < 1.5 && Math.abs(s.position.y - (player.pos.y + 1.2)) < 1.8) {
        sfx.star();
        burst(s.position.clone(), 0xffd21f, 12, 3.2, 0.7);
        scene.remove(s);
        stars.splice(i, 1);
        starCount++;
        $("stars").textContent = starCount;
      }
    }

    // question blocks
    qBlocks.forEach((b, i) => {
      const u = b.userData;
      if (u.pop > 0) u.pop -= dt;
      b.position.y = u.baseY + Math.sin(t * 1.8 + i * 2) * (u.used ? 0.06 : 0.2) + Math.max(0, u.pop) * 1.6;
      if (!u.used && !won) {
        const hd = Math.hypot(player.pos.x - b.position.x, player.pos.z - b.position.z);
        if (hd < 1.5 && !player.onGround && player.vy > 0 && player.pos.y + 2.7 >= b.position.y - 0.7) {
          u.used = true;
          u.pop = 0.35;
          b.geometry = qGeoUsed;
          starCount++;
          $("stars").textContent = starCount;
          sfx.star();
          burst(b.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xffd21f, 16, 4, 0.9);
          setMission("❓ Surprise! A star was hidden in the block! ⭐", 2800);
        }
      }
    });

    // dig spots
    nearSpot = null;
    let best = 3;
    for (const s of digSpots) {
      if (s.dug) continue;
      const dd = Math.hypot(player.pos.x - s.pos.x, player.pos.z - s.pos.z);
      if (dd < best) { best = dd; nearSpot = s; }
    }
    if (nearSpot && player.digging <= 0 && !won && !boss.active && !boss.defeated) {
      setMission(isTouch ? "❌ found! Tap DIG to dig here!" : "❌ found! Press E to dig here!");
    } else if (!won && !boss.active && !boss.defeated && player.digging <= 0 && $("mission").textContent.startsWith("❌")) {
      setMission(DEFAULT_MISSION);
    }

    // hurt flash
    if (hurtCooldown > 0) {
      hurtCooldown -= dt;
      hero.root.visible = Math.floor(t * 14) % 2 === 0;
    } else if (!hero.root.visible) {
      hero.root.visible = true;
    }

    // castle: route arrows + glass walls while inside
    const pulse = 0.55 + Math.abs(Math.sin(t * 2.2)) * 0.45;
    castleArrows.forEach((m, i) => { m.opacity = pulse * (i % 2 ? 0.85 : 1); });
    const inCastleNow = insideCastle();
    if (inCastleNow && !castleHintShown && !boss.active && !won) {
      castleHintShown = true;
      setMission("🏰 Take the stairs by the left wall, cross the upper floor, then the far stairs lead to the rooftop!", 6000);
    }
    const fadeTarget = inCastleNow && player.pos.y < 9.5 ? 0.25 : 1;
    if (Math.abs(castleFade.level - fadeTarget) > 0.005) {
      castleFade.level += (fadeTarget - castleFade.level) * Math.min(1, dt * 6);
      castleFade.meshes.forEach(m => { m.material.opacity = castleFade.level; });
    }

    if (!castleThrone.visited &&
        Math.hypot(player.pos.x - castleThrone.pos.x, player.pos.z - castleThrone.pos.z) < 2.4) {
      castleThrone.visited = true;
      sfx.fanfare();
      burst(castleThrone.pos.clone().add(new THREE.Vector3(0, 2, 0)), 0xffd21f, 24, 4, 1.2);
      setMission("👑 Welcome to your castle, Treasure King!", 4000);
    }

    updateBoss(dt, t);

    if (chest) {
      chest.t += dt;
      if (chest.group.position.y < 0) chest.group.position.y = Math.min(0, -1.4 + chest.t * 1.6);
      else if (chest.t > 1) {
        chest.lid.rotation.x = Math.max(-1.9, chest.lid.rotation.x - dt * 2.4);
        chest.glow.intensity = Math.min(30, chest.glow.intensity + dt * 40);
        if (Math.random() < 0.3) burst(chest.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 0xffd21f, 6, 4, 1);
      }
    }

    updateBursts(dt);
    renderer.render(scene, camera);
  }
  animate();
})();
