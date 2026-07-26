/* Hybrid Bike Physics Lab — 3D
   World axes: +X along the course, +Y up, +Z across the road. */
import * as THREE from "three";
import { BIKES, COURSES, getCourse, buildEnvelope, makeState, stepBike,
         groundAt, elevAt, DT, clamp, lerp, mulberry32, WB, AF, AR } from "./physics.js";
import { makeTextures } from "./textures.js";
import { buildBike, poseBikeParts } from "./bike3d.js";

const LANES = [-1.9, 0, 1.9];
const BIKE_HEX = [0x3E8A4B, 0x9E3535, 0x3B7DD8];
const BIKE_HEX_DARK = [0x49AB59, 0xB84444, 0x5B93E8];
const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

const $ = id => document.getElementById(id);
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/* ================= renderer / scene ================= */
const holder = $("glHolder");
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: $("gl") });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 16/9, 0.1, 900);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6b6250, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0004;
scene.add(sun); scene.add(sun.target);

const TX = makeTextures();
for(const k of Object.keys(TX)) if(TX[k].anisotropy) TX[k].anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

function sizeRenderer(){
  const w = holder.clientWidth, h = Math.max(300, Math.round(w*9/16));
  renderer.setSize(w, h, false);
  camera.aspect = w/h; camera.updateProjectionMatrix();
}
addEventListener("resize", sizeRenderer);

/* ================= world building ================= */
let world = null;

const COURSE_LOOK = [
  { road: "asphalt", shoulder: "grass",  sky: "skyDay",    fog:[0xcfe0ea, 70, 460], roadTile:4,   sunPos:[30,48,26] },
  { road: "cracked", shoulder: "grass",  sky: "skyHazy",   fog:[0xd2d5cc, 60, 400], roadTile:7,   sunPos:[30,44,22] },
  { road: "dirt",    shoulder: "meadow", sky: "skyGold",   fog:[0xe0d6bd, 55, 360], roadTile:3.5, sunPos:[26,40,30] },
  { road: "forest",  shoulder: "grass",  sky: "skyForest", fog:[0xb9c6b4, 22, 170], roadTile:3,   sunPos:[18,42,-20], shoulderTint:0x87936a },
];

