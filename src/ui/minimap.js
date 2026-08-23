/**
 * Circular minimap.
 *
 * Draws the course as a rotated, player-centred ribbon so the road ahead is
 * always up. Only the stretch of centreline near the rider is transformed each
 * frame, which keeps the cost flat no matter how long the course is.
 */

import * as THREE from 'three';
import { clamp, TAU } from '../engine/util.js';

/** Metres of course visible from edge to edge of the dial. */
const RANGE = 260;

export class Minimap {
  constructor(canvas, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.size = 0;
    this._world = new THREE.Vector3();
    this.resize();
  }

  resize() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const css = this.canvas.clientWidth || 160;
    const px = Math.round(css * dpr);
    if (px === this.canvas.width) return;
    this.canvas.width = px;
    this.canvas.height = px;
    this.size = px;
  }

  /**
   * @param player  BikePhysics
   * @param traffic Traffic manager (may be null)
   */
  update(player, traffic) {
    const ctx = this.ctx;
    const S = this.size;
    if (!S) return;
    const cx = S / 2;
    const cy = S / 2;
    const R = S / 2;
    const scale = R / (RANGE / 2);

    const track = this.track;
    const heading = player.heading;
    // Rotate the world so the rider's heading points up the dial. Track
    // heading is a clockwise-from-+Z bearing, so the map rotates with it
    // directly rather than by its negation.
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    const px = player.position.x;
    const pz = player.position.z;

    // World -> dial. +Z forward becomes "up" (negative canvas Y).
    const project = (wx, wz, out) => {
      const dx = wx - px;
      const dz = wz - pz;
      // Inverse of the heading rotation. The lateral axis is negated because
      // positive `lateral` is the rider's left (see world/track.js); without
      // it the dial would come out mirrored against what the player sees.
      const fwd = dx * sinH + dz * cosH;
      const right = -(dx * cosH - dz * sinH);
      out[0] = cx + right * scale;
      out[1] = cy - fwd * scale;
      return out;
    };

    ctx.save();
    ctx.clearRect(0, 0, S, S);

    // Clip everything to the dial.
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    ctx.fillStyle = 'rgba(18, 28, 38, 0.72)';
    ctx.fillRect(0, 0, S, S);

    // ---- road ribbon ------------------------------------------------
    const p = [0, 0];
    const halfSpan = RANGE * 0.75;
    const i0 = Math.max(0, Math.floor((player.s - halfSpan) / track.ds));
    const i1 = Math.min(track.count - 1, Math.ceil((player.s + halfSpan) / track.ds));

    if (i1 > i0) {
      // Wide dark casing first, then a lighter fill: reads as a road, not a line.
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        project(track.x[i], track.z[i], p);
        if (i === i0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.strokeStyle = 'rgba(150, 168, 186, 0.35)';
      ctx.lineWidth = track.halfWidth * 2 * scale + S * 0.016;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(96, 108, 122, 0.95)';
      ctx.lineWidth = Math.max(2, track.halfWidth * 2 * scale);
      ctx.stroke();

      // Centre line.
      ctx.strokeStyle = 'rgba(240, 200, 76, 0.9)';
      ctx.lineWidth = Math.max(1, S * 0.008);
      ctx.setLineDash([S * 0.03, S * 0.03]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ---- finish line -------------------------------------------------
    const toFinish = track.length - player.s;
    if (toFinish < halfSpan) {
      const fi = track.count - 1;
      project(track.x[fi], track.z[fi], p);
      ctx.strokeStyle = '#6bf0ad';
      ctx.lineWidth = S * 0.026;
      ctx.beginPath();
      ctx.arc(p[0], p[1], S * 0.07, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(107, 240, 173, 0.28)';
      ctx.fill();
    }

    // ---- traffic ------------------------------------------------------
    if (traffic) {
      traffic.forEachActive((v) => {
        const rel = Math.abs(v.s - player.s);
        if (rel > halfSpan) return;
        const w = track.toWorld(v.s, v.lateral, this._world);
        project(w.x, w.z, p);
        ctx.beginPath();
        ctx.arc(p[0], p[1], S * 0.022, 0, TAU);
        ctx.fillStyle = v.oncoming ? 'rgba(255, 138, 92, 0.95)' : 'rgba(126, 196, 255, 0.95)';
        ctx.fill();
      });
    }

    // ---- player -------------------------------------------------------
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -S * 0.085);
    ctx.lineTo(S * 0.055, S * 0.055);
    ctx.lineTo(0, S * 0.022);
    ctx.lineTo(-S * 0.055, S * 0.055);
    ctx.closePath();
    ctx.fillStyle = '#6bf0ad';
    ctx.shadowColor = 'rgba(107, 240, 173, 0.9)';
    ctx.shadowBlur = S * 0.06;
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }
}
