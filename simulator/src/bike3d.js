/* 3D bike + rider built from primitives, with working suspension animation.
   Local frame: +X forward (direction of travel), +Y up, origin at the
   midpoint between wheel contact patches. */
import * as THREE from "three";
import { WHEEL_R, AF, AR, clamp, lerp } from "./physics.js";

function tubeBetween(a, b, r, mat){
  const d = new THREE.Vector3().subVectors(b,a);
  const len = d.length();
  const geo = new THREE.CylinderGeometry(r, r, len, 10);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize());
  m.castShadow = true;
  return m;
}

function makeWheel(mats, knobby){
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R-0.02, knobby?0.024:0.019, 12, 28), mats.tire);
  tire.castShadow = true;
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R-0.045, 0.008, 8, 28), mats.rim);
  g.add(rim);
  for(let k=0;k<8;k++){
    const sp = tubeBetween(new THREE.Vector3(0,0,0),
      new THREE.Vector3(Math.cos(k/8*Math.PI*2)*(WHEEL_R-0.05), Math.sin(k/8*Math.PI*2)*(WHEEL_R-0.05), 0),
      0.0035, mats.rim);
    g.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.09,10), mats.rim);
  hub.rotation.x = Math.PI/2;
  g.add(hub);
  if(knobby){
    const knobGeo = new THREE.BoxGeometry(0.016,0.014,0.03);
    const knobs = new THREE.InstancedMesh(knobGeo, mats.tire, 18);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0,0,1);
    for(let k=0;k<18;k++){
      const a = k/18*Math.PI*2;
      q.setFromAxisAngle(up, a);
      M.compose(new THREE.Vector3(Math.cos(a)*WHEEL_R, Math.sin(a)*WHEEL_R, (k%2? 0.018:-0.018)), q, new THREE.Vector3(1,1,1));
      knobs.setMatrixAt(k, M);
    }
    g.add(knobs);
  }
  return g;
}

export function buildBike(bike, colorHex){
  const mats = {
    frame: new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.55, roughness: 0.35 }),
    dark:  new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.4, roughness: 0.55 }),
    tire:  new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.95 }),
    rim:   new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.8, roughness: 0.35 }),
    skin:  new THREE.MeshStandardMaterial({ color: 0xd9a87e, roughness: 0.7 }),
    kit:   new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.8 }),
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
  sprung.add(tubeBetween(P.bb, P.head, 0.026, mats.frame));         // down tube
  sprung.add(tubeBetween(P.bb, P.seat, 0.019, mats.frame));         // seat tube
  for(const s of [-0.05, 0.05]){
    const rA = P.rAxle.clone().setZ(s);
    sprung.add(tubeBetween(rA, P.bb.clone().setZ(s*0.5), 0.011, mats.frame));   // chainstay
    sprung.add(tubeBetween(rA, P.seat.clone().setZ(s*0.4), 0.011, mats.frame)); // seatstay
  }
  // saddle + post
  sprung.add(tubeBetween(P.seat, P.seat.clone().add(new THREE.Vector3(0.04,0.09,0)), 0.014, mats.dark));
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.26,0.03,0.09), mats.dark);
  saddle.position.copy(P.seat).add(new THREE.Vector3(0.02,0.11,0)); saddle.castShadow=true;
  sprung.add(saddle);

  // fork: steerer + two legs; for suspension bikes the lowers telescope
  const forkG = new THREE.Group(); sprung.add(forkG);
  const stemTop = P.barC.clone().add(new THREE.Vector3(-0.05,-0.03,0));
  forkG.add(tubeBetween(P.head, stemTop, 0.02, mats.dark));         // steerer/stem
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.011,0.011,0.54,10), mats.dark);
  bars.rotation.x = Math.PI/2; bars.position.copy(P.barC); bars.castShadow=true;
  const barsG = new THREE.Group(); barsG.add(bars); sprung.add(barsG);

  const lowers = new THREE.Group();                                 // slides for suspension
  sprung.add(lowers);
  const legMat = bike.susp ? mats.dark : mats.frame;
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

  // drivetrain
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085,0.008,6,24), mats.dark);
  ring.position.copy(P.bb).add(new THREE.Vector3(0,0,0.06)); sprung.add(ring);
  const crank = new THREE.Group(); crank.position.copy(P.bb); sprung.add(crank);
  for(const s of [1,-1]){
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.17,0.014), mats.dark);
    arm.position.set(0, s*0.085, s*0.075); arm.castShadow=true;
    crank.add(arm);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.02,0.05), mats.dark);
    pedal.position.set(0, s*0.17, s*0.075);
    crank.add(pedal);
  }

  // wheels
  const wheelR = makeWheel(mats, bike.tread===2); wheelR.position.copy(P.rAxle); root.add(wheelR);
  const wheelF = makeWheel(mats, bike.tread===2); wheelF.position.copy(P.fAxle); root.add(wheelF);

  // ---- rider ----
  const rider = new THREE.Group(); sprung.add(rider);
  const hip = new THREE.Vector3(-0.28, 0.98, 0);
  const shoulder = new THREE.Vector3(0.10, 1.28, 0);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 10), mats.kit);
  torso.position.copy(hip).lerp(shoulder,0.5).add(new THREE.Vector3(0,0.02,0));
  torso.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), shoulder.clone().sub(hip).normalize());
  torso.castShadow = true;
  rider.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 12), mats.skin);
  head.position.copy(shoulder).add(new THREE.Vector3(0.10,0.16,0)); head.castShadow=true;
  rider.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10, 0, Math.PI*2, 0, Math.PI*0.55), mats.kit);
  helmet.position.copy(head.position).add(new THREE.Vector3(-0.01,0.02,0));
  rider.add(helmet);
  // arms shoulder->bars
  for(const s of [-0.14, 0.14]){
    rider.add(tubeBetween(shoulder.clone().add(new THREE.Vector3(0,-0.02,s)),
      P.barC.clone().add(new THREE.Vector3(-0.02,-0.01,s*0.9)), 0.032, mats.kit));
  }
  // legs: thigh + shin per side, animated
  const legs = [];
  for(const s of [-0.075, 0.075]){
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.30, 4, 8), mats.pants);
    const shin  = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.30, 4, 8), mats.pants);
    thigh.castShadow = shin.castShadow = true;
    rider.add(thigh); rider.add(shin);
    legs.push({ s, thigh, shin });
  }

  return { root, sprung, rider, wheelF, wheelR, lowers, crank, barsG, legs, P, hip };
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
  if(S.bike.futureShock) V.barsG.position.y = clamp(-S.fsZ*1.4, -0.012, 0.02);
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
  }
}
function placeCapsule(mesh, a, b){
  mesh.position.copy(a).lerp(b, 0.5);
  const d = b.clone().sub(a);
  const len = d.length();
  mesh.scale.y = len/0.38;
  mesh.quaternion.setFromUnitVectors(_up, d.normalize());
}
