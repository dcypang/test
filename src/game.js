// ---------------------------------------------------------------------------
// game.js - input, camera, the race, and the drive home.
// ---------------------------------------------------------------------------

const CAMERA_MODES = ['chase', 'chase-far', 'bonnet', 'cockpit', 'bumper'];

// Where the player sits on the grid, and how many cars take part.
const FIELD_SIZE = 8;

// Radius of each of the two circles a car is approximated by, for hitting
// scenery. Half the car's width plus a little, so the shell is a touch generous.
const CAR_SHELL = 0.98;

const NO_SHADOW = { noShadow: true };

// --- input ------------------------------------------------------------------

class Input {
  constructor(target) {
    this.keys = new Set();
    this.pressed = new Set();
    this.gamepadIndex = null;

    const down = (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.pressed.add(k);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(k)) e.preventDefault();
    };
    const up = (e) => { this.keys.delete(e.code); };
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  held(code) { return this.keys.has(code); }

  tapped(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  endFrame() { this.pressed.clear(); }

  pad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // Combined keyboard + gamepad driving inputs.
  driving() {
    const out = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
    if (this.held('KeyW') || this.held('ArrowUp')) out.throttle = 1;
    if (this.held('KeyS') || this.held('ArrowDown')) out.brake = 1;
    if (this.held('KeyA') || this.held('ArrowLeft')) out.steer -= 1;
    if (this.held('KeyD') || this.held('ArrowRight')) out.steer += 1;
    if (this.held('Space')) out.handbrake = 1;
    if (this.tapped('KeyE')) out.shiftUp = true;
    if (this.tapped('KeyQ')) out.shiftDown = true;

    if (this.touch) this.touch.driving(out);

    const p = this.pad();
    if (p) {
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) out.steer = clamp(out.steer + ax, -1, 1);
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      out.throttle = Math.max(out.throttle, rt);
      out.brake = Math.max(out.brake, lt);
      if (p.buttons[0] && p.buttons[0].pressed) out.handbrake = 1;
      if (p.buttons[5] && p.buttons[5].pressed) out.shiftUp = true;
      if (p.buttons[4] && p.buttons[4].pressed) out.shiftDown = true;
    }
    return out;
  }
}

// --- camera -----------------------------------------------------------------

class Camera {
  constructor() {
    this.pos = [0, 3, -8];
    this.target = [0, 1, 0];
    this.up = [0, 1, 0];
    this.right = [1, 0, 0];
    this.forward = [0, 0, 1];
    this.fov = 62 * DEG;
    this.view = m4.create();
    this.proj = m4.create();
    this.viewProj = m4.create();
    this.invViewProj = m4.create();
    this.planes = [];
    this.mode = 0;
    this.yaw = 0;
    this.shake = 0;
    this.speedBlur = 0;
    this.lookBack = false;
    // Driver's head, lagging behind what the car is doing.
    this.headLat = 0;
    this.headLon = 0;
    this.headYaw = 0;
  }

  cycle() { this.mode = (this.mode + 1) % CAMERA_MODES.length; }
  get modeName() { return CAMERA_MODES[this.mode]; }
  get inside() { return this.modeName === 'cockpit'; }

  update(dt, car, world) {
    const v = car.vehicle;
    const speed = v.speed;
    const mode = this.modeName;
    const drop = car.bodyDrop();

    // Blend the car's heading with its direction of travel so the camera stays
    // behind the car through a slide instead of staring at the door.
    let travelYaw = v.yaw;
    if (speed > 4) {
      const vy = Math.atan2(v.vel[0], v.vel[2]);
      const diff = wrapAngle(vy - v.yaw);
      travelYaw = v.yaw + clamp(diff, -0.5, 0.5) * 0.55;
    }
    const followRate = clamp(dt * (3.6 + speed * 0.05), 0, 1);
    this.yaw = this.yaw + wrapAngle(travelYaw - this.yaw) * followRate;

    const fwd = [Math.sin(v.yaw), 0, Math.cos(v.yaw)];
    const camFwd = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];

    let desired, lookAt;
    if (mode === 'chase' || mode === 'chase-far') {
      const dist = mode === 'chase' ? 6.4 : 9.2;
      const height = mode === 'chase' ? 2.05 : 3.0;
      const back = this.lookBack ? -1 : 1;
      desired = [
        v.pos[0] - camFwd[0] * dist * back,
        v.pos[1] + height + clamp(speed * 0.006, 0, 0.5),
        v.pos[2] - camFwd[2] * dist * back,
      ];
      lookAt = [
        v.pos[0] + fwd[0] * 6 * back,
        v.pos[1] + 1.0,
        v.pos[2] + fwd[2] * 6 * back,
      ];
      // Keep the camera above the ground even over crests.
      const ground = world.groundHeight(desired[0], desired[2]) + 0.9;
      if (desired[1] < ground) desired[1] = ground;
      const rate = clamp(dt * 9, 0, 1);
      this.pos[0] = lerp(this.pos[0], desired[0], rate);
      this.pos[1] = lerp(this.pos[1], desired[1], rate);
      this.pos[2] = lerp(this.pos[2], desired[2], rate);
      this.target[0] = lerp(this.target[0], lookAt[0], clamp(dt * 12, 0, 1));
      this.target[1] = lerp(this.target[1], lookAt[1], clamp(dt * 12, 0, 1));
      this.target[2] = lerp(this.target[2], lookAt[2], clamp(dt * 12, 0, 1));
    } else {
      // Rigid mounts move with the body, including pitch and roll.
      const offsets = {
        bonnet: [0, 1.12, 1.15],
        cockpit: EYE_POS,
        bumper: [0, 0.46, 2.28],
      };
      const o = offsets[mode];
      const back = this.lookBack ? -1 : 1;
      const m = m4.compose(m4.create(), [v.pos[0], v.pos[1] - drop, v.pos[2]], v.yaw, v.pitch, v.roll);

      // From the seat, a head is not bolted to the car. It leans away from the
      // cornering force, dips under braking, and looks a little way into the
      // corner before the car gets there - which is most of what makes a
      // cockpit view feel like being in the car rather than strapped to it.
      let eye = o, aim = [o[0], o[1] - 0.02, o[2] + 10 * back];
      if (mode === 'cockpit') {
        const lat = clamp(v.latAccel / GRAVITY, -1.6, 1.6);
        const lon = clamp(v.longAccel / GRAVITY, -1.6, 1.6);
        this.headLat = lerp(this.headLat, lat, clamp(dt * 5.5, 0, 1));
        this.headLon = lerp(this.headLon, lon, clamp(dt * 5.5, 0, 1));
        const glance = clamp(v.steerAngle * 2.2 + v.yawRate * 0.30, -0.42, 0.42);
        this.headYaw = lerp(this.headYaw, glance, clamp(dt * 4.0, 0, 1));
        eye = [
          o[0] - this.headLat * 0.045,
          o[1] - Math.abs(this.headLat) * 0.012 - Math.max(0, -this.headLon) * 0.020,
          o[2] + this.headLon * 0.030,
        ];
        const ax = Math.sin(this.headYaw) * 10, az = Math.cos(this.headYaw) * 10;
        aim = [eye[0] + ax * back, eye[1] + 0.30, eye[2] + az * back];
      }

      const p = m4.transformPoint([0, 0, 0], m, eye);
      const look = m4.transformPoint([0, 0, 0], m, aim);
      this.pos[0] = p[0]; this.pos[1] = p[1]; this.pos[2] = p[2];
      this.target[0] = look[0]; this.target[1] = look[1]; this.target[2] = look[2];
    }

    // Shake from kerbs, impacts and raw speed.
    this.shake = Math.max(0, this.shake - dt * 2.4);
    let rumble = 0;
    for (const w of v.wheels) rumble += w.surface.rumble * (w.contact ? 1 : 0);
    rumble = rumble / 4 * clamp(speed / 30, 0, 1);
    const amp = (this.shake * 0.5 + rumble * 0.10) * (this.inside ? 1.4 : 1.0);
    if (amp > 0.0005) {
      const t = performance.now() * 0.001;
      this.pos[0] += Math.sin(t * 47.3) * amp;
      this.pos[1] += Math.sin(t * 61.7) * amp;
      this.pos[2] += Math.sin(t * 53.1) * amp;
    }

