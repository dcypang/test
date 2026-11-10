// Post-processing for the 3D view: the scene is rendered in linear HDR to an off-screen target,
// then finished in screen space with ambient occlusion, depth of field, aerial perspective,
// bloom, filmic (ACES) tone mapping, vignette and grain.
'use strict';

SG.Post = class Post {
  constructor(renderer) {
    const T = THREE;
    this.r = renderer;
    this.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new T.Mesh(new T.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.qscene = new T.Scene(); this.qscene.add(this.quad);
    this.opts = { ao: true, bloom: true, msaa: 4 };
    this.rt = {};
    const VS = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const mk = (uniforms, fs) => new T.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false });
    const IGN = 'float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }\n';

    // ambient occlusion from the depth buffer (scalable ambient obscurance); the sample
    // radius grows with distance so it shades eaves up close and whole blocks from afar
    this.aoMat = mk({ tDepth: { value: null }, uInvProj: { value: new T.Matrix4() }, uProj: { value: new T.Matrix4() }, uIntensity: { value: 1 } }, IGN + `
      uniform sampler2D tDepth; uniform mat4 uInvProj, uProj; uniform float uIntensity; varying vec2 vUv;
      vec3 viewPos(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
      void main(){
        float d = texture2D(tDepth, vUv).x;
        if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
        vec3 P = viewPos(vUv);
        vec3 N = normalize(cross(dFdx(P), dFdy(P)));
        if (N.z < 0.0) N = -N;
        float R = clamp(-P.z * 0.035, 0.7, 45.0);
        float rUv = R * uProj[1][1] * 0.5 / -P.z;
        float aspect = uProj[1][1] / uProj[0][0];
        float ang = ign(gl_FragCoord.xy) * 6.2831853;
        float ao = 0.0;
        const int NS = 11;
        for (int i = 0; i < NS; i++) {
          float t = (float(i) + 0.5) / float(NS);
          float a = ang + t * 6.2831853 * 2.6;
          vec2 o = vec2(cos(a) / aspect, sin(a)) * t * rUv;
          vec3 v = viewPos(vUv + o) - P;
          float vv = dot(v, v), vn = dot(v, N);
          float f = max(R * R - vv, 0.0);
          ao += f * f * f * max((vn - 0.04 * R) / (vv + 0.01 * R * R), 0.0);
        }
        float A = max(0.0, 1.0 - ao * 5.0 * uIntensity / (pow(R, 6.0) * float(NS)));
        gl_FragColor = vec4(A, A, A, 1.0);
      }`);
    this.aoMat.extensions = { derivatives: true };
    // depth-aware blur so occlusion doesn't bleed across edges
    this.aoBlurMat = mk({ tAO: { value: null }, tDepth: { value: null }, uDir: { value: new T.Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 } }, `
      uniform sampler2D tAO, tDepth; uniform vec2 uDir; uniform float uNear, uFar; varying vec2 vUv;
      float lin(vec2 uv){ float d = texture2D(tDepth, uv).x; return uNear * uFar / (uFar - d * (uFar - uNear)); }
      void main(){
        float z0 = lin(vUv), sum = 0.0, wsum = 0.0;
        for (int i = -4; i <= 4; i++) {
          vec2 uv = vUv + uDir * float(i);
          float w = exp(-float(i * i) / 10.0) * exp(-abs(lin(uv) - z0) / (0.04 * z0 + 0.15));
          sum += texture2D(tAO, uv).r * w; wsum += w;
        }
        gl_FragColor = vec4(vec3(sum / wsum), 1.0);
      }`);
    this.brightMat = mk({ tColor: { value: null }, uExposure: { value: 1 }, uThresh: { value: 1.1 } }, `
      uniform sampler2D tColor; uniform float uExposure, uThresh; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tColor, vUv).rgb * uExposure;
        float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(min(c * smoothstep(uThresh, uThresh + 0.7, l), vec3(24.0)), 1.0);
      }`);
    this.blurMat = mk({ tColor: { value: null }, uDir: { value: new T.Vector2() } }, `
      uniform sampler2D tColor; uniform vec2 uDir; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tColor, vUv).rgb * 0.227027;
        c += (texture2D(tColor, vUv + uDir * 1.3846).rgb + texture2D(tColor, vUv - uDir * 1.3846).rgb) * 0.316216;
        c += (texture2D(tColor, vUv + uDir * 3.2308).rgb + texture2D(tColor, vUv - uDir * 3.2308).rgb) * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`);
    this.finalU = {
      tColor: { value: null }, tDepth: { value: null }, tAO: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null },
      uInvViewProj: { value: new T.Matrix4() }, uCamPos: { value: new T.Vector3() }, uTexel: { value: new T.Vector2() },
      uFogCol: { value: new T.Color() }, uSunCol: { value: new T.Color() }, uSunDir: { value: new T.Vector3(0, 1, 0) }, uFogFar: { value: 10000 },
      uFocus: { value: 1000 }, uMaxCoC: { value: 0 }, uExposure: { value: 1 }, uAO: { value: 0 }, uBloom: { value: 0 }, uVignette: { value: 0.3 }, uTime: { value: 0 },
    };
    this.finalMat = mk(this.finalU, IGN + `
      uniform sampler2D tColor, tDepth, tAO, tB1, tB2, tB3;
      uniform mat4 uInvViewProj; uniform vec3 uCamPos, uFogCol, uSunCol, uSunDir; uniform vec2 uTexel;
      uniform float uFogFar, uFocus, uMaxCoC, uExposure, uAO, uBloom, uVignette, uTime;
      varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main(){
        float d = texture2D(tDepth, vUv).x;
        bool sky = d >= 0.99999;
        vec4 w4 = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        vec3 ray = w4.xyz / w4.w - uCamPos;
        float dist = length(ray); vec3 dir = ray / max(dist, 1e-3);
        // depth of field: sharp around the point the camera orbits, soft in front and behind
        float coc = uMaxCoC * (sky ? 0.6 : clamp(abs(dist - uFocus) / uFocus - 0.4, 0.0, 1.0));
        vec3 col = texture2D(tColor, vUv).rgb;
        if (coc > 0.6) {
          float a0 = ign(gl_FragCoord.xy) * 6.2831853;
          for (int i = 0; i < 14; i++) {
            float t = (float(i) + 0.5) / 14.0, a = a0 + float(i) * 2.39996;
            col += min(texture2D(tColor, vUv + vec2(cos(a), sin(a)) * sqrt(t) * coc * uTexel).rgb, vec3(2.5)); // clamp so small lights don't sparkle
          }
          col /= 15.0;
        }
        if (!sky) {
          col *= mix(1.0, texture2D(tAO, vUv).r, uAO);
          // aerial perspective: distant ground fades toward the horizon colour, warmer toward the sun
          float f = 1.0 - exp(-pow(dist / uFogFar, 1.35) * 2.0);
          float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 6.0);
          col = mix(col, mix(uFogCol, uFogCol + uSunCol * 0.35, sunAmt), f);
        }
        col += (texture2D(tB1, vUv).rgb * 0.5 + texture2D(tB2, vUv).rgb * 0.35 + texture2D(tB3, vUv).rgb * 0.3) * uBloom / max(uExposure, 1e-3);
        col = aces(col * uExposure);
        col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.14); // a touch more saturation
        vec2 q = vUv - 0.5;
        col *= 1.0 - uVignette * pow(length(q) * 1.3, 2.6);
        col = pow(col, vec3(1.0 / 2.2));
        col += (ign(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 160.0;
        gl_FragColor = vec4(col, 1.0);
      }`);
  }

  setSize(w, h) {
    const T = THREE;
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    for (const k in this.rt) { if (this.rt[k].depthTexture) this.rt[k].depthTexture.dispose(); this.rt[k].dispose(); }
    const hdr = (ww, hh, extra) => new T.WebGLRenderTarget(Math.max(1, ww), Math.max(1, hh),
      Object.assign({ type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false }, extra));
    const depth = new T.DepthTexture(w, h);
    depth.minFilter = depth.magFilter = T.NearestFilter;
    this.rt.scene = hdr(w, h, { depthBuffer: true, depthTexture: depth, samples: this.opts.msaa });
    const hw = w >> 1, hh = h >> 1;
    const ldr = () => new T.WebGLRenderTarget(Math.max(1, hw), Math.max(1, hh), { minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false });
    this.rt.ao = ldr(); this.rt.ao2 = ldr();
    this.rt.b1 = hdr(hw, hh); this.rt.b1t = hdr(hw, hh);
    this.rt.b2 = hdr(w >> 2, h >> 2); this.rt.b2t = hdr(w >> 2, h >> 2);
    this.rt.b3 = hdr(w >> 3, h >> 3); this.rt.b3t = hdr(w >> 3, h >> 3);
    this.w = w; this.h = h;
  }
  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qscene, this.cam);
  }
  // p: { exposure, fogCol, sunCol, sunDir, fogFar, focus, maxCoC, ao, bloom, vignette, time }
  render(scene, camera, p) {
    const r = this.r, rt = this.rt;
    r.setRenderTarget(rt.scene);
    r.render(scene, camera);
    const depth = rt.scene.depthTexture;
    const useAO = this.opts.ao && p.ao > 0, useBloom = this.opts.bloom && p.bloom > 0;
    if (useAO) {
      const u = this.aoMat.uniforms;
      u.tDepth.value = depth; u.uProj.value.copy(camera.projectionMatrix); u.uInvProj.value.copy(camera.projectionMatrixInverse);
      this.pass(this.aoMat, rt.ao);
      const b = this.aoBlurMat.uniforms;
      b.tDepth.value = depth; b.uNear.value = camera.near; b.uFar.value = camera.far;
      b.tAO.value = rt.ao.texture; b.uDir.value.set(1 / rt.ao.width, 0); this.pass(this.aoBlurMat, rt.ao2);
      b.tAO.value = rt.ao2.texture; b.uDir.value.set(0, 1 / rt.ao.height); this.pass(this.aoBlurMat, rt.ao);
    }
    if (useBloom) {
      const u = this.brightMat.uniforms;
      u.tColor.value = rt.scene.texture; u.uExposure.value = p.exposure;
      this.pass(this.brightMat, rt.b1t);
      const bu = this.blurMat.uniforms, step = (src, tmp, dst) => {
        bu.tColor.value = src.texture; bu.uDir.value.set(1 / tmp.width, 0); this.pass(this.blurMat, tmp);
        bu.tColor.value = tmp.texture; bu.uDir.value.set(0, 1 / dst.height); this.pass(this.blurMat, dst);
      };
      step(rt.b1t, rt.b2t, rt.b1);   // half res (horizontal pass lands in a quarter-res buffer: cheap extra spread)
      step(rt.b1, rt.b2t, rt.b2);
      step(rt.b2, rt.b3t, rt.b3);
    }
    const u = this.finalU;
    u.tColor.value = rt.scene.texture; u.tDepth.value = depth; u.tAO.value = rt.ao.texture;
    u.tB1.value = rt.b1.texture; u.tB2.value = rt.b2.texture; u.tB3.value = rt.b3.texture;
    u.uInvViewProj.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    u.uCamPos.value.copy(camera.position);
    u.uTexel.value.set(1 / this.w, 1 / this.h);
    u.uFogCol.value.copy(p.fogCol); u.uSunCol.value.copy(p.sunCol); u.uSunDir.value.copy(p.sunDir); u.uFogFar.value = p.fogFar;
    u.uFocus.value = p.focus; u.uMaxCoC.value = p.maxCoC; u.uExposure.value = p.exposure;
    u.uAO.value = useAO ? p.ao : 0; u.uBloom.value = useBloom ? p.bloom : 0; u.uVignette.value = p.vignette; u.uTime.value = p.time;
    this.pass(this.finalMat, null);
  }
};