function ribbon(c, z0, z1, cols, yFn, uvScale){
  if(z0 > z1){ const t = z0; z0 = z1; z1 = t; }   // keep +z winding → up normals
  const ds = 0.5, x0 = -40, x1 = c.len + 25;
  const rows = Math.ceil((x1-x0)/ds)+1;
  const pos = new Float32Array(rows*cols*3), uv = new Float32Array(rows*cols*2);
  for(let r=0;r<rows;r++){
    const x = Math.min(x0 + r*ds, x1);
    for(let k=0;k<cols;k++){
      const t = k/(cols-1), z = lerp(z0, z1, t);
      const i = (r*cols+k);
      pos[i*3] = x; pos[i*3+1] = yFn(x, z, t); pos[i*3+2] = z;
      uv[i*2] = (z-z0)/(z1-z0)*uvScale[0]; uv[i*2+1] = x/uvScale[1];
    }
  }
  const idx = [];
  for(let r=0;r<rows-1;r++) for(let k=0;k<cols-1;k++){
    const a=r*cols+k, b=a+1, cc=a+cols, d=cc+1;
    idx.push(a,b,cc, b,d,cc);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos,3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv,2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function disposeWorld(){
  if(!world) return;
  world.traverse(o=>{ if(o.geometry) o.geometry.dispose(); });
  scene.remove(world);
  world = null;
}

function buildWorld(ci){
  disposeWorld();
  const c = getCourse(ci), look = COURSE_LOOK[ci];
  world = new THREE.Group();
  scene.add(world);
  scene.background = TX[look.sky];
  scene.fog = new THREE.Fog(look.fog[0], look.fog[1], look.fog[2]);
  sun.intensity = ci===3 ? 1.7 : 2.4;
  hemi.intensity = ci===3 ? 0.7 : 0.9;

  // --- road: rides exactly on the physics heightfield, slight crown ---
  const roadGeo = ribbon(c, -3.5, 3.5, 10,
    (x,z)=> groundAt(c,x) + 0.02*(1-Math.pow(z/3.5,2)),
    [1, look.roadTile]);
  const roadMat = new THREE.MeshStandardMaterial({
    map: TX[look.road], roughness: 0.94, metalness: 0.0,
    bumpMap: TX[look.road], bumpScale: ci>=2 ? 0.9 : 0.35,
  });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  world.add(road);

  // --- shoulders / hillsides (macro elevation only; roughness ripple) ---
  const shoulderMat = new THREE.MeshStandardMaterial({
    map: TX[look.shoulder], roughness: 1,
    bumpMap: TX[look.shoulder], bumpScale: 0.6,
    color: look.shoulderTint ?? 0xffffff,
  });
  const rr = mulberry32(4242);
  const ripple = x => Math.sin(x*0.7)*0.12 + Math.sin(x*0.23+2)*0.2;
  // shoulders tuck 30cm under the road edge, then blend to macro elevation,
  // so the rough road heightfield never opens a seam
  const shY = (x,z)=>{
    const d = Math.abs(z)-3.5;
    const slope = ci===3 ? (z<0 ? 0.55 : -0.6) : -0.10;
    const dd = Math.max(0,d);
    const macro = elevAt(c,x) - 0.06 + slope*dd + ripple(x+dd)*Math.min(1, dd*0.4);
    return d < 2 ? lerp(groundAt(c,x)-0.05, macro, clamp(d/2,0,1)) : macro;
  };
  for(const side of [-1, 1]){
    const geo = ribbon(c, side*3.2, side*30, 9, (x,z)=>shY(x,z), [7, 2.5]);
    const m = new THREE.Mesh(geo, shoulderMat);
    m.receiveShadow = true;
    world.add(m);
  }

  // --- trees (instanced trunk + two foliage cones) ---
  const spots = [];
  if(ci===3){
    // keep the camera corridor (z ≈ 4–6.5 on the right) clear of trunks
    for(const t of c.trees) spots.push({ x:t.x, z:t.side*(t.side>0 ? 7+((t.s*7919)%1)*6 : 4.6+((t.s*7919)%1)*7), s:t.s*1.25 });
    for(const g of c.gates){ spots.push({x:g.x, z:-2.85, s:1.15, gate:true}, {x:g.x+0.7, z:2.85, s:1.05, gate:true}); }
  } else {
    const gap = ci===2 ? [16,30] : [26,50];
    for(let x=15; x<c.len; x+=gap[0]+rr()*(gap[1]-gap[0])){
      spots.push({ x, z:(rr()<0.5?-1:1)*(6.5+rr()*9), s:0.9+rr()*0.7 });
      if(rr()<0.4) spots.push({ x:x+3+rr()*5, z:(rr()<0.5?-1:1)*(8+rr()*10), s:0.8+rr()*0.6 });
    }
  }
  const shoulderY = shY;
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.15, 2.6, 7);
  const cone1Geo = new THREE.ConeGeometry(1.25, 3.0, 8);
  const cone2Geo = new THREE.ConeGeometry(0.85, 2.3, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ map: TX.bark, roughness: 1 });
  const leafMat  = new THREE.MeshStandardMaterial({ map: TX.foliage, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const cones1 = new THREE.InstancedMesh(cone1Geo, leafMat, spots.length);
  const cones2 = new THREE.InstancedMesh(cone2Geo, leafMat, spots.length);
  trunks.castShadow = cones1.castShadow = cones2.castShadow = true;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3();
  spots.forEach((p,i)=>{
    const y = p.gate ? groundAt(c,p.x) : shoulderY(p.x, p.z);
    const s = p.s;
    Q.setFromAxisAngle(V.set(0,1,0), (i*2.399));
    SC.set(s,s,s);
    M.compose(V.set(p.x, y+1.3*s, p.z), Q, SC); trunks.setMatrixAt(i, M);
    M.compose(V.set(p.x, y+(2.6+1.5)*s*0.85, p.z), Q, SC); cones1.setMatrixAt(i, M);
    M.compose(V.set(p.x, y+(2.6+3.1)*s*0.85, p.z), Q, SC); cones2.setMatrixAt(i, M);
  });
  world.add(trunks, cones1, cones2);

  // --- rocks near rock gardens + scattered on trail shoulders ---
  if(c.rocksEx.length){
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.36, 0),
      new THREE.MeshStandardMaterial({ map: TX.rock, roughness: 1 }), c.rocksEx.length*5);
    rocks.castShadow = true;
    let i=0;
    for(const rx of c.rocksEx) for(let k=0;k<5;k++){
      const x = rx + (rr()-0.5)*12, z = (rr()-0.5)*7.5;
      const s = 0.5 + rr()*1.1;
      Q.setFromEuler(new THREE.Euler(rr()*3, rr()*3, rr()*3));
      M.compose(V.set(x, groundAt(c, clamp(x,0,c.len)) + 0.05, z), Q, SC.set(s,s*0.75,s));
      rocks.setMatrixAt(i++, M);
    }
    world.add(rocks);
  }

  // --- corner flags on dirt course gates ---
  if(ci===2){
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xB98A2F, roughness:0.6 });
    for(const g of c.gates) for(const side of [-1,1]){
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,1.6,6), poleMat);
      pole.position.set(g.x, groundAt(c,g.x)+0.8, side*3.8); pole.castShadow = true;
      world.add(pole);
    }
  }

  // --- finish gate: two posts + checkered banner ---
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.4 });
  const fy = groundAt(c, c.len);
  for(const side of [-1,1]){
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,4.4,8), postMat);
    post.position.set(c.len, fy+2.2, side*4.2); post.castShadow = true;
    world.add(post);
  }
  const bcv = document.createElement("canvas"); bcv.width=256; bcv.height=48;
  const bctx = bcv.getContext("2d");
  for(let r=0;r<3;r++) for(let k=0;k<16;k++){ bctx.fillStyle=(r+k)%2?"#111":"#eee"; bctx.fillRect(k*16, r*16, 16, 16); }
  const bt = new THREE.CanvasTexture(bcv); bt.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 0.9),
    new THREE.MeshBasicMaterial({ map: bt, side: THREE.DoubleSide }));
  banner.rotation.y = Math.PI/2;
  banner.position.set(c.len, fy+4.0, 0);
  world.add(banner);
  return c;
}