    // A GT car's windscreen aperture is only about 25 degrees tall from the
    // seat. At a wide field of view that leaves the screen mostly headliner and
    // dashboard, so the cockpit runs narrower and the speed scaling is gentler.
    const targetFov = this.inside
      ? 52 + clamp(speed * 0.16, 0, 11)
      : 60 + clamp(speed * 0.30, 0, 20);
    this.fov = lerp(this.fov, targetFov * DEG, clamp(dt * 3, 0, 1));
    this.speedBlur = lerp(this.speedBlur, clamp((speed - 24) / 200, 0, 0.16), clamp(dt * 3, 0, 1));
  }

  applyProjection(aspect, near = 0.15, far = 2600) {
    m4.perspective(this.proj, this.fov, aspect, near, far);
    m4.lookAt(this.view, this.pos, this.target, [0, 1, 0]);
    m4.multiply(this.viewProj, this.proj, this.view);
    m4.invert(this.invViewProj, this.viewProj);
    m4.frustumPlanes(this.planes, this.viewProj);
    // Basis vectors for billboards.
    const f = v3.norm([0, 0, 0], v3.sub([0, 0, 0], this.target, this.pos));
    this.forward = f;
    // Screen right, matching the mirrored clip X in m4.perspective.
    this.right = v3.norm([0, 0, 0], v3.cross([0, 0, 0], [0, 1, 0], f));
    this.up = v3.cross([0, 0, 0], f, this.right);
  }
}

// --- progress helper --------------------------------------------------------

