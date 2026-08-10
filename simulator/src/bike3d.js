/* 3D bike + rider built from primitives, with working suspension animation.
   Local frame: +X forward (direction of travel), +Y up, origin at the
   midpoint between wheel contact patches. */
import * as THREE from "three";
import { WHEEL_R, AF, AR, clamp, lerp } from "./physics.js";
import { makeSkinTexture, makeFaceTexture, makeJerseyTexture, makeShortsTexture } from "./textures.js";

/* Rider looks are cached: six racers share a handful of skin tones, and
   rebuilding these canvases per bike would stall the first frame. */
const skinCache = new Map(), faceCache = new Map(), jerseyCache = new Map(), shortsCache = new Map();
const cached = (map, key, make) => { let v = map.get(key); if(!v){ v = make(); map.set(key, v); } return v; };

function tubeBetween(a, b, r, mat, seg=18){
  const d = new THREE.Vector3().subVectors(b,a);
  const len = d.length();
  const geo = new THREE.CylinderGeometry(r, r, len, seg);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize());
  m.castShadow = true;
  return m;
}

function makeWheel(mats, knobby){
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R-0.02, knobby?0.024:0.019, 20, 56), mats.tire);
  tire.castShadow = true;
  g.add(tire);
  // rim: a deep-section box profile rather than a thin ring
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R-0.045, 0.011, 14, 56), mats.rim);
  g.add(rim);
  const rimBed = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R-0.036, WHEEL_R-0.036, 0.021, 56, 1, true), mats.rim);
  rimBed.rotation.x = Math.PI/2;
  g.add(rimBed);
  // 16 spokes, laced alternately to each flange
  for(let k=0;k<16;k++){
    const a = k/16*Math.PI*2;
    const sp = tubeBetween(new THREE.Vector3(0,0,(k%2?0.032:-0.032)),
      new THREE.Vector3(Math.cos(a)*(WHEEL_R-0.05), Math.sin(a)*(WHEEL_R-0.05), 0),
      0.0028, mats.rim, 6);
    g.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.024,0.024,0.10,18), mats.rim);
  hub.rotation.x = Math.PI/2;
  g.add(hub);
  for(const z of [-0.038, 0.038]){                      // hub flanges
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.036,0.036,0.008,18), mats.rim);
    fl.rotation.x = Math.PI/2; fl.position.z = z; g.add(fl);
  }
  // brake rotor — every bike here is disc-braked
  const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.004, 6, 36), mats.rotor);
  rotor.position.z = -0.05; g.add(rotor);
  const rotorFace = new THREE.Mesh(new THREE.CylinderGeometry(0.082,0.082,0.002,36), mats.rotor);
  rotorFace.rotation.x = Math.PI/2; rotorFace.position.z = -0.05; g.add(rotorFace);

  // tread: side knobs on knobbies, a fine file pattern on the slicks
  const n = knobby ? 34 : 44;
  const knobGeo = knobby ? new THREE.BoxGeometry(0.018,0.016,0.034)
                         : new THREE.BoxGeometry(0.010,0.004,0.026);
  const knobs = new THREE.InstancedMesh(knobGeo, mats.tire, n*2);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0,0,1);
  const one = new THREE.Vector3(1,1,1);
  let idx = 0;
  for(let k=0;k<n;k++){
    const a = k/n*Math.PI*2;
    q.setFromAxisAngle(up, a);
    for(const z of knobby ? [0.019,-0.019] : [0.011,-0.011]){
      M.compose(new THREE.Vector3(Math.cos(a)*WHEEL_R, Math.sin(a)*WHEEL_R, z), q, one);
      knobs.setMatrixAt(idx++, M);
    }
  }
  knobs.castShadow = true;
  g.add(knobs);
  return g;
}

/* factory-paint downtube decal: paint base + brand logotype running along
   the tube on both sides (u≈0 faces +Z, u≈0.5 faces −Z after tubeBetween's
   minimal rotation, which preserves local Z for tubes in the XZ ride plane) */