/* ================= bikes ================= */
let views = [];
function buildBikes(){
  for(const v of views){ scene.remove(v.root); v.root.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); }
  const hex = isDark() ? BIKE_HEX_DARK : BIKE_HEX;
  views = BIKES.map((b,i)=>{ const v = buildBike(b, hex[i]); scene.add(v.root); return v; });
}

function placeBike(S, v, lane){
  const c = S.course;
  const gF = groundAt(c, S.x+AF), gR = groundAt(c, S.x-AR);
  v.root.position.set(S.x, (gF+gR)/2, lane);
  v.root.rotation.z = Math.atan2(gF-gR, WB);
  S._groundZ = groundAt(c, S.x);
  poseBikeParts(v, S);
}

/* ================= sim state ================= */
let curCourse = 0, running = false, finished = false, simMult = 2;
let states = [];
const SIM_SPEEDS = [1,2,4,8];
let course = null;

function resetSim(){
  running = false; finished = false;
  course = getCourse(curCourse);
  states = BIKES.map(b=>{ const s = makeState(b, course); s.envInfo = buildEnvelope(course, b); return s; });
  $("verdict").style.display = "none";
  $("startBtn").textContent = "Start ride";
  $("courseInfo").textContent = course.desc;
  $("clock").textContent = "t = 0.0 s";
  states.forEach((s,i)=>placeBike(s, views[i], LANES[i]));
  updateHUD(); updateStandings(); drawChart();
}