function progressOnSpline(spline, x, z, hint) {
  const i = nearestIndex(spline, x, z, hint, 26);
  const n = spline.count;
  const i1 = (i + 1) % n;
  const a = spline.points[i], b = spline.points[i1];
  const abx = b[0] - a[0], abz = b[2] - a[2];
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-9 ? ((x - a[0]) * abx + (z - a[2]) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  const segLen = Math.sqrt(len2);
  const along = spline.cumulative[i] + t * segLen;
  const px = a[0] + abx * t, pz = a[2] + abz * t;
  const nr = spline.normals[i];
  const lateral = (x - px) * nr[0] + (z - pz) * nr[2];
  return { index: i, along, lateral, t };
}

// --- the game ---------------------------------------------------------------

class Game {
  constructor(canvas, hudCanvas, ui) {
    this.renderer = new Renderer(canvas);
    this.hud = new Hud(hudCanvas);
    this.audio = new GameAudio();
    this.input = new Input(window);
    this.camera = new Camera();
    this.ui = ui;

    // Phones and tablets get on-screen controls and a lighter render preset.
    this.isTouch = isTouchDevice();
    this.touch = new TouchControls(this);
    this.touch.mount();
    this.input.touch = this.touch;
    this.orientationBlocked = false;
    this.watchOrientation();

    this.state = 'loading';
    this.time = 0;
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.paused = false;
    this.settings = {
      laps: 3,
      difficulty: 0.64,
      assists: true,
      quality: this.isTouch ? 'fast' : 'high',
      playerLivery: 0,
      volume: 0.7,
      tiltSteer: false,
      invertSteer: false,
      camera: 'cockpit',
    };
    if (this.isTouch) {
      // Shadow passes walk the whole opaque queue twice, which is the single
      // biggest cost on a phone.
      this.renderer.settings.shadows = false;
      this.renderer.settings.bloom = 0.3;
      this.renderer.settings.particles = false;
      this.renderer.settings.cullFar = 620;
    }

    this.carMeshes = buildCarMeshes(this.renderer.gl);
    this.trafficMeshes = this.buildTrafficMeshes();

    this.cars = [];
    this.drivers = [];
    this.traffic = [];
    this.scene = null;
    this.homeScene = null;
    this.circuitScene = null;

    this.raceState = null;
    this.driveState = null;
    this.transition = 0;
    this.hintTimer = 0;
  }

  // Which view a session opens in. `C` and the on-screen camera button still
  // cycle through all five from wherever this lands.
  startCameraMode() {
    const i = CAMERA_MODES.indexOf(this.settings.camera);
    return i < 0 ? 0 : i;
  }

  // A driving game in portrait is unreadable, so ask for landscape and stop
  // taking driving input until the phone turns.
  watchOrientation() {
    const el = document.getElementById('rotate');
    const dismiss = document.getElementById('rotateAnyway');
    // Embedded in a frame the page can be portrait-shaped whichever way the
    // phone is held, so the prompt must never be a dead end.
    this.ignorePortrait = false;
    if (dismiss) {
      dismiss.addEventListener('click', () => {
        this.ignorePortrait = true;
        if (el) el.style.display = 'none';
        this.orientationBlocked = false;
      });
    }
    const check = () => {
      const portrait = this.isTouch && !this.ignorePortrait
        && window.innerHeight > window.innerWidth * 1.05;
      this.orientationBlocked = portrait && (this.state === 'race' || this.state === 'drive');
      const show = portrait && this.state !== 'loading';
      if (el) el.style.display = show ? 'flex' : 'none';
    };
    this.checkOrientation = check;
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', () => setTimeout(check, 120));
    check();
  }

  buildTrafficMeshes() {
    const gl = this.renderer.gl;
    const body = new MeshBuilder();
    const glass = new MeshBuilder();
    buildCivilianCar(body, glass, makeRng(12345));
    const wheel = new MeshBuilder();
    buildSimpleWheel(wheel, 0.32, 0.22);
    return {
      body: meshFromBuilder(gl, body),
      glass: meshFromBuilder(gl, glass),
      wheel: meshFromBuilder(gl, wheel),
    };
  }

  // --- lifecycle ------------------------------------------------------------

  async boot() {
    this.ui.setLoading('Building the circuit…');
    await nextFrame();
    this.circuitScene = buildCircuit(this.renderer.gl);
    this.ui.setLoading('Building the road home…');
    await nextFrame();
    this.homeScene = buildHomeRoute(this.renderer.gl);
    this.ui.setLoading('Ready');
    await nextFrame();
    this.state = 'menu';
    this.ui.showTitle();
    this.setupMenuScene();
  }

  setupMenuScene() {
    // A single car parked on the grid, slowly orbited by the camera.
    this.scene = this.circuitScene;
    this.cars = [];
    this.drivers = [];
    this.traffic = [];
    const car = new Car(this.carMeshes, {
      isPlayer: true,
      livery: LIVERY_PRESETS[this.settings.playerLivery],
      assists: this.settings.assists,
    });
    const g = this.scene.grid[0];
    car.setPose(g.x, g.z, g.yaw, this.scene.world);
    this.cars.push(car);
    this.player = car;
    this.menuAngle = 0;
    this.applyAmbience(this.scene.ambience);
    // Place the orbit camera immediately rather than letting it swoop in from
    // wherever it happened to be.
    this.updateMenu(1);
    this.camera.pos[0] = this.menuTarget[0];
    this.camera.pos[1] = this.menuTarget[1];
    this.camera.pos[2] = this.menuTarget[2];
    this.camera.fov = 46 * DEG;
  }

  applyAmbience(a) {
    const elev = a.sunAngle;
    const az = a.sunAzimuth;
    const sunDir = v3.norm([0, 0, 0], [Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)]);
    const warm = clamp(1 - elev / 0.8, 0, 1);
    this.renderer.setAmbience({
      sunDir,
      sunColor: [
        lerp(1.85, 2.6, warm),
        lerp(1.78, 1.55, warm),
        lerp(1.60, 0.95, warm),
      ],
      skyZenith: a.sky.zenith,
      skyHorizon: a.sky.horizon,
      groundTint: [0.20, 0.21, 0.16],
      cloudColor: warm > 0.5 ? [1.25, 0.92, 0.78] : [1.0, 0.99, 0.98],
      cloudAmount: a.sky.cloud,
      fogColor: [
        lerp(a.sky.horizon[0], 0.75, 0.25),
        lerp(a.sky.horizon[1], 0.78, 0.25),
        lerp(a.sky.horizon[2], 0.84, 0.25),
      ],
      fogDensity: a.fogDensity,
      night: a.night,
      wetness: 0.12,
    });
  }

  // --- race setup -----------------------------------------------------------

  startRace() {
    this.audio.start();
    this.audio.setVolume(this.settings.volume);
    this.scene = this.circuitScene;
    this.applyAmbience(this.scene.ambience);
    this.renderer.clearDecals();

    this.cars = [];
    this.drivers = [];
    this.traffic = [];

    const liveries = LIVERY_PRESETS.slice();
    const playerLivery = liveries.splice(this.settings.playerLivery, 1)[0];

    // Player starts mid-pack so there is a race to be had in both directions.
    const playerGrid = Math.min(4, FIELD_SIZE - 1);
    for (let i = 0; i < FIELD_SIZE; i++) {
      const isPlayer = i === playerGrid;
      const livery = isPlayer ? playerLivery : liveries[i % liveries.length];
      const car = new Car(this.carMeshes, {
        isPlayer,
        livery,
        assists: isPlayer ? this.settings.assists : true,
        // Yaw damping and grip assist are for a thumb on glass. The AI reads
        // the whole state vector and they only fight its controller.
        driverAids: isPlayer,
        name: isPlayer ? 'YOU' : livery.name.toUpperCase(),
        grip: isPlayer ? 1.0 : lerp(0.94, 1.07, this.settings.difficulty) + (i % 3) * 0.008,
      });
      const g = this.scene.grid[i];
      car.setPose(g.x, g.z, g.yaw, this.scene.world);
      car.vehicle.gear = GEAR_FIRST;
      this.cars.push(car);
      if (isPlayer) this.player = car;
      else {
        const skill = clamp(this.settings.difficulty + (Math.random() - 0.5) * 0.08, 0.62, 1.0);
        this.drivers.push(new RacingDriver(car, this.scene.racingLine, skill));
      }
    }

    const startProgress = progressOnSpline(this.scene.track.spline, this.scene.startLine.x, this.scene.startLine.z, 0);
    this.raceState = {
      countdown: 6.0,
      started: false,
      elapsed: 0,
      totalLaps: this.settings.laps,
      finishedCount: 0,
      startAlong: startProgress.along,
      lapLength: this.scene.track.spline.length,
      results: [],
      falseStart: false,
    };
    for (const car of this.cars) {
      const p = progressOnSpline(this.scene.track.spline, car.pos[0], car.pos[2], 0);
      car.hint = p.index;
      car.lastAlong = p.along;
      car.lap = 0;
      car.totalProgress = p.along - this.raceState.lapLength;   // behind the line
      car.lapStart = 0;
      car.lapTimes = [];
      car.bestLapTime = 0;
      car.finished = false;
      car.dirt = 0;
      car.gapToLeader = 0;
    }
    this.camera.mode = this.startCameraMode();
    this.state = 'race';
    this.ui.hideAll();
    this.hud.message('FORMATION LAP COMPLETE', 2.2);
  }

  // --- drive home setup -----------------------------------------------------

  // The journey home is a chain of roads: down the pit lane, out through the
  // paddock gate, then the public road and finally the driveway. The first two
  // are in the circuit's world and the third is in the town's, so somewhere in
  // the middle the ground has to be swapped underneath a moving car. Each leg
  // presents the same handful of fields and updateDrive never has to know which
  // one it is on.
  buildDriveLegs() {
    const c = this.circuitScene, h = this.homeScene;
    const legs = [
      { scene: c, route: c.pitLane, label: 'Pit lane', limit: 60,
        endText: 'Follow the lane out of the paddock' },
      { scene: c, route: c.exitRoute, label: 'Circuit exit road', limit: 60,
        endText: 'Through the gate onto the road' },
      { scene: h, route: h.route, home: true },
    ];
    // How much journey is left after each leg ends, so the satnav can show one
    // distance for the whole way home rather than restarting at every gate.
    let ahead = h.drivewayLength;
    for (let i = legs.length - 1; i >= 0; i--) {
      legs[i].ahead = ahead;
      ahead += legs[i].route.spline.length;
    }
    this.legs = legs;
    this.legIndex = 0;
  }

  // The current leg, shaped the way updateDrive wants to read it.
  leg() {
    const L = this.legs[this.legIndex];
    const h = this.homeScene;
    if (L.home) {
      return {
        route: L.route, length: h.routeLength, zoneAt: h.zoneAt,
        lights: h.trafficLights, destination: h.destination,
        tail: h.drivewayLength, tailSide: h.drivewaySide,
        ahead: 0, last: true,
      };
    }
    const zone = { limit: L.limit, label: L.label };
    return {
      route: L.route, length: L.route.spline.length, zoneAt: () => zone,
      lights: [], destination: null, tail: 0, tailSide: 1,
      ahead: L.ahead, last: false, endText: L.endText,
    };
  }

  // Cross onto the next road. Within a world that is just a change of
  // reference spline; between worlds the car is moved to the far side of the
  // gate still carrying its speed, gear and revs.
  advanceLeg() {
    if (this.legIndex >= this.legs.length - 1) return;
    const from = this.leg();
    const sp = from.route.spline;
    const car = this.player, v = car.vehicle;

    // How the car is sitting on the road it is leaving.
    const prog = progressOnSpline(sp, car.pos[0], car.pos[2], sp.count - 2);
    // Keep the crossing on the tarmac: the gate piers stand just off the verge,
    // and landing on one would be a collision the player never saw coming.
    const room = Math.max(1.0, from.route.halfWidth - 1.3);
    const lateral = clamp(prog.lateral, -room, room);
    const endTan = sp.tangents[sp.count - 1];
    const heading = wrapAngle(v.yaw - Math.atan2(endTan[0], endTan[2]));

    this.legIndex++;
    const next = this.legs[this.legIndex];
    if (next.scene === this.scene) return;

    // --- into the next world --------------------------------------------------
    this.scene = next.scene;
    this.applyAmbience(this.scene.ambience);
    this.renderer.clearDecals();
    const nsp = next.route.spline;
    const p = nsp.points[1], n = nsp.normals[1], t = nsp.tangents[1];
    car.rebase(p[0] + n[0] * lateral, p[2] + n[2] * lateral,
      Math.atan2(t[0], t[2]) + heading, this.scene.world);
    car.headlightsOn = car.headlightsOn || this.scene.ambience.night > 0.2;
    this.cars = [car];
    this.lightSystem = new TrafficLightSystem(this.scene.trafficLights || []);
    this.spawnTraffic(car.pos);
    this.driveState.hint = 1;
    this.driveState.redLightArmed = new Map();
  }

  startDriveHome() {
    this.audio.start();
    this.buildDriveLegs();
    this.scene = this.legs[0].scene;
    this.applyAmbience(this.scene.ambience);
    this.renderer.clearDecals();

    const car = new Car(this.carMeshes, {
      isPlayer: true,
      livery: LIVERY_PRESETS[this.settings.playerLivery],
      assists: this.settings.assists,
      name: 'YOU',
    });
    car.dirt = this.player ? Math.max(0.25, this.player.dirt) : 0.25;
    car.headlightsOn = this.scene.ambience.night > 0.2;
    // Parked in the pit lane, facing the way out.
    const s = this.scene.exitStart;
    car.setPose(s.x, s.z, s.yaw, this.scene.world);
    this.cars = [car];
    this.player = car;
    this.drivers = [];

    this.lightSystem = new TrafficLightSystem(this.scene.trafficLights || []);
    this.spawnTraffic();

    this.driveState = {
      rating: 100,
      elapsed: 0,
      penalties: [],
      penaltyText: '',
      penaltyTimer: 0,
      speedingTimer: 0,
      redLightArmed: new Map(),
      hint: 1,
      arrived: false,
      lastInstruction: '',
      crashes: 0,
      wrongSideTimer: 0,
      shopped: false,
      shopTimer: 0,
      shopNear: false,
    };
    this.camera.mode = this.startCameraMode();
    this.state = 'drive';
    this.ui.hideAll();
    this.hud.message('DOWN THE PIT LANE AND OUT THE GATE', 4.0);
    this.hud.message('The road home starts at the circuit exit', 4.0);
  }

  // `clearOf`, when given, is a spot no traffic may occupy: the handover drops
  // the player at the start of the route, which is also where traffic spawns.
  spawnTraffic(clearOf) {
    this.traffic = [];
    const scene = this.scene;
    // Only the public road carries traffic; the pit lane and the paddock are
    // the circuit's, and it has just emptied out.
    if (!scene.route) return;
    const rng = makeRng(555);
    const palette = [
      [0.72, 0.72, 0.74], [0.10, 0.11, 0.13], [0.55, 0.09, 0.08], [0.10, 0.22, 0.45],
      [0.82, 0.82, 0.80], [0.25, 0.42, 0.30], [0.40, 0.42, 0.46], [0.68, 0.55, 0.20],
    ];
    const addOn = (path, count, limit) => {
      for (let i = 0; i < count; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const car = new Car(this.trafficMeshes, {
          livery: {
            paint: palette[Math.floor(rng() * palette.length)],
            stripe: [0.8, 0.8, 0.8],
            style: 0,
            name: 'traffic',
          },
          assists: true,
          driverAids: false,
        });
        car.isTraffic = true;
        const lane = dir > 0 ? 2.1 : -2.1;
        const driver = new TrafficDriver(car, path, dir, lane, limit);
        const idx = Math.floor(rnd2(rng, 6, path.spline.count - 6));
        driver.placeAt(idx, scene.world);
        this.traffic.push(driver);
      }
    };
    addOn(scene.route, 16, 52);
    for (const s of scene.sideStreets) addOn(s, 2, 40);
    if (clearOf) {
      this.traffic = this.traffic.filter((t) =>
        Math.hypot(t.car.pos[0] - clearOf[0], t.car.pos[2] - clearOf[2]) > 50);
    }
  }

  // --- main loop ------------------------------------------------------------

  frame() {
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    dt = Math.min(dt, 0.05);
    if (this.paused) dt = 0;

    this.time += dt;
    this.update(dt);
    this.draw(dt);
    this.input.endFrame();
    requestAnimationFrame(() => this.frame());
  }

  update(dt) {
    if (this.state === 'loading') return;

    if (this.input.tapped('KeyP') || this.input.tapped('Escape')) {
      if (this.state === 'race' || this.state === 'drive') {
        this.paused = !this.paused;
        this.ui.setPaused(this.paused);
        if (this.paused) return;
      }
    }
    if (this.paused) return;

    // Keep the on-screen controls in step with what the player is doing.
    const driving = this.state === 'race' || this.state === 'drive';
    this.touch.setVisible(this.isTouch && driving && !this.paused, this.state);
    if (this.checkOrientation) this.checkOrientation();
    this.handleTouchTaps();
    if (this.orientationBlocked) {
      this.hud.update(dt);
      if (this.player) {
        this.player.vehicle.throttle = 0;
        this.player.vehicle.brake = 1;
      }
      return;
    }

    if (this.input.tapped('KeyC')) this.camera.cycle();
    this.camera.lookBack = this.input.held('KeyB');
    if (this.input.tapped('KeyL')) {
      this.player.headlightsOn = !this.player.headlightsOn;
      this.hud.message(this.player.headlightsOn ? 'Headlights on' : 'Headlights off', 1.2);
    }
    if (this.input.tapped('KeyM')) {
      this.audio.enabled = !this.audio.enabled;
      this.audio.setVolume(this.audio.enabled ? this.settings.volume : 0);
    }

    this.hud.update(dt);

    switch (this.state) {
      case 'menu': this.updateMenu(dt); break;
      case 'race': this.updateRace(dt); break;
      case 'results': this.updateIdle(dt); break;
      case 'drive': this.updateDrive(dt); break;
      case 'arrived': this.updateIdle(dt); break;
      default: break;
    }

    this.renderer.updateParticles(dt);
    this.updateAudio(dt);
  }

  // On-screen buttons map onto the same actions as the keyboard shortcuts.
  handleTouchTaps() {
    const taps = this.touch.drainTaps();
    if (!taps) return;
    for (const tap of taps) {
      switch (tap) {
        case 'camera':
          this.camera.cycle();
          break;
        case 'reset':
          if (this.state === 'race' || this.state === 'drive') this.resetPlayerToTrack();
          break;
        case 'pause':
          if (this.state === 'race' || this.state === 'drive') {
            this.paused = !this.paused;
            this.ui.setPaused(this.paused);
          }
          break;
        case 'lights':
          this.player.headlightsOn = !this.player.headlightsOn;
          this.hud.message(this.player.headlightsOn ? 'Headlights on' : 'Headlights off', 1.2);
          break;
        case 'indicateLeft':
          this.player.indicator = this.player.indicator === -1 ? 0 : -1;
          if (this.player.indicator) this.audio.indicator();
          break;
        case 'indicateRight':
          this.player.indicator = this.player.indicator === 1 ? 0 : 1;
          if (this.player.indicator) this.audio.indicator();
          break;
        default:
          break;
      }
    }
  }

  updateIdle(dt) {
    this.camera.update(dt, this.player, this.scene.world);
  }

  updateMenu(dt) {
    this.menuAngle += dt * 0.12;
    const car = this.player;
    const r = 8.6;
    const cx = car.pos[0] + Math.sin(this.menuAngle) * r;
    const cz = car.pos[2] + Math.cos(this.menuAngle) * r;
    const cy = this.scene.world.groundHeight(cx, cz) + 1.8 + Math.sin(this.menuAngle * 0.7) * 0.5;
    this.menuTarget = [cx, cy, cz];
    this.camera.pos[0] = lerp(this.camera.pos[0], cx, clamp(dt * 3, 0, 1));
    this.camera.pos[1] = lerp(this.camera.pos[1], cy, clamp(dt * 3, 0, 1));
    this.camera.pos[2] = lerp(this.camera.pos[2], cz, clamp(dt * 3, 0, 1));
    this.camera.target[0] = car.pos[0];
    this.camera.target[1] = car.pos[1] + 0.75;
    this.camera.target[2] = car.pos[2];
    this.camera.fov = lerp(this.camera.fov, 46 * DEG, clamp(dt * 3, 0, 1));
    this.camera.speedBlur = 0;
    car.livery = LIVERY_PRESETS[this.settings.playerLivery];
  }

  // --- player controls ------------------------------------------------------

  applyPlayerInput(dt, allowDriving) {
    const car = this.player;
    const v = car.vehicle;
    const inp = this.input.driving();
    if (!allowDriving) {
      v.throttle = 0;
      v.brake = 1;
      v.steerInput = 0;
      return inp;
    }
    v.throttle = inp.throttle;
    v.brake = inp.brake;
    v.handbrake = inp.handbrake;
    // Steering: ease in so a keyboard tap is not an instant full lock.
    const targetSteer = inp.steer;
    const rate = targetSteer === 0 ? 5.5 : 3.4;
    v.steerInput = approach(v.steerInput, targetSteer, dt * rate * (1 + Math.abs(targetSteer - v.steerInput)));

    // Reverse: hold the brake at a standstill.
    if (v.speed < 0.8 && inp.brake > 0.5 && v.gear !== GEAR_REVERSE) {
      this.reverseHold = (this.reverseHold || 0) + dt;
      if (this.reverseHold > 0.45) v.reverseRequest = true;
    } else if (inp.throttle > 0.3) {
      this.reverseHold = 0;
      v.reverseRequest = false;
    }
    if (v.gear === GEAR_REVERSE) {
      // In reverse the throttle drives backwards and the brake stops you.
      v.throttle = inp.throttle;
      v.brake = inp.brake > 0.5 && v.speed > 0.5 ? inp.brake : 0;
    }

    if (inp.shiftUp) { v.autoGearbox = false; v.shiftUp(); this.audio.shift(); }
    if (inp.shiftDown) { v.autoGearbox = false; v.shiftDown(); this.audio.shift(); }
    if (this.input.tapped('KeyG')) {
      v.autoGearbox = !v.autoGearbox;
      this.hud.message(v.autoGearbox ? 'Automatic gearbox' : 'Manual gearbox — Q / E to shift', 2.0);
    }
    return inp;
  }

  // --- collisions -----------------------------------------------------------

  // One place for everything a hit throws off: sparks along the contact,
  // debris in the paint colour of whatever you hit, a puff of dust on a heavy
  // one, plus the shake, the flash, the noise and the damage.
  impact(x, z, nx, nz, strength, otherPaint) {
    const car = this.player;
    const y = car.pos[1] + 0.55;
    this.audio.impact(strength);
    this.camera.shake = Math.max(this.camera.shake, strength * 0.75);
    this.renderer.flash = Math.min(0.30, strength * 0.22);
    car.damage = Math.min(1, car.damage + strength * 0.09);

    if (!this.renderer.settings.particles) return;
    // Sparks fly along the surface, not out of it, so they are thrown along
    // the tangent and dragged by the car's own motion.
    const tx = -nz, tz = nx;
    const v = car.vehicle;
    const n = Math.round(4 + strength * 26);
    for (let i = 0; i < n; i++) {
      const s = rnd(-1, 1);
      this.renderer.spawnParticle(
        [x + rnd(-0.2, 0.2), y + rnd(-0.25, 0.25), z + rnd(-0.2, 0.2)],
        [tx * s * rnd(2, 9) + nx * rnd(0.5, 3) - v.vel[0] * 0.25,
          rnd(0.5, 4.0),
          tz * s * rnd(2, 9) + nz * rnd(0.5, 3) - v.vel[2] * 0.25],
        { life: rnd(0.18, 0.5), size: 0.045, grow: 0.4, tint: [2.4, 1.15, 0.30],
          alpha: 0.95, drag: 1.6, gravity: 9.0, additive: true });
    }
    if (strength > 0.25) {
      // Debris: shards in the colour of whatever came off.
      const tint = otherPaint
        ? [otherPaint[0] * 1.1 + 0.05, otherPaint[1] * 1.1 + 0.05, otherPaint[2] * 1.1 + 0.05]
        : [0.42, 0.40, 0.36];
      for (let i = 0; i < Math.round(strength * 12); i++) {
        this.renderer.spawnParticle(
          [x + rnd(-0.3, 0.3), y + rnd(-0.3, 0.3), z + rnd(-0.3, 0.3)],
          [nx * rnd(1, 5) + rnd(-2.5, 2.5), rnd(1.5, 5.5), nz * rnd(1, 5) + rnd(-2.5, 2.5)],
          { life: rnd(0.6, 1.4), size: 0.075, grow: 0.2, tint,
            alpha: 0.9, drag: 0.9, gravity: 11.0 });
      }
      for (let i = 0; i < Math.round(strength * 6); i++) {
        this.renderer.spawnParticle(
          [x + rnd(-0.4, 0.4), y, z + rnd(-0.4, 0.4)],
          [rnd(-1.5, 1.5), rnd(0.6, 2.0), rnd(-1.5, 1.5)],
          { life: rnd(0.7, 1.5), size: 0.30, grow: 3.0, tint: [0.55, 0.54, 0.52],
            alpha: 0.20, drag: 1.5, gravity: 0.4 });
      }
    }
  }

  resolveCollisions(dt, boundaryFn) {
    const cars = this.state === 'drive'
      ? [this.player, ...this.traffic.map((t) => t.car)]
      : this.cars;

    // Car versus car, approximated with two circles per car.
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2];
        if (dx * dx + dz * dz > 36) continue;
        const af = a.forward(), bf = b.forward();
        for (const oa of [-1.05, 1.05]) {
          for (const ob of [-1.05, 1.05]) {
            const ax = a.pos[0] + af[0] * oa, az = a.pos[2] + af[2] * oa;
            const bx = b.pos[0] + bf[0] * ob, bz = b.pos[2] + bf[2] * ob;
            let nx = bx - ax, nz = bz - az;
            const d = Math.hypot(nx, nz);
            const minD = 1.62;
            if (d >= minD || d < 1e-5) continue;
            nx /= d; nz /= d;
            const overlap = (minD - d) * 0.5;
            a.vehicle.pos[0] -= nx * overlap; a.vehicle.pos[2] -= nz * overlap;
            b.vehicle.pos[0] += nx * overlap; b.vehicle.pos[2] += nz * overlap;
            const rvx = b.vehicle.vel[0] - a.vehicle.vel[0];
            const rvz = b.vehicle.vel[2] - a.vehicle.vel[2];
            const vn = rvx * nx + rvz * nz;
            if (vn < 0) {
              // Mass-weighted, so a GT car shunting a hatchback moves the
              // hatchback. Restitution is low: cars crumple, they do not bounce.
              const ma = a.vehicle.mass, mb2 = b.vehicle.mass;
              const inv = 1 / ma + 1 / mb2;
              const jimp = -(1.24) * vn / inv;
              a.vehicle.vel[0] -= nx * jimp / ma; a.vehicle.vel[2] -= nz * jimp / ma;
              b.vehicle.vel[0] += nx * jimp / mb2; b.vehicle.vel[2] += nz * jimp / mb2;
              // Tangential friction, which is what makes a side swipe drag the
              // two cars into line instead of letting them slide past.
              const tx = -nz, tz = nx;
              const vt = rvx * tx + rvz * tz;
              const jt = clamp(-vt / inv, -jimp * 0.5, jimp * 0.5);
              a.vehicle.vel[0] -= tx * jt / ma; a.vehicle.vel[2] -= tz * jt / ma;
              b.vehicle.vel[0] += tx * jt / mb2; b.vehicle.vel[2] += tz * jt / mb2;
              // Yaw from the real lever arm: a corner hit spins you, a square
              // hit in the middle does not. `jimp` is an impulse in newton
              // seconds, so the torque is r x J and the change in yaw rate is
              // that over the yaw inertia - no fudge factor, and none wanted:
              // treating an impulse like a velocity here span the car at 25
              // rad/s and drove the whole simulation to NaN.
              const rax = af[0] * oa, raz = af[2] * oa;
              const rbx = bf[0] * ob, rbz = bf[2] * ob;
              const Jx = nx * jimp + tx * jt, Jz = nz * jimp + tz * jt;
              a.vehicle.yawRate += clamp((rax * Jz - raz * Jx) / a.vehicle.inertiaYaw, -3, 3);
              b.vehicle.yawRate += clamp((rbz * Jx - rbx * Jz) / b.vehicle.inertiaYaw, -3, 3);
              const strength = clamp(-vn / 16, 0, 1);
              const other = a === this.player ? b : a;
              if (strength > 0.05 && (a === this.player || b === this.player)) {
                this.impact((ax + bx) / 2, (az + bz) / 2, nx, nz, strength, other.livery.paint);
                if (this.driveState) this.registerPenalty('Contact', strength * 12);
              }
            }
          }
        }
      }
    }

    // Solid scenery: tree trunks, poles, gate piers, walls, hedges.
    const world = this.scene.world;
    if (world.solids.length) {
      const hits = this._solidHits || (this._solidHits = []);
      for (const car of cars) {
        const v = car.vehicle;
        const f = car.forward();
        for (const o of [-1.05, 1.05]) {
          const cx = car.pos[0] + f[0] * o, cz = car.pos[2] + f[2] * o;
          world.querySolids(cx, cz, CAR_SHELL, hits);
          for (const s of hits) {
            let nx = cx - s.x, nz = cz - s.z;
            const d = Math.hypot(nx, nz);
            const minD = s.r + CAR_SHELL;
            if (d >= minD) continue;
            if (d < 1e-4) { nx = f[0]; nz = f[2]; } else { nx /= d; nz /= d; }
            v.pos[0] += nx * (minD - d);
            v.pos[2] += nz * (minD - d);
            const vn = v.vel[0] * nx + v.vel[2] * nz;
            if (vn >= 0) continue;
            // `hard` decides how much of the car's momentum the obstacle takes:
            // a lamp post stops you, a hedge drags at you and lets you through.
            const j = -(1.0 + 0.25 * s.hard) * vn * s.hard;
            v.vel[0] += nx * j; v.vel[2] += nz * j;
            v.vel[0] *= 1 - 0.35 * s.hard; v.vel[2] *= 1 - 0.35 * s.hard;
            v.yawRate += clamp(o * vn * s.hard * 0.045, -2, 2);
            const strength = clamp(-vn / 18, 0, 1) * s.hard;
            if (car === this.player && strength > 0.05) {
              this.impact(cx, cz, nx, nz, strength, null);
              if (this.driveState) this.registerPenalty('Hit something', strength * 16);
            }
          }
        }
      }
    }

    // Track / road boundary.
    for (const car of cars) {
      const info = boundaryFn(car);
      if (!info) continue;
      const { limit, hit } = info;
      const lat = hit.lateral;
      const over = Math.abs(lat) - limit;
      if (over <= 0) continue;
      const nrm = hit.path.normal(hit.index);
      const side = sign(lat);
      const push = over;
      car.vehicle.pos[0] -= nrm[0] * side * push;
      car.vehicle.pos[2] -= nrm[2] * side * push;
      const nx = -nrm[0] * side, nz = -nrm[2] * side;
      const vn = car.vehicle.vel[0] * nx + car.vehicle.vel[2] * nz;
      if (vn < 0) {
        const j = -(1.35) * vn;
        car.vehicle.vel[0] += nx * j;
        car.vehicle.vel[2] += nz * j;
        car.vehicle.yawRate *= 0.55;
        const strength = clamp(-vn / 18, 0, 1);
        if (car === this.player && strength > 0.06) {
          this.impact(car.pos[0], car.pos[2], nx, nz, strength, null);
          if (this.driveState) this.registerPenalty('Off the road', strength * 14);
        }
      }
    }

    for (const car of cars) car.vehicle.sanitise();
  }

  // --- race -----------------------------------------------------------------

  updateRace(dt) {
    const scene = this.scene;
    const rs = this.raceState;
    const world = scene.world;

    // Countdown.
    if (!rs.started) {
      const before = Math.ceil(rs.countdown);
      rs.countdown -= dt;
      const after = Math.ceil(rs.countdown);
      if (after !== before && after >= 0 && after <= 5) {
        this.audio.countdownBeep(after === 0);
      }
      if (rs.countdown <= 0) {
        rs.started = true;
        rs.countdown = 0;
        this.hud.message('GO!', 1.4, 'big');
      }
    } else {
      rs.elapsed += dt;
    }

    const driving = rs.started;
    this.applyPlayerInput(dt, driving);
    if (!driving) {
      // Let the engine be revved on the grid.
      const inp = this.input.driving();
      this.player.vehicle.throttle = 0;
      this.player.vehicle.gear = GEAR_FIRST;
      this.player.vehicle.rpm = lerp(this.player.vehicle.rpm, IDLE_RPM + inp.throttle * 5200, clamp(dt * 5, 0, 1));
    }

    for (const d of this.drivers) {
      if (driving && !d.car.finished) d.update(dt, this.cars, world);
      else { d.car.vehicle.throttle = 0; d.car.vehicle.brake = driving ? 0 : 1; }
    }

    for (const car of this.cars) car.update(dt, world, this.renderer);

    this.resolveCollisions(dt, (car) => {
      const hit = world.query(car.pos[0], car.pos[2]);
      if (!hit || hit.path !== scene.track) return null;
      return { limit: scene.barrierOffset(hit.index) - 1.1, hit };
    });

    // Lap timing and standings.
    const lapLen = rs.lapLength;
    for (const car of this.cars) {
      const p = progressOnSpline(scene.track.spline, car.pos[0], car.pos[2], car.hint);
      car.hint = p.index;
      let along = p.along - rs.startAlong;
      if (along < 0) along += lapLen;
      const prev = car.lastAlong === undefined ? along : car.lastAlong;
      // Detect crossing the start line in the correct direction.
      if (prev > lapLen * 0.75 && along < lapLen * 0.25) {
        if (rs.started && !car.finished) this.onLapComplete(car, rs);
      } else if (prev < lapLen * 0.25 && along > lapLen * 0.75) {
        car.lap = Math.max(0, car.lap - 1);   // reversed over the line
      }
      car.lastAlong = along;
      car.totalProgress = car.lap * lapLen + along;
    }

    const order = this.cars.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.totalProgress - a.totalProgress;
    });
    const leader = order[0];
    for (let i = 0; i < order.length; i++) {
      order[i].position = i + 1;
      const gapMetres = Math.max(0, leader.totalProgress - order[i].totalProgress);
      order[i].gapToLeader = gapMetres / Math.max(12, leader.vehicle.speed);
    }
    rs.order = order;

    // Wrong way warning.
    const pIdx = this.player.hint;
    const tan = scene.track.spline.tangents[pIdx];
    const fwd = this.player.forward();
    rs.wrongWay = this.player.vehicle.speed > 6 && (fwd[0] * tan[0] + fwd[2] * tan[2]) < -0.35;

    // Reset to the track.
    if (this.input.tapped('KeyR')) this.resetPlayerToTrack();

    this.camera.update(dt, this.player, world);

    if (this.player.finished && !rs.showedResults) {
      rs.resultsTimer = (rs.resultsTimer || 0) + dt;
      if (rs.resultsTimer > 3.2) {
        rs.showedResults = true;
        this.finishRace();
      }
    }
  }

  onLapComplete(car, rs) {
    car.lap += 1;
    const now = rs.elapsed;
    const lapTime = now - car.lapStart;
    car.lapStart = now;
    if (car.lap > 1 || true) {
      if (lapTime > 5) {
        car.lapTimes.push(lapTime);
        car.lastLapTime = lapTime;
        if (!car.bestLapTime || lapTime < car.bestLapTime) car.bestLapTime = lapTime;
      }
    }
    if (car.lap >= rs.totalLaps) {
      car.finished = true;
      car.finishTime = now;
      rs.finishedCount++;
      if (car === this.player) {
        this.hud.message('FINISH', 3.0, 'big');
        this.audio.chime();
      }
    } else if (car === this.player) {
      this.hud.message(`LAP ${car.lap + 1} / ${rs.totalLaps}   ${formatTime(lapTime)}`, 2.6,
        car.bestLapTime === lapTime ? 'good' : 'info');
      this.audio.blip(880, 0.12, 'sine', 0.14);
    }
  }

  resetPlayerToTrack() {
    const scene = this.scene;
    const car = this.player;
    const legRoute = this.state === 'drive' && this.legs ? this.leg().route : null;
    const sp = legRoute ? legRoute.spline
      : (scene.track ? scene.track.spline : scene.route.spline);
    // Start from wherever the game already thinks we are. Searching a narrow
    // window from index 0 finds the beginning of the road no matter how far
    // along it you are, so recovery on the drive home used to dump the car a
    // kilometre back down the route - or, wedged against a wall, nowhere at all.
    const hint = legRoute && this.driveState ? this.driveState.hint
      : (car.hint || 0);
    let i = nearestIndex(sp, car.pos[0], car.pos[2], hint, 40);
    const near = sp.points[i];
    if (Math.hypot(car.pos[0] - near[0], car.pos[2] - near[2]) > 60) {
      i = nearestIndex(sp, car.pos[0], car.pos[2], hint, sp.count >> 1);
    }
    const p = sp.points[i], t = sp.tangents[i];
    const yaw = Math.atan2(t[0], t[2]);
    // On a public road, put the car back on its own side rather than astride
    // the white line.
    const lane = legRoute ? legRoute.spline.normals[i] : null;
    const off = lane ? Math.min(2.1, legRoute.halfWidth * 0.5) : 0;
    car.setPose(p[0] + (lane ? lane[0] * off : 0), p[2] + (lane ? lane[2] * off : 0),
      yaw, scene.world);
    car.vehicle.gear = GEAR_FIRST;
    this.hud.message('Back on track', 1.5);
    if (this.driveState) this.registerPenalty('Recovered', 5);
  }

  finishRace() {
    const rs = this.raceState;
    const order = rs.order || this.cars;
    const results = order.map((c, i) => ({
      pos: i + 1,
      name: c.name,
      best: c.bestLapTime,
      total: c.finished ? c.finishTime : null,
      isPlayer: c === this.player,
      gap: c.finished && order[0].finished ? c.finishTime - order[0].finishTime : null,
    }));
    this.state = 'results';
    this.ui.showResults(results, this.player.position, rs.totalLaps);
  }

  // --- drive home -----------------------------------------------------------

  registerPenalty(reason, amount) {
    const ds = this.driveState;
    if (!ds) return;
    ds.rating = clamp(ds.rating - amount, 0, 100);
    ds.penaltyText = `-${Math.round(amount)} ${reason}`;
    ds.penaltyTimer = 2.4;
    if (amount >= 6) this.hud.message(`${reason}  -${Math.round(amount)}`, 1.8, 'bad');
  }

  updateDrive(dt) {
    const scene = this.scene;
    const ds = this.driveState;
    const world = scene.world;
    const car = this.player;
    const v = car.vehicle;

    ds.elapsed += dt;
    ds.penaltyTimer = Math.max(0, ds.penaltyTimer - dt);
    if (ds.penaltyTimer === 0) ds.penaltyText = '';

    this.applyPlayerInput(dt, !ds.arrived);
    this.lightSystem.update(dt);

    // Indicators.
    if (this.input.tapped('KeyZ')) {
      car.indicator = car.indicator === -1 ? 0 : -1;
      if (car.indicator) this.audio.indicator();
    }
    if (this.input.tapped('KeyX')) {
      car.indicator = car.indicator === 1 ? 0 : 1;
      if (car.indicator) this.audio.indicator();
    }
    this.audio.horn(this.input.held('KeyH') || this.touch.hornHeld());

    // Traffic: only simulate what is nearby.
    const alive = [];
    for (const t of this.traffic) {
      const d = Math.hypot(t.car.pos[0] - car.pos[0], t.car.pos[2] - car.pos[2]);
      if (d < 320) {
        t.update(dt, world, [car, ...this.traffic.map((o) => o.car)], scene.trafficLights || []);
        t.car.update(dt, world, d < 110 ? this.renderer : null);
      }
      if (!t.done) alive.push(t);
      else {
        // Recycle the car back to the far end of its path.
        t.done = false;
        t.direction *= -1;
        t.laneOffset *= -1;
        t.placeAt(t.direction > 0 ? 4 : t.path.spline.count - 5, world);
        alive.push(t);
      }
    }
    this.traffic = alive;

    car.update(dt, world, this.renderer);

    this.resolveCollisions(dt, (c) => {
      const hit = world.query(c.pos[0], c.pos[2]);
      if (!hit) return null;
      return { limit: hit.path.halfWidth + 6.5, hit };
    });

    // --- progress and navigation ------------------------------------------
    const leg = this.leg();
    const sp = leg.route.spline;
    // Once you leave the route the windowed search has nothing useful to track,
    // so re-find the nearest point on the whole road from time to time. Without
    // it, driving three streets across and coming back rejoins the route with
    // the game still convinced you are a kilometre away.
    ds.reacquire = (ds.reacquire || 0) - dt;
    if (ds.roaming && ds.reacquire <= 0) {
      ds.reacquire = 0.5;
      ds.hint = nearestIndex(sp, car.pos[0], car.pos[2], ds.hint, sp.count >> 1);
    }
    const prog = progressOnSpline(sp, car.pos[0], car.pos[2], ds.hint);
    ds.hint = prog.index;

    // Free roam. Every street connects, so you can leave the route wherever you
    // like - but then none of the route's bookkeeping means anything: its zone
    // is not the road you are on, its centreline is not the lane you should be
    // in, and the distance left along it is not how far you are from home. So
    // while you are away the scoring stops and the satnav switches to pointing
    // at the house.
    const roamNow = Math.abs(prog.lateral) > leg.route.halfWidth + 12;
    if (roamNow !== ds.roaming) {
      ds.roaming = roamNow;
      if (roamNow) this.hud.message('FREE ROAM — the satnav will wait', 2.6);
      else this.hud.message('BACK ON ROUTE', 1.8);
    }
    const frac = prog.along / leg.length;
    // Off the route, the speed limit is whatever road you are actually on.
    const here = ds.roaming ? world.query(car.pos[0], car.pos[2]) : null;
    const zone = ds.roaming
      ? { limit: here && here.path.halfWidth > 4.6 ? 50 : 30,
        label: (here && here.path.name) || 'Ashcombe' }
      : leg.zoneAt(clamp(frac, 0, 1));

    // The last stretch is the driveway, which is its own path and not part of
    // the route spline. Counting only the route runs the satnav down to zero
    // while the house is still 35 m away, and then says nothing at all - you
    // are told you have arrived while parked in the street. Add the driveway,
    // and once the route is behind you measure straight to the door.
    const dest = leg.destination;
    const distHome = dest ? Math.hypot(car.pos[0] - dest.x, car.pos[2] - dest.z) : Infinity;
    const onRoute = Math.max(0, leg.length - prog.along);
    const remaining = ds.roaming ? distHome
      : ((onRoute > 25 || !leg.last) ? onRoute + leg.tail + leg.ahead : distHome);

    // Reached the end of this road: cross onto the next one.
    if (!leg.last && onRoute < 5 && Math.abs(prog.lateral) < leg.route.halfWidth + 6) {
      this.advanceLeg();
      return;
    }

    // Speeding.
    const kmh = Math.abs(v.speedKmh);
    const speeding = kmh > zone.limit + 8;
    if (speeding && !ds.roaming) {
      ds.speedingTimer += dt;
      if (ds.speedingTimer > 1.0) {
        ds.speedingTimer = 0;
        this.registerPenalty('Speeding', 3);
      }
    } else ds.speedingTimer = 0;

    // Wrong side of the road (right-hand traffic).
    const onRoad = Math.abs(prog.lateral) < leg.route.halfWidth + 0.5;
    const forwardish = (car.forward()[0] * sp.tangents[prog.index][0] + car.forward()[2] * sp.tangents[prog.index][2]) > 0.2;
    if (!ds.roaming && onRoad && forwardish && prog.lateral < -0.9 && kmh > 12) {
      ds.wrongSideTimer += dt;
      if (ds.wrongSideTimer > 1.6) {
        ds.wrongSideTimer = 0;
        this.registerPenalty('Wrong side', 4);
      }
    } else ds.wrongSideTimer = 0;

    // Red lights. Only the ones on the route are wired up.
    for (const light of (ds.roaming ? [] : leg.lights)) {
      const key = light;
      const dist = light.along - prog.along;
      const armed = ds.redLightArmed.get(key);
      if (dist > 2 && dist < 70) {
        ds.redLightArmed.set(key, light.state);
      } else if (dist <= 0 && dist > -18 && armed === 'red' && ds.redLightArmed.get(key) !== 'done') {
        ds.redLightArmed.set(key, 'done');
        if (light.state === 'red') this.registerPenalty('Ran a red light', 20);
      }
      if (dist > 5 && dist < 45 && light.state === 'red' && kmh > 30) {
        this.hud.message('RED LIGHT AHEAD', 0.6, 'bad');
      }
    }

    // The shop. Optional, unscored, and the only reason to stop on the way
    // home that is not a red light.
    const shop = leg.last ? scene.shopStop : null;
    ds.shopNear = false;
    if (shop && !ds.shopped) {
      const d = Math.hypot(car.pos[0] - shop.x, car.pos[2] - shop.z);
      if (d < shop.radius) {
        ds.shopNear = true;
        if (v.speed < 1.0) {
          ds.shopTimer += dt;
          if (ds.shopTimer > 1.6) {
            ds.shopped = true;
            this.audio.chime();
            this.hud.message('STOPPED AT THE SHOP', 2.6, 'big');
          }
        } else ds.shopTimer = 0;
      } else {
        ds.shopTimer = 0;
      }
    }

    // Satnav instruction from the shape of the road ahead.
    const nav = this.computeNavigation(sp, prog, remaining, leg, onRoute);
    if (ds.roaming) {
      // No turn-by-turn off the route - there is no route to give turns for.
      // Point at the house and let the player find their own way back.
      const target = leg.last && dest ? dest : { x: sp.points[sp.count - 1][0], z: sp.points[sp.count - 1][2] };
      const bearing = Math.atan2(target.x - car.pos[0], target.z - car.pos[2]);
      nav.instruction = 'Head home';
      nav.distance = Math.hypot(target.x - car.pos[0], target.z - car.pos[2]);
      nav.angle = wrapAngle(bearing - v.yaw);
      nav.compass = true;
    }
    if (shop && !ds.shopped) {
      const ahead = shop.along - prog.along;
      if (ahead > -12 && ahead < 220) {
        const hand = shop.side < 0 ? 'left' : 'right';
        nav.instruction = ahead < 30 ? `Shop on the ${hand} — pull in to stop`
          : `Village shop on the ${hand}`;
        nav.distance = Math.max(0, ahead);
        nav.angle = 0;
      }
    }

    // Arrival. Only the last leg has a driveway at the end of it.
    if (dest && !ds.arrived && distHome < dest.radius && v.speed < 1.2) {
      ds.arrived = true;
      ds.arrivalTimer = 0;
      this.audio.chime();
      this.hud.message('YOU MADE IT HOME', 4.0, 'big');
    }
    if (ds.arrived) {
      ds.arrivalTimer += dt;
      v.throttle = 0;
      v.brake = 1;
      if (ds.arrivalTimer > 3.0 && this.state === 'drive') {
        this.state = 'arrived';
        this.ui.showArrived({
          rating: Math.round(ds.rating),
          time: ds.elapsed,
          distance: v.odometer,
          crashes: ds.crashes,
          shopped: ds.shopped,
        });
      }
    }

    ds.nav = nav;
    ds.zone = zone;
    ds.remaining = remaining;
    ds.speeding = speeding;
    ds.distHome = distHome;

    if (this.input.tapped('KeyR')) this.resetPlayerToTrack();
    this.camera.update(dt, car, world);

    // Nudge the player if they stall for a long time.
    this.hintTimer += dt;
    if (v.speed < 0.6 && this.hintTimer > 12 && !ds.arrived) {
      this.hintTimer = 0;
      this.hud.message('W / ↑ to drive, S / ↓ to brake', 3.0);
    } else if (v.speed > 3) this.hintTimer = 0;
  }

  computeNavigation(sp, prog, remaining, leg, onRoute) {
    const n = sp.count;
    const spacing = sp.length / n;
    // Find where the road next changes direction meaningfully.
    let turnIdx = -1, turnAngle = 0;
    const start = prog.index;
    for (let k = 3; k < Math.min(n - start - 2, Math.round(320 / spacing)); k++) {
      const i = clamp(start + k, 0, n - 1);
      const a = sp.tangents[clamp(i - 3, 0, n - 1)];
      const b = sp.tangents[clamp(i + 3, 0, n - 1)];
      const ang = wrapAngle(Math.atan2(b[0], b[2]) - Math.atan2(a[0], a[2]));
      if (Math.abs(ang) > 0.34) { turnIdx = i; turnAngle = ang; break; }
    }
    let instruction = 'Continue ahead';
    let distance = 0;
    // The house only exists at the end of the last leg. Approaching the end of
    // the pit lane is not approaching a driveway.
    if (!leg.last) {
      if (onRoute < 140) {
        instruction = leg.endText;
        distance = Math.max(0, onRoute);
        turnAngle = 0;
      } else if (turnIdx >= 0) {
        distance = (turnIdx - start) * spacing;
        const dir = turnAngle > 0 ? 'right' : 'left';
        instruction = distance < 45 ? `Bear ${dir} now` : `Bear ${dir}`;
      }
      return { instruction, distance, angle: turnAngle };
    }
    if (remaining < 12) {
      instruction = 'Stop on the driveway';
      distance = 0;
      turnAngle = 0;
    } else if (onRoute <= 25) {
      // Off the end of the road and onto the concrete.
      instruction = 'Up the drive to the garage';
      distance = Math.max(0, remaining - 4);
      turnAngle = 0;
    } else if (remaining < 110) {
      // The driveway leaves the road on the side the house is on, and this is
      // the one turn the road itself gives no hint about.
      instruction = `Turn ${leg.tailSide < 0 ? 'left' : 'right'} into the driveway`;
      distance = Math.max(0, onRoute);
      turnAngle = leg.tailSide < 0 ? -1 : 1;
    } else if (turnIdx >= 0) {
      distance = (turnIdx - start) * spacing;
      const dir = turnAngle > 0 ? 'right' : 'left';
      const sharp = Math.abs(turnAngle) > 0.85;
      instruction = distance < 45
        ? `${sharp ? 'Turn' : 'Bear'} ${dir} now`
        : `${sharp ? 'Turn' : 'Bear'} ${dir}`;
    }
    // Upcoming traffic light overrides the instruction when close.
    for (const light of leg.lights) {
      const d = light.along - prog.along;
      if (d > 0 && d < 120) {
        instruction = light.state === 'red' ? 'Stop at the lights' : 'Lights ahead';
        distance = d;
        break;
      }
    }
    return { instruction, distance, angle: turnAngle };
  }

  // --- audio ----------------------------------------------------------------

  updateAudio(dt) {
    if (!this.player) return;
    const v = this.player.vehicle;
    let slip = 0, roughness = 0, onGround = 0;
    for (const w of v.wheels) {
      slip = Math.max(slip, clamp((w.slipSpeed - 3.5) / 14, 0, 1) * (w.surface.dust ? 0.25 : 1));
      roughness = Math.max(roughness, w.surface.rumble);
      if (w.contact) onGround = 1;
    }
    this.audio.update({
      rpm: v.rpm,
      throttle: v.throttle,
      speed: v.speed,
      slip,
      roughness,
      onGround,
      inside: this.camera.inside,
      muted: this.state === 'menu' || this.paused,
    }, dt);
  }

  // --- draw -----------------------------------------------------------------

  draw(dt) {
    const canvas = this.renderer.canvas;
    const maxDpr = this.isTouch ? 1.5 : (this.settings.quality === 'high' ? 2 : 1);
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.resize(w, h, dpr);
    this.hud.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
    this.hud.compact = this.isTouch || Math.min(w, h) < 520;

    if (this.state === 'loading' || !this.scene) return;

    this.camera.applyProjection(canvas.width / canvas.height);
    this.renderer.beginFrame(dt);

    const scene = this.scene;
    const camPos = this.camera.pos;

    // Static world.
    const identity = m4.create();
    const cam = this.camera;
    this.renderer.submitChunked(scene.meshes.terrain, identity, NO_SHADOW, cam);
    this.renderer.submitChunked(scene.meshes.road, identity, NO_SHADOW, cam);
    this.renderer.submitChunked(scene.meshes.props, identity, EMPTY_OPTS, cam);

    // Cars.
    const headlight = this.player.headlightsOn ? {
      pos: this.player.localToWorld([0, 0.6, 2.3]),
      dir: this.player.forward(),
    } : null;

    for (const car of this.cars) {
      const d = Math.hypot(car.pos[0] - camPos[0], car.pos[2] - camPos[2]);
      const isPlayer = car === this.player;
      car.render(this.renderer, {
        hideInterior: !isPlayer && d > 45,
        inside: isPlayer && this.camera.inside,
        // Rigging arms costs four draw calls a car; nobody can see them on a
        // rival two corners away.
        hideArms: !isPlayer && d > 16,
      });
      car.submitLights(this.renderer, this.renderer.ambience.night);
    }

    for (const t of this.traffic) {
      const car = t.car;
      const d = Math.hypot(car.pos[0] - camPos[0], car.pos[2] - camPos[2]);
      if (d > 340) continue;
      this.renderTrafficCar(car, d);
    }

    // Traffic light lamps.
    if (scene.trafficLights) {
      for (const light of scene.trafficLights) {
        const colors = TrafficLightSystem.lampColors(light.state);
        for (let k = 0; k < light.lamps.length; k++) {
          const c = colors[k % 3];
          const on = (k % 3) === (light.state === 'red' ? 0 : (light.state === 'amber' ? 1 : 2));
          this.renderer.addGlow(light.lamps[k], c, on ? 0.26 : 0.14, on ? 0.95 : 0.10);
        }
      }
    }

    // Start lights on the gantry.
    if (this.state === 'race' && scene.lights && !this.raceState.started) {
      const lit = 5 - Math.min(5, Math.floor(this.raceState.countdown));
      for (let i = 0; i < 5; i++) {
        if (i < lit) this.renderer.addGlow(scene.lights[i], [1.0, 0.08, 0.04], 0.55, 0.95);
      }
    }

    const focus = [this.player.pos[0], this.player.pos[1], this.player.pos[2]];
    this.camera.speedBlur = this.camera.speedBlur;
    this.renderer.render(this.camera, focus);

    this.drawHud();
  }

  renderTrafficCar(car, distance) {
    const v = car.vehicle;
    const drop = car.bodyDrop();
    m4.compose(car.bodyMatrix, [v.pos[0], v.pos[1] - drop, v.pos[2]], v.yaw, v.pitch, v.roll);
    this.renderer.submit(this.trafficMeshes.body, car.bodyMatrix, {
      paint: car.livery.paint,
      stripe: car.livery.stripe,
      livery: car.livery.style,
      roundel: false,
      dirt: 0.25,
      noShadow: distance > 130,
    });
    this.renderer.submit(this.trafficMeshes.glass, car.bodyMatrix, { transparent: true, alpha: 0.9 });
    if (distance < 170) {
      for (let i = 0; i < 4; i++) {
        const w = v.wheels[i];
        const wm = m4.compose(m4.create(), [w.x * 0.94, 0.32 - w.compression + drop, w.z * 0.92], w.steer, 0, 0);
        m4.multiply(wm, car.bodyMatrix, wm);
        const spin = m4.rotationX(m4.create(), w.spin);
        m4.multiply(wm, wm, spin);
        this.renderer.submit(this.trafficMeshes.wheel, wm, { noShadow: distance > 90 });
      }
    }
    // Lights.
    const night = this.renderer.ambience.night;
    if (night > 0.15) {
      for (const sx of [-0.58, 0.58]) {
        const p = car.localToWorld([sx, 0.63, 2.06]);
        this.renderer.addGlow(p, [1.0, 0.94, 0.80], 0.30, 0.5);
      }
    }
    for (const sx of [-0.62, 0.62]) {
      const p = car.localToWorld([sx, 0.70, -2.14]);
      const on = Math.max(car.brakeGlow, night * 0.5);
      if (on > 0.05) this.renderer.addGlow(p, [1.0, 0.10, 0.05], 0.22, 0.3 * on + car.brakeGlow * 0.3);
    }
  }

  drawHud() {
    this.hud.begin();
    if (this.state === 'race') {
      const rs = this.raceState;
      const p = this.player;
      this.hud.drawRace({
        player: p,
        cars: this.cars,
        standings: rs.order || this.cars,
        position: p.position,
        fieldSize: this.cars.length,
        lap: p.lap + 1,
        totalLaps: rs.totalLaps,
        currentLapTime: rs.started ? rs.elapsed - p.lapStart : 0,
        bestLapTime: p.bestLapTime,
        gapAhead: (() => {
          const order = rs.order || [];
          const idx = order.indexOf(p);
          if (idx <= 0) return Infinity;
          return Math.abs(order[idx].gapToLeader - order[idx - 1].gapToLeader);
        })(),
        trackSpline: this.scene.track.spline,
        countdown: rs.countdown,
        wrongWay: rs.wrongWay,
      });
    } else if (this.state === 'drive' || this.state === 'arrived') {
      const ds = this.driveState;
      if (!ds || !ds.nav) return;
      this.hud.drawDrive({
        player: this.player,
        cars: [this.player, ...this.traffic.map((t) => t.car)],
        routeSpline: (this.legs ? this.leg().route : this.scene.route).spline,
        destination: this.legs ? this.leg().destination : this.scene.destination,
        lights: (this.legs ? this.leg().lights : this.scene.trafficLights) || [],
        speedLimit: ds.zone.limit,
        roadName: ds.zone.label,
        speeding: ds.speeding,
        distanceRemaining: ds.remaining,
        instruction: ds.nav.instruction,
        turnDistance: ds.nav.distance,
        shopPrompt: ds.shopNear && !ds.shopped ? 'Stop here to visit the shop' : null,
        roaming: ds.roaming,
        roads: this.scene.roadSplines,
        turnAngle: ds.nav.angle,
        rating: ds.rating,
        penaltyText: ds.penaltyText,
      });
    } else {
      this.hud.drawMessages();
    }
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