function makeDecalTexture(paint){
  const W=256, H=1024;
  const cv = document.createElement("canvas"); cv.width=W; cv.height=H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = paint.css; ctx.fillRect(0,0,W,H);
  const run = (cx, flip)=>{
    ctx.save(); ctx.translate(cx, H*0.52); ctx.rotate(-Math.PI/2);
    if(flip) ctx.scale(1,-1);
    ctx.font = paint.font; ctx.fillStyle = paint.logoColor;
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(paint.logo, 0, 0);
    ctx.restore();
  };
  run(0,false); run(W,false);   // +Z side (strip wraps the seam)
  run(W/2,true);                // −Z side, mirrored so it reads correctly
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildBike(bike, kitHex, paint, look = {}){
  const skinHex = look.skin ?? 0xd9a87e;
  const hair = look.hair ?? "#2b2220";
  const accent = look.accent ?? 0x1b1c20;
  const num = look.num ?? 1;
  const skinTex   = cached(skinCache, skinHex, ()=>makeSkinTexture(skinHex));
  const faceTex   = cached(faceCache, skinHex+"|"+hair, ()=>makeFaceTexture(skinHex, { hair }));
  const jerseyTex = cached(jerseyCache, kitHex+"|"+accent+"|"+num, ()=>makeJerseyTexture(kitHex, accent, num));
  const shortsTex = cached(shortsCache, accent, ()=>makeShortsTexture(accent));
  const paintProps = { color: paint.color, metalness: paint.metalness,
    roughness: paint.roughness, clearcoat: paint.clearcoat, clearcoatRoughness: 0.3 };
  const mats = {
    frame: new THREE.MeshPhysicalMaterial(paintProps),
    decal: new THREE.MeshPhysicalMaterial({ ...paintProps, color: 0xffffff, map: makeDecalTexture(paint) }),
    carbon:new THREE.MeshStandardMaterial({ color: 0x131417, metalness: 0.3, roughness: 0.3 }),
    dark:  new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.4, roughness: 0.55 }),
    tire:  new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.95 }),
    rim:   new THREE.MeshStandardMaterial({ color: 0x3d4147, metalness: 0.75, roughness: 0.4 }),
    rotor: new THREE.MeshStandardMaterial({ color: 0xb9bdc4, metalness: 0.95, roughness: 0.25 }),
    // skin gets a hint of subsurface warmth rather than reading as plastic
    skin:  new THREE.MeshPhysicalMaterial({ map: skinTex, roughness: 0.62,
             sheen: 0.35, sheenColor: new THREE.Color(0xff9d7a), clearcoat: 0.12 }),
    face:  new THREE.MeshPhysicalMaterial({ map: faceTex, roughness: 0.6,
             sheen: 0.3, sheenColor: new THREE.Color(0xff9d7a) }),
    kit:   new THREE.MeshStandardMaterial({ color: kitHex, roughness: 0.6 }),
    kit2:  new THREE.MeshPhysicalMaterial({ map: jerseyTex, roughness: 0.52, sheen: 0.5 }),
    pants: new THREE.MeshStandardMaterial({ map: shortsTex, roughness: 0.68 }),
    shoe:  new THREE.MeshPhysicalMaterial({ color: 0xf2f3f5, roughness: 0.3, clearcoat: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x14161a, roughness: 0.08,
             metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.86 }),
  };
  const root = new THREE.Group();          // placed on terrain (pitch + position)
  const sprung = new THREE.Group();        // frame+rider; bounces with heave
  root.add(sprung);

  // key points (local, static sag pose)
  const P = {
    rAxle: new THREE.Vector3(-AR, WHEEL_R, 0),
    fAxle: new THREE.Vector3( AF, WHEEL_R, 0),
    bb:    new THREE.Vector3(-0.09, 0.28, 0),
    seat:  new THREE.Vector3(-0.33, 0.86, 0),
    head:  new THREE.Vector3( 0.28, 0.78, 0),
    barC:  new THREE.Vector3( 0.33, 0.95, 0),
  };

  // frame
  sprung.add(tubeBetween(P.seat, P.head, 0.021, mats.frame));       // top tube
  sprung.add(tubeBetween(P.bb, P.head, 0.026, mats.decal));         // down tube w/ logo
  sprung.add(tubeBetween(P.bb, P.seat, 0.019, mats.frame));         // seat tube
  for(const s of [-0.05, 0.05]){
    const rA = P.rAxle.clone().setZ(s);
    sprung.add(tubeBetween(rA, P.bb.clone().setZ(s*0.5), 0.011, mats.frame));   // chainstay
    sprung.add(tubeBetween(rA, P.seat.clone().setZ(s*0.4), 0.011, mats.frame)); // seatstay
  }
  // saddle + post
  sprung.add(tubeBetween(P.seat, P.seat.clone().add(new THREE.Vector3(0.04,0.09,0)), 0.014, mats.dark));
  const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.19, 8, 18), mats.dark);
  saddle.rotation.z = Math.PI/2; saddle.scale.set(1, 1, 0.55);
  saddle.position.copy(P.seat).add(new THREE.Vector3(0.02,0.12,0)); saddle.castShadow=true;
  sprung.add(saddle);

  // fork: steerer + two legs; for suspension bikes the lowers telescope
  const forkG = new THREE.Group(); sprung.add(forkG);
  const stemTop = P.barC.clone().add(new THREE.Vector3(-0.05,-0.03,0));
  forkG.add(tubeBetween(P.head, stemTop, 0.02, mats.dark));         // steerer/stem
  // bars pivot about the steerer axis, so the front end can be steered
  const barsG = new THREE.Group(); barsG.position.copy(P.barC); sprung.add(barsG);
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.011,0.011,0.54,10), mats.dark);
  bars.rotation.x = Math.PI/2; bars.castShadow = true;
  barsG.add(bars);
  for(const s of [-0.22, 0.22]){
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,0.11,8), mats.dark);
    grip.rotation.x = Math.PI/2; grip.position.set(0,0,s);
    barsG.add(grip);
  }

  const lowers = new THREE.Group();                                 // slides for suspension
  sprung.add(lowers);
  const legMat = bike.susp ? mats.dark : mats.carbon;               // rigid forks are carbon black
  for(const s of [-0.05, 0.05]){
    if(bike.susp){
      // upper stanchion (fixed) + lower leg (moves with wheel)
      forkG.add(tubeBetween(P.head.clone().setZ(s), lerpV(P.head, P.fAxle, 0.55).setZ(s), 0.016, mats.rim));
      lowers.add(tubeBetween(lerpV(P.head, P.fAxle, 0.45).setZ(s), P.fAxle.clone().setZ(s), 0.02, legMat));
    } else {
      forkG.add(tubeBetween(P.head.clone().setZ(s), P.fAxle.clone().setZ(s), 0.014, legMat));
    }
  }
  function lerpV(a,b,t){ return a.clone().lerp(b,t); }

  // drivetrain: chainring with teeth, cassette, chain runs and rear mech
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085,0.007,10,40), mats.rim);
  ring.position.copy(P.bb).add(new THREE.Vector3(0,0,0.06)); sprung.add(ring);
  const ringFace = new THREE.Mesh(new THREE.CylinderGeometry(0.080,0.080,0.003,40), mats.rim);
  ringFace.rotation.x = Math.PI/2; ringFace.position.copy(ring.position); sprung.add(ringFace);
  {
    const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.008,0.011,0.004), mats.rim, 38);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0,0,1);
    const one = new THREE.Vector3(1,1,1);
    for(let k=0;k<38;k++){
      const a = k/38*Math.PI*2;
      q.setFromAxisAngle(up, a);
      M.compose(new THREE.Vector3(ring.position.x+Math.cos(a)*0.091,
        ring.position.y+Math.sin(a)*0.091, ring.position.z), q, one);
      teeth.setMatrixAt(k, M);
    }
    sprung.add(teeth);
  }
  const cassette = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.032,0.042,28), mats.rim);
  cassette.rotation.x = Math.PI/2; cassette.position.copy(P.rAxle).setZ(0.045);
  sprung.add(cassette);
  sprung.add(tubeBetween(P.bb.clone().add(new THREE.Vector3(0.08,0,0.06)),
    P.rAxle.clone().setZ(0.045).add(new THREE.Vector3(0,0.05,0)), 0.004, mats.dark, 6));  // chain top run
  sprung.add(tubeBetween(P.bb.clone().add(new THREE.Vector3(-0.06,-0.02,0.06)),
    P.rAxle.clone().setZ(0.045).add(new THREE.Vector3(0,-0.05,0)), 0.004, mats.dark, 6)); // chain bottom
  const mech = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.10,0.028), mats.dark);
  mech.position.copy(P.rAxle).add(new THREE.Vector3(0.02,-0.10,0.05)); mech.castShadow = true;
  sprung.add(mech);

  const crank = new THREE.Group(); crank.position.copy(P.bb); sprung.add(crank);
  for(const s of [1,-1]){
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.028,0.17,0.013), mats.rim);
    arm.position.set(0, s*0.085, s*0.075); arm.castShadow=true;
    crank.add(arm);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.095,0.016,0.058), mats.dark);
    pedal.position.set(0, s*0.17, s*0.075);
    crank.add(pedal);
  }
  // bottles and cage
  for(const [a,b,r] of [[P.bb, P.head, 0.42]]){
    const p = a.clone().lerp(b, r);
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.033,0.033,0.19,16), mats.kit);
    bottle.position.copy(p).add(new THREE.Vector3(0.02,0.07,0.045));
    bottle.rotation.z = -0.35; bottle.castShadow = true;
    sprung.add(bottle);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014,0.017,0.035,12), mats.dark);
    cap.position.copy(bottle.position).add(new THREE.Vector3(0.033,0.095,0));
    cap.rotation.z = -0.35;
    sprung.add(cap);
  }

  // wheels
  const wheelR = makeWheel(mats, bike.tread===2); wheelR.position.copy(P.rAxle); root.add(wheelR);
  const wheelF = makeWheel(mats, bike.tread===2); wheelF.position.copy(P.fAxle); root.add(wheelF);

  // ---- rider ----
  const rider = new THREE.Group(); sprung.add(rider);
  const hip = new THREE.Vector3(-0.28, 0.98, 0);
  const shoulder = new THREE.Vector3(0.10, 1.28, 0);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 10, 24), mats.kit2);
  torso.position.copy(hip).lerp(shoulder,0.5).add(new THREE.Vector3(0,0.02,0));
  torso.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), shoulder.clone().sub(hip).normalize());
  torso.castShadow = true;
  rider.add(torso);
  // head carries the painted face; three's sphere UVs put +X at u=0.5,
  // which is the direction the rider is looking
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 26, 20), mats.face);
  head.position.copy(shoulder).add(new THREE.Vector3(0.10,0.16,0));
  head.scale.set(0.94, 1.06, 0.98);
  head.castShadow=true;
  rider.add(head);
  // sunglasses: lens shell plus arms
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.104, 22, 12, Math.PI*0.30, Math.PI*0.40, Math.PI*0.36, Math.PI*0.20), mats.glass);
  lens.position.copy(head.position); lens.scale.set(1.03, 1.0, 1.10);
  rider.add(lens);
  for(const s of [-1, 1]){
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.007, 0.006), mats.glass);
    arm.position.copy(head.position).add(new THREE.Vector3(-0.028, 0.028, s*0.086));
    rider.add(arm);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.042,0.05,0.09,14), mats.skin);
  neck.position.copy(head.position).add(new THREE.Vector3(-0.045,-0.085,0));
  neck.rotation.z = 0.5;
  rider.add(neck);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.117, 26, 18, 0, Math.PI*2, 0, Math.PI*0.55), mats.kit);
  helmet.position.copy(head.position).add(new THREE.Vector3(-0.01,0.02,0));
  helmet.castShadow = true;
  rider.add(helmet);
  for(let v=0;v<4;v++){                                   // helmet vents
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.055,0.02,0.016), mats.dark);
    vent.position.copy(helmet.position).add(new THREE.Vector3(-0.03+v*0.026, 0.098-v*0.006, 0));
    rider.add(vent);
  }
  // arms: upper arm + forearm per side
  for(const s of [-0.14, 0.14]){
    const sh = shoulder.clone().add(new THREE.Vector3(0,-0.02,s));
    const grip = P.barC.clone().add(new THREE.Vector3(-0.02,-0.01,s*1.5));
    const elbow = sh.clone().lerp(grip,0.5).add(new THREE.Vector3(-0.03,-0.04,0));
    rider.add(tubeBetween(sh, elbow, 0.036, mats.kit2, 14));      // jersey sleeve
    rider.add(tubeBetween(elbow, grip, 0.029, mats.skin, 14));    // bare forearm
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 14), mats.dark);
    hand.position.copy(grip); hand.scale.set(1, 0.8, 1.1); rider.add(hand);  // mitt
  }
  // legs: thigh + shin + shoe per side, animated
  const legs = [];
  for(const s of [-0.075, 0.075]){
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.30, 8, 18), mats.pants);
    const shin  = new THREE.Mesh(new THREE.CapsuleGeometry(0.039, 0.30, 8, 18), mats.skin);  // bare calf
    const sock  = new THREE.Mesh(new THREE.CylinderGeometry(0.041,0.044,0.11,14), mats.shoe);
    const shoe  = new THREE.Mesh(new THREE.BoxGeometry(0.105,0.042,0.058), mats.shoe);
    thigh.castShadow = shin.castShadow = shoe.castShadow = true;
    rider.add(thigh); rider.add(shin); rider.add(sock); rider.add(shoe);
    legs.push({ s, thigh, shin, sock, shoe });
  }

  return { root, sprung, rider, wheelF, wheelR, lowers, crank, barsG,
           barBaseY: P.barC.y, legs, P, hip };
}