/* ================= camera ================= */
let camMode = "auto"; // auto | 0 | 1 | 2 | orbit
let snapNext = false;
const camPos = new THREE.Vector3(-8, 3, 8), camAim = new THREE.Vector3(6, 1, 0);
function leaderIdx(){
  let best=0, bx=-1;
  states.forEach((s,i)=>{ const p = s.done ? 1e6 - s.finishT : s.x; if(p>bx){bx=p; best=i;} });
  return best;
}
function updateCamera(dt){
  let target;
  if(camMode === "orbit" || (finished && camMode === "auto")){
    const mid = states.reduce((a,s)=>a+s.x,0)/3;
    const y = groundAt(course, clamp(mid,0,course.len));
    const t = performance.now()*0.00012;
    target = { p: new THREE.Vector3(mid+Math.cos(t)*14, y+9, Math.sin(t)*14),
               a: new THREE.Vector3(mid, y+1, 0) };
  } else {
    const i = camMode === "auto" ? leaderIdx() : +camMode;
    const S = states[i], lane = LANES[i];
    const y = groundAt(course, S.x);
    const back = 6.5 + S.v*0.22;
    const sideOff = curCourse===3 ? 3.4 : 4.6;
    target = { p: new THREE.Vector3(S.x-back, y+2.6+S.v*0.04, lane+sideOff),
               a: new THREE.Vector3(S.x+4, y+0.9, lane*0.4) };
  }
  const k = snapNext ? 1 : 1 - Math.exp(-dt*3.2);
  snapNext = false;
  camPos.lerp(target.p, k); camAim.lerp(target.a, k);
  camera.position.copy(camPos);
  camera.lookAt(camAim);
  // sun follows the action so shadows stay crisp
  const look = COURSE_LOOK[curCourse];
  sun.position.set(camAim.x+look.sunPos[0], camAim.y+look.sunPos[1], look.sunPos[2]);
  sun.target.position.copy(camAim);
}

/* ================= HUD / standings / chart / results ================= */
function markCol(i){ return [cssVar("--quickMark"),cssVar("--sirrus"),cssVar("--cx")][i]; }
function col(i){ return [cssVar("--quick"),cssVar("--sirrus"),cssVar("--cx")][i]; }
function fmtRms(s){ return s.aRmsN>0.5 ? Math.sqrt(s.aRmsAcc/s.aRmsN).toFixed(2)+" m/s²" : "—"; }

function updateHUD(){
  states.forEach((s,i)=>{
    $("hudV"+i).textContent = (s.v*3.6).toFixed(1);
    $("hudD"+i).textContent = Math.round(s.x)+" m";
    const b = $("hudB"+i);
    if(s.done){ b.textContent = "✓ "+s.finishT.toFixed(1)+"s"; b.className="hudbadge done"; }
    else if(s.airCnt>0.06){ b.textContent = "AIRBORNE"; b.className="hudbadge air"; }
    else { b.textContent = ""; b.className="hudbadge"; }
  });
  $("clock").textContent = "t = "+states[0].t.toFixed(1)+" s";
}

function updateStandings(){
  const tb = $("standings");
  const order = [...states.keys()].sort((a,b)=> (states[b].done?1e6-states[b].finishT:states[b].x) - (states[a].done?1e6-states[a].finishT:states[a].x));
  tb.innerHTML = order.map((i,rank)=>{
    const s = states[i];
    return "<tr><td><span class='bikecell'><i class='swatch' style='background:"+col(i)+"'></i>"+BIKES[i].name+
      (rank===0?" <span class='leader'>▲ lead</span>":"")+"</span></td>"+
      "<td class='num'>"+Math.round(s.x)+" m</td>"+
      "<td class='num'>"+(s.v*3.6).toFixed(1)+"</td>"+
      "<td class='num'>"+fmtRms(s)+"</td></tr>";
  }).join("");
}

