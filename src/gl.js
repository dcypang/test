// ---------------------------------------------------------------------------
// gl.js - a very small WebGL2 wrapper: programs, meshes, render targets.
// No external dependencies; everything the renderer needs lives here.
// ---------------------------------------------------------------------------

// One interleaved vertex format is used for the whole game:
//   position(3) normal(3) color(3) material(3) flag(1) = 13 floats
const VERTEX_FLOATS = 13;
const VERTEX_BYTES = VERTEX_FLOATS * 4;

// Surface behaviour flags consumed by the fragment shader.
const FLAG_DEFAULT = 0;
const FLAG_PAINT = 1;   // clear-coated car paint (second specular lobe)
const FLAG_GLASS = 2;   // tinted, strongly reflective, semi transparent
const FLAG_FOLIAGE = 3; // cheap wrap lighting so trees are not black
const FLAG_ROAD = 4;    // wet-ish asphalt: sharper reflections at grazing angles
const FLAG_UNLIT = 5;   // emissive panels, light lenses, marker arrows
const FLAG_CABIN = 6;   // inside the car: sky and sun arrive through one window

function createContext(canvas) {
  const opts = {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  };
  const gl = canvas.getContext('webgl2', opts);
  if (!gl) throw new Error('WebGL2 is required to run this game.');
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  return gl;
}

function compileShader(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`Shader compile failed (${label}):\n${log}\n${numbered}`);
  }
  return sh;
}

class Program {
  constructor(gl, vsSrc, fsSrc, label = 'program') {
    this.gl = gl;
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, label + '.vert');
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, label + '.frag');
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Program link failed (${label}): ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.handle = p;
    this.uniforms = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      this.uniforms[name] = gl.getUniformLocation(p, name);
    }
  }

  use() { this.gl.useProgram(this.handle); return this; }

  m4(name, value) {
    const loc = this.uniforms[name];
    if (loc) this.gl.uniformMatrix4fv(loc, false, value);
    return this;
  }

  m3(name, value) {
    const loc = this.uniforms[name];
    if (loc) this.gl.uniformMatrix3fv(loc, false, value);
    return this;
  }

  v3(name, value) {
    const loc = this.uniforms[name];
    if (loc) this.gl.uniform3f(loc, value[0], value[1], value[2]);
    return this;
  }

  v4(name, a, b, c, d) {
    const loc = this.uniforms[name];
    if (loc) this.gl.uniform4f(loc, a, b, c, d);
    return this;
  }

  v2(name, a, b) {
    const loc = this.uniforms[name];
    if (loc) this.gl.uniform2f(loc, a, b);
    return this;
  }

  f(name, value) {
    const loc = this.uniforms[name];
    if (loc) this.gl.uniform1f(loc, value);
    return this;
  }

  i(name, value) {
    const loc = this.uniforms[name];
    if (loc) this.gl.uniform1i(loc, value);
    return this;
  }
}

// A mesh is one interleaved VBO + index buffer wrapped in a VAO.
class Mesh {
  constructor(gl, data, indices) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    // location 0 position, 1 normal, 2 color, 3 material, 4 flag
    const layout = [[0, 3], [1, 3], [2, 3], [3, 3], [4, 1]];
    let offset = 0;
    for (const [loc, size] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, VERTEX_BYTES, offset);
      offset += size * 4;
    }

    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.count = indices.length;
    this.indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

    gl.bindVertexArray(null);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, this.indexType, 0);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
  }
}

function meshFromBuilder(gl, builder) {
  return new Mesh(gl, builder.vertexArray(), builder.indexArray());
}

// Depth-only render target used for the sun shadow map.
class ShadowTarget {
  constructor(gl, size) {
    this.gl = gl;
    this.size = size;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Hardware PCF: sampler2DShadow returns a filtered 0..1 visibility term.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.texture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.size, this.size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }
}

// Colour + depth target for the main scene so post-processing can run.
//
// The scene is drawn into a multisampled renderbuffer and then resolved into a
// plain texture. Without this the canvas `antialias: true` does nothing at all
// - it only ever applied to the default framebuffer, which the post chain
// bypasses - and every edge in the game crawls with aliasing.
class SceneTarget {
  constructor(gl, width, height, samples = 4) {
    this.gl = gl;
    this.requestedSamples = samples;
    this.fbo = gl.createFramebuffer();
    this.color = gl.createTexture();
    this.msaaFbo = gl.createFramebuffer();
    this.msaaColor = gl.createRenderbuffer();
    this.msaaDepth = gl.createRenderbuffer();
    this.resize(width, height);
  }

  resize(width, height) {
    const gl = this.gl;
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);

    // Resolve target: a normal texture the post passes can sample.
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    let internal = gl.RGBA16F, format = gl.RGBA, type = gl.HALF_FLOAT;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.width, this.height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      // Half-float colour is unavailable on some drivers; fall back to 8 bit.
      internal = gl.RGBA8;
      gl.bindTexture(gl.TEXTURE_2D, this.color);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
    }

    // Multisampled render target, matching the resolve target's format.
    const maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
    this.samples = Math.min(this.requestedSamples, maxSamples);
    if (this.samples > 1) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, internal, this.width, this.height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, this.width, this.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msaaColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msaaDepth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) this.samples = 0;
    }

    if (this.samples <= 1) {
      // No MSAA available: attach a plain depth buffer to the resolve FBO.
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msaaDepth);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Bind for drawing the scene.
  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.samples > 1 ? this.msaaFbo : this.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  // Resolve the multisampled buffer into the sampleable texture.
  resolve() {
    if (this.samples <= 1) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }
}

// Simple single-channel colour target (used for the bloom blur chain).
class ColorTarget {
  constructor(gl, width, height) {
    this.gl = gl;
    this.fbo = gl.createFramebuffer();
    this.color = gl.createTexture();
    this.resize(width, height);
  }

  resize(width, height) {
    const gl = this.gl;
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }
}

// Fullscreen triangle used by every post-processing pass.
function createFullscreenQuad(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
