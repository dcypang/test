/**
 * Geometry helpers.
 *
 * Scenery props are built from primitives, tinted per-part with a vertex colour
 * attribute, and merged into a single geometry. That lets a tree with a brown
 * trunk and green canopy be drawn as one instance in one draw call, which is
 * what makes thousands of props affordable on a phone.
 */

import * as THREE from 'three';

const ATTRS = ['position', 'normal', 'uv', 'color'];

/** Give every vertex of `geo` the same colour. Returns `geo`. */
export function colorize(geo, color) {
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Multiply existing vertex colours by a factor — used for cheap shading variety. */
export function shadeVertices(geo, fn) {
  const col = geo.attributes.color;
  const pos = geo.attributes.position;
  if (!col) return geo;
  for (let i = 0; i < col.count; i++) {
    const m = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    col.setXYZ(i, col.getX(i) * m, col.getY(i) * m, col.getZ(i) * m);
  }
  col.needsUpdate = true;
  return geo;
}

/**
 * Merge indexed/non-indexed geometries that share the position/normal/uv/color
 * attribute set. Anything missing `uv` or `color` gets a zero/white default so
 * the merged buffers stay consistent.
 */
export function mergeGeometries(geometries) {
  const list = geometries.filter(Boolean);
  if (list.length === 0) return new THREE.BufferGeometry();
  if (list.length === 1) return list[0];

  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of list) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const out = new THREE.BufferGeometry();
  const buffers = {
    position: new Float32Array(totalVerts * 3),
    normal: new Float32Array(totalVerts * 3),
    uv: new Float32Array(totalVerts * 2),
    color: new Float32Array(totalVerts * 3),
  };
  const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const count = g.attributes.position.count;

    buffers.position.set(g.attributes.position.array.subarray(0, count * 3), vOffset * 3);
    buffers.normal.set(g.attributes.normal.array.subarray(0, count * 3), vOffset * 3);

    if (g.attributes.uv) {
      buffers.uv.set(g.attributes.uv.array.subarray(0, count * 2), vOffset * 2);
    }
    if (g.attributes.color) {
      buffers.color.set(g.attributes.color.array.subarray(0, count * 3), vOffset * 3);
    } else {
      buffers.color.fill(1, vOffset * 3, (vOffset + count) * 3);
    }

    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) indices[iOffset + i] = src[i] + vOffset;
      iOffset += src.length;
    } else {
      for (let i = 0; i < count; i++) indices[iOffset + i] = i + vOffset;
      iOffset += count;
    }
    vOffset += count;
  }

  for (const name of ATTRS) {
    const size = name === 'uv' ? 2 : 3;
    out.setAttribute(name, new THREE.BufferAttribute(buffers[name], size));
  }
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.computeBoundingSphere();

  // The sources were built purely to be merged; free them now.
  for (const g of list) g.dispose();
  return out;
}

/**
 * Push vertices around with a noise function to knock the primitive look off
 * rocks and terrain blobs. `fn(x, y, z)` returns a displacement scalar applied
 * along the vertex normal direction from the origin.
 */
export function distort(geo, fn) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length() || 1;
    const d = fn(v.x, v.y, v.z);
    v.multiplyScalar((len + d) / len);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Rounded box built from a scaled, subdivided box — cheaper than a real bevel. */
export function roundedBox(w, h, d, radius = 0.1, segs = 2) {
  const geo = new THREE.BoxGeometry(w, h, d, segs, segs, segs);
  const pos = geo.attributes.position;
  const hw = w / 2 - radius;
  const hh = h / 2 - radius;
  const hd = d / 2 - radius;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    inner.set(
      THREE.MathUtils.clamp(v.x, -hw, hw),
      THREE.MathUtils.clamp(v.y, -hh, hh),
      THREE.MathUtils.clamp(v.z, -hd, hd),
    );
    v.sub(inner).normalize().multiplyScalar(radius).add(inner);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build an InstancedMesh from a list of {position, rotationY, scale, tilt}
 * placements. Returns null when the list is empty.
 */
export function instanceFrom(geometry, material, placements, { castShadow = false } = {}) {
  if (!placements.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (let i = 0; i < placements.length; i++) {
    const pl = placements[i];
    p.set(pl.x, pl.y, pl.z);
    e.set(pl.tiltX || 0, pl.rotationY || 0, pl.tiltZ || 0, 'YXZ');
    q.setFromEuler(e);
    const sc = pl.scale ?? 1;
    s.set(pl.scaleX ?? sc, pl.scaleY ?? sc, pl.scaleZ ?? sc);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  mesh.computeBoundingSphere();
  return mesh;
}