const cv2 = $("chart"), ctx2 = cv2.getContext("2d");
const tip = $("tip");
const PADL=44,PADR=14,PADT=14,PADB=30;
function drawChart(){
  const W=cv2.width,H=cv2.height, c=course;
  ctx2.clearRect(0,0,W,H);
  const pw=W-PADL-PADR, ph=H-PADT-PADB;
  let vmax=6; for(const s of states) for(const p of s.trace) vmax=Math.max(vmax,p[1]);
  vmax=Math.ceil(vmax*3.6/10)*10/3.6;
  const X=d=>PADL+d/c.len*pw, Y=v=>PADT+ph-(v/vmax)*ph;
  ctx2.strokeStyle=cssVar("--line"); ctx2.lineWidth=1;
  ctx2.fillStyle=cssVar("--ink3"); ctx2.font="11px ui-monospace,monospace"; ctx2.textAlign="right";
  for(let k=0;k<=vmax*3.6+0.01;k+=10){ const y=Y(k/3.6);
    ctx2.beginPath(); ctx2.moveTo(PADL,y); ctx2.lineTo(W-PADR,y); ctx2.stroke();
    ctx2.fillText(k+"",PADL-6,y+3); }
  ctx2.textAlign="center";
  for(let d=0;d<=c.len;d+=300){ ctx2.fillText(d+" m",X(d),H-8); }
  ctx2.save(); ctx2.translate(12,PADT+ph/2); ctx2.rotate(-Math.PI/2); ctx2.textAlign="center";
  ctx2.fillText("km/h",0,0); ctx2.restore();
  states.forEach((s,i)=>{
    if(s.trace.length<2) return;
    ctx2.strokeStyle=markCol(i); ctx2.lineWidth=2; ctx2.lineJoin="round"; ctx2.beginPath();
    s.trace.forEach((p,j)=> j===0?ctx2.moveTo(X(p[0]),Y(p[1])):ctx2.lineTo(X(p[0]),Y(p[1])));
    ctx2.stroke();
    const last=s.trace[s.trace.length-1];
    const ly=clamp(Y(last[1])+(i===0?-6:i===1?4:14)-4, PADT+8, H-PADB-4);
    ctx2.fillStyle=markCol(i); ctx2.beginPath(); ctx2.arc(X(last[0]),Y(last[1]),3.2,0,7); ctx2.fill();
    ctx2.fillStyle=cssVar("--ink2"); ctx2.font="700 11px Arial Narrow,sans-serif"; ctx2.textAlign="left";
    ctx2.fillText(BIKES[i].name.toUpperCase(), clamp(X(last[0])+6,PADL,W-90), ly);
  });
}
cv2.addEventListener("mousemove",e=>{
  const r=cv2.getBoundingClientRect(), c=course;
  const mx=(e.clientX-r.left)*(cv2.width/r.width);
  if(mx<PADL||mx>cv2.width-PADR||states.every(s=>s.trace.length<2)){tip.style.display="none";return;}
  const d=(mx-PADL)/(cv2.width-PADL-PADR)*c.len;
  let html="<b>"+Math.round(d)+" m</b>";
  states.forEach((s,i)=>{
    let sp=null;
    for(let j=1;j<s.trace.length;j++) if(s.trace[j][0]>=d){ sp=lerp(s.trace[j-1][1],s.trace[j][1],(d-s.trace[j-1][0])/Math.max(1e-6,s.trace[j][0]-s.trace[j-1][0])); break; }
    if(sp!=null) html+="<br><span style='color:"+markCol(i)+"'>●</span> "+BIKES[i].name+"  "+(sp*3.6).toFixed(1)+" km/h";
  });
  tip.innerHTML=html; tip.style.display="block";
  tip.style.left=Math.min(e.clientX-r.left+14, r.width-150)+"px";
  tip.style.top=(e.clientY-r.top+10)+"px";
  drawChart();
  ctx2.strokeStyle=cssVar("--ink3"); ctx2.setLineDash([3,3]);
  ctx2.beginPath(); ctx2.moveTo(mx,PADT); ctx2.lineTo(mx,cv2.height-PADB); ctx2.stroke(); ctx2.setLineDash([]);
});
cv2.addEventListener("mouseleave",()=>{ tip.style.display="none"; drawChart(); });

