/**
 * Redline Rider — entry point.
 *
 * Owns the lifecycle (menu -> load -> race -> finish), the fixed-step
 * simulation loop and the wiring between every subsystem.
 */

import * as THREE from 'three';

import { Renderer, webglAvailable } from './engine/renderer.js';
import { detectTier, getTierSettings, isTouchDevice } from './engine/quality.js';
import { Sky } from './engine/sky.js';
import { PostFx } from './engine/post.js';
import { disposeTextures, setTextureScale } from './engine/textures.js';
import { clamp, damp, MPS_TO_MPH } from './engine/util.js';

import { Track, TRACK_PRESETS } from './world/track.js';
import { RoadBuilder } from './world/road.js';
import { Scenery } from './world/props.js';
import { Rain, Spray } from './world/weather.js';

import { Bike } from './entities/bike.js';
import { BikePhysics } from './entities/physics.js';
import { Traffic } from './entities/traffic.js';

import { Input } from './game/input.js';
import { ChaseCamera } from './game/camera.js';
import { RaceState, PHASE } from './game/state.js';
import { Audio } from './game/audio.js';

import { Hud, Overlays } from './ui/hud.js';

/**
 * Simulation step. Physics is integrated at a fixed rate for repeatability.
 *
 * MAX_STEPS * FIXED_DT is deliberately equal to the frame-delta clamp in
 * `_frame`: that guarantees the sim can always consume a whole frame's worth
 * of time, so a device running slowly renders fewer frames rather than
 * dropping into slow motion, while a stalled tab still can't spiral.
 */
