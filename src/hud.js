// ---------------------------------------------------------------------------
// hud.js - the 2D overlay: tacho, speed, gear, timing, minimap, navigation.
// Drawn on a separate canvas above the WebGL view.
// ---------------------------------------------------------------------------

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function formatDelta(seconds) {
  if (!isFinite(seconds)) return '';
  const sign = seconds >= 0 ? '+' : '-';
  const a = Math.abs(seconds);
  return `${sign}${a.toFixed(3)}`;
}

class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.messages = [];
    this.font = '"DIN Alternate", "Bahnschrift", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif';
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  message(text, duration = 2.5, kind = 'info') {
    this.messages.push({ text, time: 0, duration, kind });
  }

  update(dt) {
    for (const m of this.messages) m.time += dt;
    this.messages = this.messages.filter((m) => m.time < m.duration);
  }

  begin() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.textBaseline = 'alphabetic';
  }

  // --- primitives -----------------------------------------------------------

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  panel(x, y, w, h, alpha = 0.42) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = `rgba(8, 10, 14, ${alpha})`;
    this.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  text(str, x, y, size, color = '#fff', align = 'left', weight = 600) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${this.font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(str, x, y);
  }

  // --- tachometer -----------------------------------------------------------

  drawTacho(cx, cy, radius, rpm, gear, speedKmh, throttle, brake) {
    const ctx = this.ctx;
    const start = Math.PI * 0.78;
    const end = Math.PI * 2.30;
    const maxRpm = 8500;
    const redline = 7900;

    ctx.save();
    // Dial face.
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 12, 0, TAU);
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Track arc.
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Redline band.
    const redStart = start + (end - start) * (redline / maxRpm);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, redStart, end);
    ctx.strokeStyle = 'rgba(220,40,30,0.55)';
    ctx.lineWidth = 12;
    ctx.stroke();

    // Value arc.
    const t = clamp(rpm / maxRpm, 0, 1);
    const angle = start + (end - start) * t;
    const grad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    grad.addColorStop(0, '#39d1ff');
    grad.addColorStop(0.62, '#7bff6a');
    grad.addColorStop(0.86, '#ffd53d');
    grad.addColorStop(1, '#ff3b30');
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, angle);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 12;
    ctx.stroke();

    // Ticks.
    for (let i = 0; i <= 8; i++) {
      const tt = i / 8.5;
      const a = start + (end - start) * tt;
      const inner = radius - 12, outer = radius - 20;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.strokeStyle = i >= 8 ? 'rgba(255,80,60,0.9)' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      this.text(String(i), cx + Math.cos(a) * (outer - 14) - 4, cy + Math.sin(a) * (outer - 14) + 5, 12, 'rgba(255,255,255,0.55)', 'center', 500);
    }

    // Needle.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(radius - 18, -2.4);
    ctx.lineTo(radius - 18, 2.4);
    ctx.closePath();
    ctx.fillStyle = '#ff4d3d';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, TAU);
    ctx.fillStyle = '#161a20';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.stroke();

    // Gear and speed.
    this.text(gear, cx, cy + 18, 54, '#ffffff', 'center', 700);
    this.text(String(Math.round(Math.abs(speedKmh))), cx, cy + radius + 6, 34, '#ffffff', 'center', 700);
    this.text('km/h', cx, cy + radius + 24, 13, 'rgba(255,255,255,0.6)', 'center', 500);

    // Shift lights across the top of the dial.
    const shiftT = clamp((rpm - 5900) / (redline - 5900), 0, 1);
    for (let i = 0; i < 8; i++) {
      const on = shiftT > (i + 0.5) / 8;
      const a = -Math.PI * 0.78 + (i / 7) * Math.PI * 0.56;
      const px = cx + Math.cos(a - Math.PI / 2 + Math.PI) * 0;
      const lx = cx - 62 + i * 17.5;
      const ly = cy - radius - 16;
      ctx.beginPath();
      ctx.arc(lx, ly, 5, 0, TAU);
      const col = i < 4 ? '#3dff6a' : (i < 6 ? '#ffd21f' : '#ff2d1f');
      ctx.fillStyle = on ? col : 'rgba(255,255,255,0.12)';
      ctx.fill();
      if (on) { ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0; }
    }

    // Pedal bars.
    const barX = cx + radius + 26;
    const barY = cy - 34;
    for (const [val, col, off] of [[throttle, '#4ade80', 0], [brake, '#ef4444', 14]]) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      this.roundRect(barX + off, barY, 8, 68, 4); ctx.fill();
      ctx.fillStyle = col;
      const hgt = 68 * clamp(val, 0, 1);
      this.roundRect(barX + off, barY + 68 - hgt, 8, hgt, 4); ctx.fill();
    }
    ctx.restore();
  }

  // --- minimap --------------------------------------------------------------

  drawMinimap(x, y, size, spline, cars, player, extra) {
    const ctx = this.ctx;
    this.panel(x, y, size, size, 0.45);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of spline.points) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
    }
    const pad = 16;
    const spanX = maxX - minX || 1, spanZ = maxZ - minZ || 1;
    const scale = Math.min((size - pad * 2) / spanX, (size - pad * 2) / spanZ);
    const ox = x + size / 2 - ((minX + maxX) / 2) * scale;
    const oy = y + size / 2 - ((minZ + maxZ) / 2) * scale;
    const px = (p) => [ox + p[0] * scale, oy + p[2] * scale];

    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < spline.count; i++) {
      const [sx, sy] = px(spline.points[i]);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    if (spline.closed) ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,34,42,0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    if (extra && extra.destination) {
      const [dx, dy] = px([extra.destination.x, 0, extra.destination.z]);
      ctx.beginPath();
      ctx.arc(dx, dy, 6, 0, TAU);
      ctx.fillStyle = '#22d3ee';
      ctx.fill();
      ctx.strokeStyle = '#083344';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (extra && extra.lights) {
      for (const l of extra.lights) {
        const [lx, ly] = px([l.pos[0], 0, l.pos[2]]);
        ctx.beginPath();
        ctx.arc(lx, ly, 3.2, 0, TAU);
        ctx.fillStyle = l.state === 'red' ? '#ef4444' : (l.state === 'amber' ? '#f59e0b' : '#22c55e');
        ctx.fill();
      }
    }

    for (const car of cars) {
      const [cxp, cyp] = px(car.pos);
      const isPlayer = car === player;
      ctx.save();
      ctx.translate(cxp, cyp);
      ctx.rotate(-car.yaw + Math.PI);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      const c = car.livery ? car.livery.paint : [0.6, 0.6, 0.6];
      ctx.fillStyle = isPlayer ? '#ffffff' : `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`;
      ctx.fill();
      if (isPlayer) { ctx.strokeStyle = '#111'; ctx.lineWidth = 1.4; ctx.stroke(); }
      ctx.restore();
    }
    ctx.restore();
  }

  // --- race hud -------------------------------------------------------------

  drawRace(state) {
    const ctx = this.ctx;
    const W = this.width, H = this.height;
    const v = state.player.vehicle;

    this.drawTacho(W - 130, H - 110, 78, v.rpm, v.gearLabel, v.speedKmh, v.throttle, v.brake);

    // Position and lap.
    this.panel(24, 24, 190, 84);
    this.text('POS', 40, 50, 13, 'rgba(255,255,255,0.55)', 'left', 600);
    this.text(`${state.position}`, 40, 92, 42, '#fff', 'left', 700);
    this.text(`/${state.fieldSize}`, 78, 92, 20, 'rgba(255,255,255,0.55)', 'left', 600);
    this.text('LAP', 140, 50, 13, 'rgba(255,255,255,0.55)', 'left', 600);
    this.text(`${Math.min(state.lap, state.totalLaps)}`, 140, 92, 42, '#fff', 'left', 700);
    this.text(`/${state.totalLaps}`, 176, 92, 20, 'rgba(255,255,255,0.55)', 'left', 600);

    // Timing.
    this.panel(24, 118, 250, 108);
    this.text('CURRENT', 40, 142, 12, 'rgba(255,255,255,0.5)', 'left', 600);
    this.text(formatTime(state.currentLapTime), 40, 170, 26, '#fff', 'left', 700);
    this.text('BEST', 40, 194, 12, 'rgba(255,255,255,0.5)', 'left', 600);
    this.text(formatTime(state.bestLapTime), 40, 216, 20, '#8ef2a0', 'left', 600);
    if (isFinite(state.gapAhead)) {
      this.text('GAP AHEAD', 168, 194, 11, 'rgba(255,255,255,0.5)', 'left', 600);
      this.text(state.gapAhead > 0 ? `-${state.gapAhead.toFixed(1)}s` : '--', 168, 216, 18, '#ffd166', 'left', 600);
    }

    this.drawMinimap(W - 214, 24, 190, state.trackSpline, state.cars, state.player, null);

    // Standings.
    const rows = Math.min(state.standings.length, 8);
    const sx = 24, sy = H - 34 - rows * 22;
    this.panel(sx, sy - 22, 230, rows * 22 + 30, 0.38);
    this.text('POSITIONS', sx + 14, sy - 4, 11, 'rgba(255,255,255,0.5)', 'left', 600);
    for (let i = 0; i < rows; i++) {
      const car = state.standings[i];
      const y = sy + 18 + i * 22;
      const me = car === state.player;
      const c = car.livery.paint;
      ctx.fillStyle = `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`;
      this.roundRect(sx + 12, y - 11, 5, 14, 2); ctx.fill();
      this.text(`${i + 1}`, sx + 26, y, 14, me ? '#fff' : 'rgba(255,255,255,0.7)', 'left', 700);
      this.text(car.name, sx + 46, y, 14, me ? '#fff' : 'rgba(255,255,255,0.7)', 'left', me ? 700 : 500);
      if (car.finished) this.text('FIN', sx + 200, y, 12, '#8ef2a0', 'right', 600);
      else if (i > 0) this.text(`+${car.gapToLeader.toFixed(1)}`, sx + 216, y, 12, 'rgba(255,255,255,0.5)', 'right', 500);
    }

    this.drawFlags(state);
    this.drawMessages();
  }

  drawFlags(state) {
    const W = this.width;
    if (state.countdown > 0) {
      const n = Math.ceil(state.countdown);
      const ctx = this.ctx;
      // Five red lights, like the real thing.
      const lit = 5 - Math.min(5, Math.floor(state.countdown));
      const cx = W / 2, cy = 110;
      this.panel(cx - 150, cy - 44, 300, 88, 0.55);
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(cx - 108 + i * 54, cy, 20, 0, TAU);
        const on = i < lit;
        ctx.fillStyle = on ? '#ff2418' : 'rgba(255,255,255,0.10)';
        ctx.fill();
        if (on) { ctx.shadowColor = '#ff2418'; ctx.shadowBlur = 26; ctx.fill(); ctx.shadowBlur = 0; }
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    if (state.wrongWay) {
      this.text('WRONG WAY', W / 2, 190, 40, '#ff4d3d', 'center', 800);
    }
  }

  // --- drive home hud -------------------------------------------------------

  drawDrive(state) {
    const ctx = this.ctx;
    const W = this.width, H = this.height;
    const v = state.player.vehicle;

    this.drawTacho(W - 130, H - 110, 78, v.rpm, v.gearLabel, v.speedKmh, v.throttle, v.brake);

    // Speed limit roundel plus the current road.
    const lx = 60, ly = 66;
    ctx.beginPath();
    ctx.arc(lx, ly, 34, 0, TAU);
    ctx.fillStyle = '#f2f2ef';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = state.speeding ? '#ff3b30' : '#c62828';
    ctx.stroke();
    this.text(String(state.speedLimit), lx, ly + 11, 30, '#15171c', 'center', 800);
    this.text(state.roadName, lx + 52, ly - 4, 18, '#fff', 'left', 700);
    this.text(`${(state.distanceRemaining / 1000).toFixed(2)} km to home`, lx + 52, ly + 18, 14, 'rgba(255,255,255,0.7)', 'left', 500);

    if (state.speeding) {
      this.text('SLOW DOWN', lx, ly + 62, 15, '#ff6b60', 'center', 700);
    }

    // Navigation arrow.
    this.drawNavArrow(W / 2, 92, state.turnAngle, state.turnDistance, state.instruction);

    // Minimap with the route and the destination.
    this.drawMinimap(W - 214, 24, 190, state.routeSpline, state.cars, state.player, {
      destination: state.destination,
      lights: state.lights,
    });

    // Driving score.
    this.panel(24, H - 96, 220, 72);
    this.text('DRIVE RATING', 40, H - 72, 11, 'rgba(255,255,255,0.5)', 'left', 600);
    const grade = state.rating;
    this.text(`${Math.round(grade)}`, 40, H - 38, 30, grade > 80 ? '#8ef2a0' : (grade > 55 ? '#ffd166' : '#ff6b60'), 'left', 700);
    this.text('/100', 82, H - 38, 14, 'rgba(255,255,255,0.5)', 'left', 500);
    if (state.penaltyText) this.text(state.penaltyText, 120, H - 38, 13, '#ff8a80', 'left', 600);

    // Indicator tell-tales.
    if (state.player.indicator !== 0 && Math.sin(state.player.indicatorPhase * Math.PI) > 0) {
      const ix = W / 2 + (state.player.indicator > 0 ? 60 : -60);
      ctx.save();
      ctx.translate(ix, H - 40);
      ctx.rotate(state.player.indicator > 0 ? 0 : Math.PI);
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-4, -10); ctx.lineTo(-4, -4);
      ctx.lineTo(-12, -4); ctx.lineTo(-12, 4); ctx.lineTo(-4, 4); ctx.lineTo(-4, 10);
      ctx.closePath();
      ctx.fillStyle = '#4ade80';
      ctx.fill();
      ctx.restore();
    }

    this.drawMessages();
  }

  drawNavArrow(cx, cy, angle, distance, instruction) {
    const ctx = this.ctx;
    this.panel(cx - 130, cy - 44, 260, 88, 0.42);
    ctx.save();
    ctx.translate(cx - 84, cy);
    ctx.rotate(clamp(angle, -1.4, 1.4));
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(16, 4);
    ctx.lineTo(6, 4);
    ctx.lineTo(6, 22);
    ctx.lineTo(-6, 22);
    ctx.lineTo(-6, 4);
    ctx.lineTo(-16, 4);
    ctx.closePath();
    ctx.fillStyle = '#4ade80';
    ctx.fill();
    ctx.restore();
    this.text(instruction, cx - 52, cy - 4, 19, '#fff', 'left', 700);
    this.text(distance > 0 ? `in ${Math.round(distance)} m` : 'now', cx - 52, cy + 18, 14, 'rgba(255,255,255,0.7)', 'left', 500);
  }

  // --- messages -------------------------------------------------------------

  drawMessages() {
    const W = this.width, H = this.height;
    let y = H * 0.32;
    for (const m of this.messages) {
      const fade = Math.min(1, (m.duration - m.time) * 2.5) * Math.min(1, m.time * 6);
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = clamp(fade, 0, 1);
      const color = m.kind === 'bad' ? '#ff6b60' : (m.kind === 'good' ? '#8ef2a0' : '#ffffff');
      const size = m.kind === 'big' ? 46 : 24;
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 14;
      this.text(m.text, W / 2, y, size, color, 'center', 700);
      ctx.restore();
      y += 34;
    }
  }
}