const _up = new THREE.Vector3(0,1,0);
export function poseBikeParts(V, S){
  // wheels spin
  V.wheelF.rotation.z = -S.wheelPhase;
  V.wheelR.rotation.z = -S.wheelPhase;
  // crank
  V.crank.rotation.z = -S.pedalPhase;
  // suspension: front wheel + lowers rise toward the frame by sag
  const sag = S.suspSagF;
  V.wheelF.position.y = WHEEL_R + (S.airF? 0.03 : 0);
  V.wheelR.position.y = WHEEL_R + (S.airR? 0.03 : 0);
  V.lowers.position.y = sag;
  V.wheelF.position.y += sag;
  // heave: sprung mass bounce (visual, clamped)
  const zRel = clamp(S.z - (S._groundZ ?? S.z), -0.09, 0.09);
  V.sprung.position.y = zRel*0.55 - (S.bike.susp? sag*0.35 : 0);
  V.sprung.rotation.z = clamp(S.th, -0.1, 0.1)*0.6;
  // Future Shock: bars dip
  V.barsG.position.y = V.barBaseY + (S.bike.futureShock ? clamp(-S.fsZ*1.4, -0.012, 0.02) : 0);
  // steering (player only): front wheel and bars turn together
  const steer = S.steerVis || 0;
  V.wheelF.rotation.y = -steer;
  V.barsG.rotation.y = -steer;
  // pedaling legs via simple 2-bone IK to pedal positions
  for(const L of V.legs){
    const side = L.s > 0 ? 1 : -1;
    const ang = -S.pedalPhase + (side>0 ? 0 : Math.PI);
    const pedal = new THREE.Vector3(-0.09 + Math.sin(ang)*0.17, 0.28 - Math.cos(ang)*0.17, L.s*1.4);
    const hip = V.hip.clone().setZ(L.s);
    const mid = hip.clone().lerp(pedal, 0.5);
    const d = hip.distanceTo(pedal);
    const bend = Math.sqrt(Math.max(0.01, 0.36*0.36 - (d/2)*(d/2)));
    mid.x += bend*0.9; mid.y += bend*0.25;             // knee forward
    placeCapsule(L.thigh, hip, mid);
    placeCapsule(L.shin, mid, pedal);
    if(L.shoe){
      L.shoe.position.copy(pedal).add(new THREE.Vector3(0,0.028,0));
      if(L.sock) placeCapsule(L.sock, pedal.clone().add(new THREE.Vector3(0,0.055,0)),
        mid.clone().lerp(pedal, 0.62), 0.11);
    }
  }
}
function placeCapsule(mesh, a, b, baseLen = 0.38){
  mesh.position.copy(a).lerp(b, 0.5);
  const d = b.clone().sub(a);
  const len = d.length();
  mesh.scale.y = len/baseLen;
  mesh.quaternion.setFromUnitVectors(_up, d.normalize());
}