function showResults(){
  $("verdict").style.display="block";
  const order=[...states.keys()].sort((a,b)=>states[a].finishT-states[b].finishT);
  $("resultRows").innerHTML = order.map((i,rank)=>{
    const s=states[i], c=s.course;
    return "<tr><td><span class='bikecell'><i class='swatch' style='background:"+col(i)+"'></i>"+
      ["🥇","🥈","🥉"][rank]+" "+BIKES[i].brand+" "+BIKES[i].name+"</span></td>"+
      "<td class='num'>"+s.finishT.toFixed(1)+" s</td>"+
      "<td class='num'>"+(c.len/s.finishT*3.6).toFixed(1)+" km/h</td>"+
      "<td class='num'>"+(s.vMax*3.6).toFixed(1)+" km/h</td>"+
      "<td class='num'>"+fmtRms(s)+"</td>"+
      "<td class='num'>"+(s.bumpJ/1000).toFixed(1)+" kJ</td></tr>";
  }).join("");
  const w=states[order[0]], l=states[order[2]];
  $("winnerLine").textContent = BIKES[order[0]].brand+" "+BIKES[order[0]].name+" wins by "+(states[order[1]].finishT-w.finishT).toFixed(1)+" s";
  const comfy=[...states.keys()].sort((a,b)=>Math.sqrt(states[a].aRmsAcc/Math.max(.1,states[a].aRmsN))-Math.sqrt(states[b].aRmsAcc/Math.max(.1,states[b].aRmsN)))[0];
  $("verdictText").textContent =
    "On "+w.course.name.toLowerCase()+", "+BIKES[order[0]].name+" finished "+COURSES[curCourse].len+" m in "+w.finishT.toFixed(1)+" s. "+
    "Smoothest ride: "+BIKES[comfy].name+" at "+fmtRms(states[comfy])+" RMS. "+
    BIKES[order[2]].name+" gave up "+(l.finishT-w.finishT).toFixed(1)+" s, losing "+(l.bumpJ/1000).toFixed(1)+" kJ to vibration and impedance along the way.";
}

/* ================= main loop ================= */
let lastT = performance.now(), acc = 0, chartT = 0, standT = 0;
function tick(now){
  const dt = Math.min(0.1, (now-lastT)/1000); lastT = now;
  if(running && !finished){
    acc += dt*simMult;
    const power = +$("power").value;
    let n = 0;
    while(acc >= DT && n < 4000){ for(const s of states) stepBike(s, power); acc -= DT; n++; }
    if(states.every(s=>s.done)){ finished=true; running=false; showResults(); drawChart(); updateStandings(); }
    updateHUD();
    chartT += dt; standT += dt;
    if(chartT > 0.18){ chartT=0; drawChart(); }
    if(standT > 0.3){ standT=0; updateStandings(); }
  }
  states.forEach((s,i)=>placeBike(s, views[i], LANES[i]));
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

/* ================= wiring ================= */
document.querySelectorAll(".tabs button[data-course]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".tabs button[data-course]").forEach(b=>b.setAttribute("aria-pressed","false"));
    btn.setAttribute("aria-pressed","true");
    curCourse=+btn.dataset.course;
    buildWorld(curCourse); resetSim();
  });
});
document.querySelectorAll(".camtabs button").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".camtabs button").forEach(b=>b.setAttribute("aria-pressed","false"));
    btn.setAttribute("aria-pressed","true");
    camMode = btn.dataset.cam;
  });
});
$("power").addEventListener("input",e=>{ $("powerVal").textContent=e.target.value+" W"; });
$("simspeed").addEventListener("input",e=>{
  simMult=SIM_SPEEDS[+e.target.value]; $("simspeedVal").textContent=simMult+"×";
});
$("startBtn").addEventListener("click",()=>{
  if(finished) resetSim();
  running=!running;
  $("startBtn").textContent=running?"Pause":"Resume";
});
$("resetBtn").addEventListener("click",resetSim);
addEventListener("keydown",e=>{ if(e.key===" "&&document.activeElement.tagName!=="INPUT"){ e.preventDefault(); $("startBtn").click(); }});
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", ()=>{ buildBikes(); states.forEach((s,i)=>placeBike(s,views[i],LANES[i])); });

/* debug/test hook: fast-forward the race off the render clock */
window.__lab = {
  states: () => states,
  snapCam(){ snapNext = true; },
  fastForward(seconds){
    const power = +$("power").value, n = Math.round(seconds/DT);
    for(let k=0;k<n && !states.every(s=>s.done);k++) for(const s of states) stepBike(s, power);
  },
};

/* ================= boot ================= */
sizeRenderer();
buildBikes();
buildWorld(0);
resetSim();
requestAnimationFrame(tick);