const FIXED_DT = 1 / 100;
const MAX_STEPS = 10;
const MAX_FRAME_DT = FIXED_DT * MAX_STEPS;

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.overlays = new Overlays();

    if (!webglAvailable()) {
      this.overlays.showError(
        'This browser can\'t create a WebGL context. Try a recent Safari, Chrome or Firefox with hardware acceleration enabled.',
      );
      return;
    }

    this.settings = getTierSettings(detectTier());
    this.qualityChoice = 'auto';
    this.touch = isTouchDevice();

    this.scene = new THREE.Scene();
    this.renderer = new Renderer(this.canvas, this.settings);
    this.chase = new ChaseCamera(this.renderer.width / this.renderer.height);
    this.renderer.camera = this.chase.camera;

    this.state = new RaceState();
    this.hud = new Hud();
    this.input = new Input();
    this.audio = new Audio();

    this.world = null;
    this.post = null;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this._renderState = {};
    this._sprayOrigin = new THREE.Vector3();

    this._bindUi();
    this._bindLifecycle();
    this._checkOrientation();

    this.overlays.progress(1, 'Ready');
    this.overlays.show('menu');
    this.hud.setUnit('mph');

    // Nothing to render behind the menu yet, so start the loop only once a
    // track has been built. The menu is plain DOM over a flat background.
    this.canvas.style.opacity = '0';
  }

  /* ================================================================
     UI wiring
     ================================================================ */

  _bindUi() {
    // --- menu ---
    document.querySelectorAll('.menu-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.track;
        this.startTrack(id);
      });
    });

    document.getElementById('opt-quality').addEventListener('change', (e) => {
      this.qualityChoice = e.target.value;
    });
    document.getElementById('opt-units').addEventListener('change', (e) => {
      this.hud.setUnit(e.target.value);
    });
    document.getElementById('opt-steer').addEventListener('change', async (e) => {
      if (e.target.value === 'tilt') {
        const ok = await this.input.enableTilt();
        if (!ok) {
          e.target.value = 'buttons';
          this.hud.toast('Motion access was declined', { warn: true });
        }
      } else {
        this.input.disableTilt();
      }
      this._syncTiltChip();
    });

    // --- hold controls ---
    this.input.bindHold(document.getElementById('btn-left'), 'left');
    this.input.bindHold(document.getElementById('btn-right'), 'right');
    this.input.bindHold(document.getElementById('btn-brake'), 'brake');
    this.input.bindHold(document.getElementById('btn-throttle'), 'throttle');
    this.input.bindHold(document.getElementById('btn-wheelie'), 'wheelie');

    // --- tap controls ---
    this.input.bindTap(document.getElementById('btn-pause'), 'pause');
    this.input.bindTap(document.getElementById('btn-camera'), 'camera');
    this.input.bindTap(document.getElementById('btn-restart'), 'restart');
    this.input.bindTap(document.getElementById('btn-flip'), 'flip');

    this.input.on('pause', () => this.togglePause());
    this.input.on('camera', () => this.cycleCamera());
    this.input.on('restart', () => this.restart());
    this.input.on('flip', () => this.recover());

    document.getElementById('btn-tilt').addEventListener('click', async () => {
      if (this.input.tiltEnabled) {
        this.input.disableTilt();
      } else {
        const ok = await this.input.enableTilt();
        if (!ok) this.hud.toast('Motion access was declined', { warn: true });
      }
      this._syncTiltChip();
    });

    // --- panels ---
    document.getElementById('btn-resume').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-pause-restart').addEventListener('click', () => this.restart());
    document.getElementById('btn-quit').addEventListener('click', () => this.toMenu());
    document.getElementById('btn-again').addEventListener('click', () => this.restart());
    document.getElementById('btn-finish-menu').addEventListener('click', () => this.toMenu());
  }

  _syncTiltChip() {
    const chip = document.getElementById('btn-tilt');
    chip.setAttribute('aria-pressed', this.input.tiltEnabled ? 'true' : 'false');
    document.getElementById('opt-steer').value = this.input.tiltEnabled ? 'tilt' : 'buttons';
  }

  _bindLifecycle() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state.running) this.togglePause();
        this.audio.suspend();
      } else {
        // Swallow the wall-clock gap so the sim doesn't try to catch up.
        this.lastTime = performance.now();
        this.accumulator = 0;
      }
    });

    window.addEventListener('orientationchange', () => {
      setTimeout(() => this._checkOrientation(), 200);
    });
    window.addEventListener('resize', () => this._checkOrientation());

    // Losing the GL context is recoverable in principle, but rebuilding the
    // whole world is not worth it — tell the player plainly.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.running = false;
      this.overlays.showError('The graphics context was lost. Reload the page to keep riding.');
    });
  }

  _checkOrientation() {
    // Only nag on phone-sized screens; a tablet in portrait is still playable.
    const portrait = window.innerHeight > window.innerWidth;
    const small = Math.min(window.innerWidth, window.innerHeight) < 500;
    this.overlays.setRotatePrompt(this.touch && portrait && small);
  }

  /* ================================================================
     Track lifecycle
     ================================================================ */

  async startTrack(id) {
    const preset = TRACK_PRESETS[id];
    if (!preset) return;

    // Audio must be unlocked from inside the gesture that got us here.
    this.audio.start().then(() => this.audio.setActive(true));

    this.overlays.show('loading');
    this.overlays.progress(0, 'Laying the road…');

    if (this.qualityChoice !== 'auto') {
      this.settings = getTierSettings(this.qualityChoice);
    }
    // Must happen before any texture is built: changing it invalidates the
    // procedural texture cache, so doing it mid-build would strand materials
    // holding disposed textures.
    setTextureScale(this.settings.textureScale);

    await this._teardownWorld();
    await this._buildWorld(preset);

    this.state.start(id);
    this.hud.attachTrack(this.world.track);
    this.hud.setObjective(this.state.objective, false);
    this.hud.show();
    this.overlays.hideAll();
    this.canvas.style.opacity = '1';

    this.lastTime = performance.now();
    this.accumulator = 0;
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this._frame);
    }
  }

  async _buildWorld(preset) {
    const step = async (fraction, label, fn) => {
      this.overlays.progress(fraction, label);
      // Yield twice: once to paint the label, once to let the browser settle
      // before a long synchronous build blocks the main thread again.
      await nextFrame();
      await nextFrame();
      return fn();
    };

    const settings = this.settings;
    const world = {};

    world.track = await step(0.08, 'Laying the road…', () => new Track(preset));

    world.sky = await step(0.2, 'Raising the sky…', () => {
      const sky = new Sky(this.scene, preset.sky, settings);
      if (preset.mountains) sky.addMountains(preset.mountains);
      return sky;
    });

    await step(0.32, 'Baking reflections…', () => {
      world.sky.buildEnvironment(this.renderer.gl);
    });

    world.road = await step(0.5, 'Painting the tarmac…', () => {
      const builder = new RoadBuilder(world.track, settings, world.sky);
      this.scene.add(builder.build());
      return builder;
    });

    world.scenery = await step(0.72, 'Planting the scenery…', () => {
      const scenery = new Scenery(world.track, settings, world.sky);
      this.scene.add(scenery.build());
      return scenery;
    });

    world.traffic = await step(0.86, 'Waking the traffic…', () =>
      new Traffic(this.scene, world.track, settings, world.sky));

    world.bike = await step(0.94, 'Warming the engine…', () => new Bike(this.scene, settings, world.sky, {
      paintColor: preset.sky === 'night' ? 0xd6202a : 0xe23a1e,
      jacketColor: preset.sky === 'night' ? 0x6d6250 : 0x8a7a5e,
    }));

    await step(0.97, 'Grading the picture…', () => {
      // The composer holds the camera, so it is rebuilt per track alongside
      // the sky it grades for.
      this.post?.dispose();
      this.post = new PostFx(this.renderer, this.scene, this.chase.camera, settings, preset.sky);
      this.renderer.attachPost(this.post.enabled ? this.post : null);
    });

    await step(0.99, 'Almost there…', () => {
      world.physics = new BikePhysics(world.track, { wet: world.sky.preset.wet });
      world.rain = new Rain(this.scene, settings, preset.rain);
      world.spray = new Spray(this.scene, settings, world.sky.preset.wet);
      world.physics.reset(world.track.startS, 0);
      world.traffic.reset(world.track.startS);
      this.chase.snap(world.physics);
      this.renderer.gl.toneMappingExposure = world.sky.preset.exposure;
    });

    this.world = world;

    // Compile everything now rather than hitching on the first frame a new
    // material scrolls into view.
    this.renderer.gl.compile(this.scene, this.chase.camera);
    this.overlays.progress(1, 'Go!');
  }

  async _teardownWorld() {
    if (!this.world) return;
    const w = this.world;
    w.rain?.dispose();
    w.spray?.dispose();
    w.traffic?.dispose();
    w.bike?.dispose();
    w.scenery?.dispose();
    w.road?.dispose();
    w.sky?.dispose();

    this.scene.clear();
    this.scene.environment = null;
    this.scene.fog = null;
    this.world = null;
    await nextFrame();
  }

  toMenu() {
    this.state.phase = PHASE.MENU;
    this.input.reset();
    this.hud.hide();
    this.audio.setActive(false);
    this.overlays.show('menu');
    // Once a track has been built, leave it rendering behind the menu — the
    // overlay is already frosted, and a live world reads far better than the
    // flat backdrop a cold start has to fall back on.
    this.canvas.style.opacity = this.world ? '1' : '0';
  }

  restart() {
    if (!this.world) return;
    const { physics, traffic, track } = this.world;
    physics.reset(track.startS, 0);
    traffic.reset(track.startS);
    this.world.spray.clear();
    this.chase.snap(physics);
    this.state.start(this.state.trackId);
    this.hud.setObjective(this.state.objective, false);
    this.input.reset();
    this.overlays.hideAll();
    this.hud.show();
    this.audio.setActive(true);
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  togglePause() {
    if (!this.world) return;
    if (this.state.phase === PHASE.PAUSED) {
      this.state.resume();
      this.overlays.hideAll();
      this.input.reset();
      this.audio.setActive(true);
      this.lastTime = performance.now();
      this.accumulator = 0;
    } else if (this.state.pause()) {
      this.overlays.fillPause(this.world.physics, this.state);
      this.overlays.show('pause');
      this.input.reset();
      this.audio.setActive(false);
    }
  }

  cycleCamera() {
    const name = this.chase.cycleMode();
    this.post?.setCamera(this.chase.camera);
    this.hud.toast(`Camera: ${name}`);
  }

  /** Manual bail-out: put the bike back on the road without waiting. */
  recover() {
    if (!this.world) return;
    const p = this.world.physics;
    if (p.crashed) {
      p.respawn();
      this.chase.snap(p);
    } else if (p.offRoad || p.speed < 2) {
      p.lateral = this.world.track.laneCentre(this.world.track.forwardLanes[0]);
      p.yawRel = 0;
      this.hud.toast('Back on the road');
    }
  }

  /* ================================================================
     Frame loop
     ================================================================ */

  _frame = (now) => {
    if (!this.running) return;
    requestAnimationFrame(this._frame);

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // A tab that was backgrounded can hand us a multi-second delta.
    const dt = clamp(rawDt, 0, MAX_FRAME_DT);

    this.renderer.tick(dt);

    if (this.world) {
      if (this.state.simulating) this._simulate(dt);
      this._present(dt);
      this.renderer.render(this.scene, this.chase.camera);
    }
  };

  _simulate(dt) {
    const { physics, traffic, track, spray } = this.world;
    const input = this.input.update(dt);

    // Hold the bike still until the lights go out.
    const gated = this.state.phase === PHASE.COUNTDOWN
      ? { throttle: 0, brake: 1, steer: 0, wheelie: false }
      : input;

    const events = {
      onCrash: (cause, speed) => this._onCrash(cause, speed),
      onRespawn: () => this.chase.snap(physics),
      onFinish: () => this._onFinish(),
      onRumble: (amount) => this.chase.addShake(amount * 0.06),
      onScrape: (speed) => {
        this.chase.addShake(0.12);
        if (speed > 20) this.audio.beep(180, 0.06, 0.08);
      },
    };

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      physics.update(gated, FIXED_DT, events);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    // If we blew the step budget, drop the backlog rather than spiral.
    if (steps === MAX_STEPS) this.accumulator = 0;

    traffic.update(
      physics,
      dt,
      (vehicle, closing) => {
        if (closing > 6) {
          physics.crash('traffic', events);
        } else {
          // A gentle nudge just pushes you off line.
          physics.lateral += Math.sign(physics.lateral - vehicle.lateral) * 0.6;
          physics.speed *= 0.94;
          this.chase.addShake(0.2);
        }
      },
      () => {
        this.state.registerNearMiss();
        this.hud.toast('Near miss +' + Math.round(120 * this.state.multiplier));
      },
    );

    // Spray and dust from the rear contact patch.
    if (spray.enabled && !physics.crashed && physics.speed > 4) {
      const wet = this.world.sky.preset.wet;
      const rate = (physics.slip * 3 + (physics.offRoad ? 3 : 0) + (wet ? 2 : 0)) *
        clamp(physics.speed / 30, 0, 2);
      if (rate > 0.4) {
        this._sprayOrigin.copy(physics.position);
        this._sprayOrigin.y += 0.1;
        spray.emit(Math.min(4, Math.round(rate)), this._sprayOrigin, physics.velocity);
      }
    }
    spray.update(dt);

    const event = this.state.update(dt, physics);
    if (event === 'tick') this.audio.beep(560, 0.14, 0.2);
    if (event === 'go') {
      this.audio.beep(880, 0.35, 0.28);
      this.hud.toast('GO!');
    }

    this.audio.update(physics, input.throttle);
    void track;
  }

  _present(dt) {
    const { physics, bike, sky, rain, traffic } = this.world;
    const render = physics.getRenderState(this._renderState);

    bike.update(render, dt);
    this.chase.update(render, physics.groundNormal, dt, 88);
    sky.update(physics.position, dt);
    rain.update(dt, this.chase.camera.position, physics.velocity);

    this.post?.update(dt, physics.speed / 88);

    this.hud.update(this.state, physics, traffic, dt);
    this.hud.setObjective(this.state.objective, !this.state.clean);
  }

  _onCrash(cause, speed) {
    this.state.registerCrash();
    this.chase.addShake(1.0);
    this.audio.crash(clamp(speed / 40, 0.3, 1));
    this.hud.toast(cause === 'traffic' ? 'Hit traffic' : 'Off the road', { warn: true });
    this.hud.setObjective(this.state.objective, true);
  }

  _onFinish() {
    if (this.state.phase === PHASE.FINISHED) return;
    const result = this.state.finish(this.world.physics);
    this.input.reset();
    this.overlays.fillFinish(this.state, result);
    this.overlays.show('finish');
    this.audio.setActive(false);
    this.audio.beep(660, 0.2, 0.25);
    setTimeout(() => this.audio.beep(990, 0.4, 0.25), 180);
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Boot.
const game = new Game();
// Debug handle: lets the browser console (and the test harness) poke at the
// live simulation without exporting anything the game itself depends on.
window.__game = game;
window.addEventListener('pagehide', () => {
  game.audio?.dispose();
  disposeTextures();
});
