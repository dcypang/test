// ---------------------------------------------------------------------------
// renderer.js - forward renderer with two shadow cascades, a procedural sky,
// alpha-blended glass, GPU particles for smoke and light glows, ground decals
// for skid marks, and a bloom / tonemap / motion blur post chain.
// ---------------------------------------------------------------------------

const MAX_PARTICLES = 2600;
const MAX_DECALS = 4200;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = createContext(canvas);

    this.mainProgram = new Program(gl, MAIN_VS, MAIN_FS, 'main');
    this.shadowProgram = new Program(gl, SHADOW_VS, SHADOW_FS, 'shadow');
    this.skyProgram = new Program(gl, SKY_VS, SKY_FS, 'sky');
    this.brightProgram = new Program(gl, POST_VS, BRIGHT_FS, 'bright');
    this.blurProgram = new Program(gl, POST_VS, BLUR_FS, 'blur');
    this.compositeProgram = new Program(gl, POST_VS, COMPOSITE_FS, 'composite');
    this.particleProgram = new Program(gl, PARTICLE_VS, PARTICLE_FS, 'particle');
    this.decalProgram = new Program(gl, DECAL_VS, DECAL_FS, 'decal');

    this.quad = createFullscreenQuad(gl);
    this.shadowNear = new ShadowTarget(gl, 2048);
    this.shadowFar = new ShadowTarget(gl, 2048);
    this.scene = new SceneTarget(gl, canvas.width, canvas.height);
    this.bloomA = new ColorTarget(gl, 1, 1);
    this.bloomB = new ColorTarget(gl, 1, 1);

    this.shadowMat0 = m4.create();
    this.shadowMat1 = m4.create();
    this.normalMat = new Float32Array(9);

    this.queueOpaque = [];
    this.queueGlass = [];

    this.initParticles();
    this.initDecals();

    this.settings = {
      shadows: true,
      bloom: 0.55,
      exposure: 1.22,
      vignette: 0.42,
      motionBlur: true,
      particles: true,
    };

    this.ambience = {
      sunDir: v3.norm([0, 0, 0], [0.4, 0.72, 0.35]),
      sunColor: [1.9, 1.78, 1.55],
      skyZenith: [0.20, 0.36, 0.72],
      skyHorizon: [0.62, 0.72, 0.86],
      groundTint: [0.22, 0.24, 0.18],
      cloudColor: [1.0, 0.99, 0.98],
      cloudAmount: 0.55,
      fogColor: [0.62, 0.70, 0.82],
      fogDensity: 0.00085,
      wetness: 0.15,
      night: 0.0,
    };
    this.cloudOffset = 0;
    this.flash = 0;
    this.time = 0;
  }

  resize(width, height, dpr) {
    const gl = this.gl;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.scene.resize(w, h);
    this.bloomA.resize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.bloomB.resize(Math.max(1, w >> 2), Math.max(1, h >> 2));
  }

  // --- particles ------------------------------------------------------------

  initParticles() {
    const gl = this.gl;
    this.particles = [];
    this.particleData = new Float32Array(MAX_PARTICLES * 4 * 12);
    this.particleVao = gl.createVertexArray();
    gl.bindVertexArray(this.particleVao);
    this.particleVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);
    const stride = 12 * 4;
    const layout = [[0, 3, 0], [1, 4, 12], [2, 3, 28], [3, 2, 40]];
    for (const [loc, size, offset] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    }
    const idx = new Uint16Array(MAX_PARTICLES * 6);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const b = i * 4;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    this.particleIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.particleIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  spawnParticle(pos, vel, opts = {}) {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({
      pos: [pos[0], pos[1], pos[2]],
      vel: [vel[0], vel[1], vel[2]],
      life: 0,
      maxLife: opts.life || 1.0,
      size: opts.size || 0.4,
      grow: opts.grow || 1.2,
      tint: opts.tint || [0.6, 0.6, 0.6],
      alpha: opts.alpha !== undefined ? opts.alpha : 0.5,
      drag: opts.drag !== undefined ? opts.drag : 1.6,
      gravity: opts.gravity !== undefined ? opts.gravity : 0.4,
      rot: Math.random() * TAU,
      spin: (Math.random() - 0.5) * 1.4,
      additive: !!opts.additive,
    });
  }

  // Persistent glow, re-emitted every frame (lamps, brake lights, headlights).
  addGlow(pos, tint, size, alpha) {
    this.glows.push({ pos, tint, size, alpha });
  }

  updateParticles(dt) {
    const alive = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      const damp = Math.exp(-p.drag * dt);
      p.vel[0] *= damp; p.vel[2] *= damp;
      p.vel[1] = p.vel[1] * damp + p.gravity * dt;
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      p.pos[2] += p.vel[2] * dt;
      p.rot += p.spin * dt;
      alive.push(p);
    }
    this.particles = alive;
  }

  // --- decals (skid marks) --------------------------------------------------

  initDecals() {
    const gl = this.gl;
    this.decalCount = 0;
    this.decalHead = 0;
    this.decalData = new Float32Array(MAX_DECALS * 4 * 5);
    this.decalVao = gl.createVertexArray();
    gl.bindVertexArray(this.decalVao);
    this.decalVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.decalVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.decalData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    const idx = new Uint32Array(MAX_DECALS * 6);
    for (let i = 0; i < MAX_DECALS; i++) {
      const b = i * 4;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    this.decalIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.decalIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.decalDirty = false;
  }

  // A skid segment is a quad spanning from the previous contact point to the
  // current one, at the tyre's width.
  addSkidQuad(ax, ay, az, bx, by, bz, halfWidth, dirX, dirZ, alpha) {
    const i = this.decalHead;
    const nx = -dirZ * halfWidth, nz = dirX * halfWidth;
    const base = i * 20;
    const d = this.decalData;
    d[base + 0] = ax - nx; d[base + 1] = ay; d[base + 2] = az - nz; d[base + 3] = alpha; d[base + 4] = 0;
    d[base + 5] = bx - nx; d[base + 6] = by; d[base + 7] = bz - nz; d[base + 8] = alpha; d[base + 9] = 0;
    d[base + 10] = bx + nx; d[base + 11] = by; d[base + 12] = bz + nz; d[base + 13] = alpha; d[base + 14] = 0;
    d[base + 15] = ax + nx; d[base + 16] = ay; d[base + 17] = az + nz; d[base + 18] = alpha; d[base + 19] = 0;
    this.decalHead = (this.decalHead + 1) % MAX_DECALS;
    this.decalCount = Math.min(this.decalCount + 1, MAX_DECALS);
    this.decalDirty = true;
  }

  clearDecals() {
    this.decalCount = 0;
    this.decalHead = 0;
    this.decalData.fill(0);
    this.decalDirty = true;
  }

  // --- frame ----------------------------------------------------------------

  beginFrame(dt) {
    this.queueOpaque.length = 0;
    this.queueGlass.length = 0;
    this.glows = [];
    this.time += dt;
    this.cloudOffset += dt * 0.0035;
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  submit(mesh, matrix, opts) {
    if (!mesh) return;
    const call = opts || EMPTY_OPTS;
    if (call.transparent) this.queueGlass.push([mesh, matrix, call]);
    else this.queueOpaque.push([mesh, matrix, call]);
  }

  setAmbience(a) { Object.assign(this.ambience, a); }

  // Fit an orthographic light frustum around a box centred on `focus`.
  computeShadowMatrix(out, focus, radius, depth) {
    const a = this.ambience;
    const eye = [
      focus[0] + a.sunDir[0] * depth * 0.5,
      focus[1] + a.sunDir[1] * depth * 0.5,
      focus[2] + a.sunDir[2] * depth * 0.5,
    ];
    const view = m4.lookAt(m4.create(), eye, focus, [0, 1, 0]);
    const proj = m4.ortho(m4.create(), -radius, radius, -radius, radius, 0.1, depth);
    return m4.multiply(out, proj, view);
  }

  applyAmbienceUniforms(p) {
    const a = this.ambience;
    p.v3('uSunDir', a.sunDir);
    p.v3('uSunColor', a.sunColor);
    p.v3('uSkyZenith', a.skyZenith);
    p.v3('uSkyHorizon', a.skyHorizon);
    p.v3('uGroundTint', a.groundTint);
    p.v3('uCloudColor', a.cloudColor);
    p.f('uCloudAmount', a.cloudAmount);
    p.f('uCloudOffset', this.cloudOffset);
    p.v3('uFogColor', a.fogColor);
    p.f('uFogDensity', a.fogDensity);
  }

  render(camera, focus) {
    const gl = this.gl;
    const a = this.ambience;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    // --- shadow cascades ------------------------------------------------------
    if (this.settings.shadows) {
      const ahead = [
        focus[0] + camera.forward[0] * 9,
        focus[1] + 0.6,
        focus[2] + camera.forward[2] * 9,
      ];
      this.computeShadowMatrix(this.shadowMat0, ahead, 26, 190);
      this.computeShadowMatrix(this.shadowMat1, focus, 140, 460);

      const sp = this.shadowProgram.use();
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.6, 3.0);
      for (const [target, mat] of [[this.shadowNear, this.shadowMat0], [this.shadowFar, this.shadowMat1]]) {
        target.bind();
        sp.m4('uViewProj', mat);
        for (const [mesh, matrix, opts] of this.queueOpaque) {
          if (opts.noShadow) continue;
          sp.m4('uModel', matrix);
          mesh.draw();
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
    } else {
      m4.identity(this.shadowMat0);
      m4.identity(this.shadowMat1);
    }

    // --- scene ----------------------------------------------------------------
    this.scene.bind();
    gl.clearColor(a.fogColor[0], a.fogColor[1], a.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky first, without touching the depth buffer.
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    const skyP = this.skyProgram.use();
    this.applyAmbienceUniforms(skyP);
    skyP.m4('uInvViewProj', camera.invViewProj);
    skyP.v3('uCameraPos', camera.pos);
    this.quad.draw();
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    // Opaque geometry.
    const mp = this.mainProgram.use();
    this.applyAmbienceUniforms(mp);
    mp.m4('uViewProj', camera.viewProj);
    mp.v3('uCameraPos', camera.pos);
    mp.m4('uShadowMat0', this.shadowMat0);
    mp.m4('uShadowMat1', this.shadowMat1);
    mp.f('uShadowTexel', 1 / this.shadowNear.size);
    mp.f('uWetness', a.wetness);
    mp.f('uNight', a.night);
    mp.i('uShadow0', 0);
    mp.i('uShadow1', 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowNear.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowFar.texture);

    this.drawQueue(mp, this.queueOpaque);

    // Ground decals.
    if (this.decalCount > 0) {
      if (this.decalDirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.decalVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.decalData);
        this.decalDirty = false;
      }
      const dp = this.decalProgram.use();
      dp.m4('uViewProj', camera.viewProj);
      dp.v3('uColor', [0.035, 0.033, 0.033]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.decalVao);
      gl.drawElements(gl.TRIANGLES, MAX_DECALS * 6, gl.UNSIGNED_INT, 0);
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Glass.
    if (this.queueGlass.length) {
      const gp = this.mainProgram.use();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      // Culling stays on. Glass is a thin single shell, so drawing both faces
      // blends it twice at identical depth, and from the cockpit the inward
      // face would sit between the driver and the road.
      this.drawQueue(gp, this.queueGlass);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Particles and glows.
    this.drawParticles(camera);

    // Resolve MSAA before the post chain samples the scene.
    this.scene.resolve();

    // --- post -----------------------------------------------------------------
    this.postProcess(camera);
  }

  drawQueue(program, queue) {
    for (const [mesh, matrix, opts] of queue) {
      program.m4('uModel', matrix);
      m4.normalMatrix(this.normalMat, matrix);
      program.m3('uNormalMat', this.normalMat);
      program.f('uAlpha', opts.alpha !== undefined ? opts.alpha : 1.0);
      if (opts.paint) {
        program.v3('uPaintColor', opts.paint);
        program.v3('uStripeColor', opts.stripe || [0.92, 0.92, 0.90]);
        program.f('uLiveryStyle', opts.livery || 0);
        program.f('uPaintOverride', opts.roundel === false ? 0.35 : 1.0);
        program.f('uDirt', opts.dirt || 0);
      } else {
        program.f('uPaintOverride', 0);
        program.f('uDirt', 0);
      }
      if (opts.headlight) {
        program.f('uHeadlightOn', 1);
        program.v3('uHeadlightPos', opts.headlight.pos);
        program.v3('uHeadlightDir', opts.headlight.dir);
      } else {
        program.f('uHeadlightOn', 0);
      }
      mesh.draw();
    }
  }

  drawParticles(camera) {
    const gl = this.gl;
    const list = this.particles;
    const glows = this.glows;
    const total = Math.min(list.length + glows.length, MAX_PARTICLES);
    if (total === 0) return;

    const right = camera.right, up = camera.up;
    const data = this.particleData;
    let n = 0;
    const write = (pos, size, alpha, rot, tint) => {
      if (n >= MAX_PARTICLES) return;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let c = 0; c < 4; c++) {
        const o = (n * 4 + c) * 12;
        data[o] = pos[0]; data[o + 1] = pos[1]; data[o + 2] = pos[2];
        data[o + 3] = size; data[o + 4] = alpha; data[o + 5] = rot; data[o + 6] = 0;
        data[o + 7] = tint[0]; data[o + 8] = tint[1]; data[o + 9] = tint[2];
        data[o + 10] = corners[c][0]; data[o + 11] = corners[c][1];
      }
      n++;
    };

    for (const p of list) {
      const t = p.life / p.maxLife;
      const size = p.size * (1 + p.grow * t);
      const alpha = p.alpha * (1 - t) * (t < 0.12 ? t / 0.12 : 1);
      write(p.pos, size, alpha, p.rot, p.tint);
    }
    for (const g of glows) {
      const dx = g.pos[0] - camera.pos[0], dy = g.pos[1] - camera.pos[1], dz = g.pos[2] - camera.pos[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 240 * 240) continue;
      // Hold a minimum on-screen size, and fade rather than pop.
      const dist = Math.sqrt(d2);
      const size = Math.max(g.size, dist * 0.006);
      const fade = 1 - smoothstep(170, 240, dist);
      write(g.pos, size, g.alpha * fade, 0, g.tint);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * 4 * 12));

    const pp = this.particleProgram.use();
    pp.m4('uViewProj', camera.viewProj);
    pp.v3('uCamRight', right);
    pp.v3('uCamUp', up);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.particleVao);
    gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  postProcess(camera) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // Bright pass into the quarter-res buffer, then a separable blur.
    this.bloomA.bind();
    const bp = this.brightProgram.use();
    bp.i('uScene', 0);
    bp.f('uThreshold', 1.05);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.color);
    this.quad.draw();

    const blur = this.blurProgram.use();
    blur.i('uSource', 0);
    for (let pass = 0; pass < 2; pass++) {
      this.bloomB.bind();
      blur.v2('uDirection', 1.4 / this.bloomA.width, 0);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomA.color);
      this.quad.draw();

      this.bloomA.bind();
      blur.v2('uDirection', 0, 1.4 / this.bloomB.height);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomB.color);
      this.quad.draw();
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const cp = this.compositeProgram.use();
    cp.i('uScene', 0);
    cp.i('uBloom', 1);
    cp.f('uBloomStrength', this.settings.bloom);
    cp.f('uExposure', this.settings.exposure);
    cp.f('uVignette', this.settings.vignette);
    cp.f('uSpeedBlur', this.settings.motionBlur ? (camera.speedBlur || 0) : 0);
    cp.f('uTime', this.time);
    cp.f('uFlash', this.flash);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.color);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.color);
    this.quad.draw();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }
}

const EMPTY_OPTS = {};
