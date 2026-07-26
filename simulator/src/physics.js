/* Physics engine for the Hybrid Bike Physics Lab.
   Longitudinal dynamics + sprung-mass (heave/pitch) suspension model,
   impedance losses, grip-limited control envelope. Shared by the 3D app;
   the same model ships inline in classic-2d.html. */

export const G = 9.81, RHO = 1.225, RIDER = 75, DT = 1/240, DX = 0.05;
export const WHEEL_R = 0.35, WHEEL_CIRC = 2.2;
export const CADENCE_MAX = 110/60;
export const WB = 1.08, AF = 0.49, AR = WB - AF;

export function mulberry32(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0;
  let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296; }; }
export const clamp=(v,a,b)=>v<a?a:v>b?b:v;
export const lerp=(a,b,t)=>a+(b-a)*t;

// tread: 0 = slick/file (G-One Allround), 1 = mixed (Pathfinder), 2 = semi-knob (Terreno Dry)
export const BIKES = [
  { key:"quick",  name:"Quick 2",      brand:"Cannondale",
    massBike:10.8, unsprung:3.6, cda:0.520, crr0:0.0045,
    tireW:0.035, tireK:130000, tireC:280, tread:0,
    topRatio:40/11, susp:null, futureShock:false, bobLoss:0.0,
    seatpostK:220000 },
  { key:"sirrus", name:"Sirrus X 4.0", brand:"Specialized",
    massBike:11.3, unsprung:3.8, cda:0.550, crr0:0.0055,
    tireW:0.040, tireK:105000, tireC:330, tread:1,
    topRatio:42/11, susp:null, futureShock:true, bobLoss:0.005,
    seatpostK:200000 },
  { key:"cx",     name:"Quick CX 2",   brand:"Cannondale",
    massBike:13.2, unsprung:4.6, cda:0.580, crr0:0.0070,
    tireW:0.040, tireK:100000, tireC:350, tread:2,
    topRatio:40/11, susp:{ travel:0.050, k:26000, c:900, stiction:15 },
    futureShock:false, bobLoss:0.03,
    seatpostK:220000 },
];
export const MU = [ [0.90,0.90,0.85], [0.48,0.62,0.70], [0.38,0.55,0.70] ];
export const CRR_MULT = [ [1.00,1.00,1.00], [2.60,1.85,1.55], [4.00,2.60,2.00] ];

// surfaceClass: 0 pavement, 1 dirt, 2 trail
export const COURSES = [
  { name:"Smooth pavement",  len:1500, cls:0, desc:"1.5 km fresh asphalt, gently rolling" },
  { name:"Cracked pavement", len:1500, cls:0, desc:"1.5 km old asphalt — cracks, patches, speed humps" },
  { name:"Dirt road",        len:1500, cls:1, desc:"1.5 km gravel & washboard, rolling grades" },
  { name:"Mountain descent", len:1200, cls:2, desc:"1.2 km wooded singletrack, −7% avg, roots & rock" },
];

export function buildCourse(ci){
  const c = COURSES[ci], n = Math.floor(c.len/DX)+2;
  const rnd = mulberry32(1234+ci*777);
  const elev = new Float32Array(n);
  const rough = new Float32Array(n);
  const grade = new Float32Array(n);
  const gates = [];
  const rocksEx = [];
  let e=0;
  for(let i=0;i<n;i++){
    const x=i*DX; let g=0;
    if(ci===0)      g = 0.005*Math.sin(x/230) + 0.003*Math.sin(x/97+1.3);
    else if(ci===1) g = 0.006*Math.sin(x/210) + 0.004*Math.sin(x/76+0.7);
    else if(ci===2) g = 0.022*Math.sin(x/150+2.1) + 0.015*Math.sin(x/61+0.9);
    else            g = -0.07 + 0.035*Math.sin(x/90) + 0.02*Math.sin(x/37+2.2);
    grade[i]=g; e+=g*DX; elev[i]=e;
  }
  const addBump=(x0,len,h,sharp)=>{
    const i0=Math.max(0,Math.floor(x0/DX)), i1=Math.min(n-1,Math.floor((x0+len)/DX));
    for(let i=i0;i<=i1;i++){ const t=(i-i0)/Math.max(1,(i1-i0));
      rough[i]+= sharp? h*(t<0.25? t/0.25 : Math.pow(1-(t-0.25)/0.75,1.6))
                      : h*Math.sin(Math.PI*t); } };
  if(ci===0){
    for(let i=0;i<n;i++) rough[i]+=(rnd()-0.5)*0.003;
    for(let x=180;x<c.len;x+=180) addBump(x,0.25,0.006,true);
  } else if(ci===1){
    for(let i=0;i<n;i++) rough[i]+=(rnd()-0.5)*0.006;
    for(let x=12;x<c.len;x+=10+rnd()*14) addBump(x,0.30,0.014+rnd()*0.018,true);
    for(let x=90;x<c.len;x+=110+rnd()*80) addBump(x,0.9,-(0.02+rnd()*0.03),true);
    for(let x=250;x<c.len;x+=280) addBump(x,3.2,0.075,false);
  } else if(ci===2){
    for(let i=0;i<n;i++) rough[i]+=(rnd()-0.5)*0.014;
    for(let x=60;x<c.len;x+=140+rnd()*160){
      const end=x+25; for(let xx=x;xx<end;xx+=0.55) addBump(xx,0.4,0.011+rnd()*0.007,false);
    }
    for(let x=40;x<c.len;x+=60+rnd()*90) addBump(x,0.8,-(0.015+rnd()*0.025),true);
    gates.push(...[380,760,1150].map(x=>({x, vmaxBase:8.5, r:24})));
  } else {
    for(let i=0;i<n;i++) rough[i]+=(rnd()-0.5)*0.020;
    for(let x=8;x<c.len;x+=3.5+rnd()*7) addBump(x,0.35,0.030+rnd()*0.045,true);
    for(let x=140;x<c.len;x+=190+rnd()*120){
      const end=x+15; for(let xx=x;xx<end;xx+=0.8) addBump(xx,0.5,0.05+rnd()*0.05,true);
      rocksEx.push(x+7);
    }
    for(let x=55;x<c.len;x+=45+rnd()*45){
      const tight=rnd()<0.35;
      gates.push({x, vmaxBase: tight? 3.6+rnd()*0.8 : 5.5+rnd()*1.6, r: tight?6:12});
    }
  }
  const h = new Float32Array(n);
  for(let i=0;i<n;i++) h[i]=elev[i]+rough[i];
  const rms = new Float32Array(n); const w=Math.floor(8/DX);
  let acc=0; const q=new Float32Array(n);
  for(let i=0;i<n;i++){ const d=i>0?(rough[i]-rough[i-1]):0; q[i]=d*d; }
  for(let i=0;i<n;i++){ acc+=q[i]; if(i>=w) acc-=q[i-w]; rms[i]=Math.sqrt(acc/Math.min(i+1,w))/DX*0.01; }
  const trees=[]; if(ci===3){ const tr=mulberry32(99);
    for(let x=10;x<c.len;x+=8+tr()*18) trees.push({x, s:0.8+tr()*0.6, side:tr()<0.5?-1:1}); }
  return { ...c, n, h, elev, rough, grade, rms, gates, trees, rocksEx };
}

const courseCache=[];
export function getCourse(ci){ return courseCache[ci] || (courseCache[ci]=buildCourse(ci)); }

export function buildEnvelope(course, bike){
  const n=course.n, cls=course.cls;
  const mu = MU[cls][bike.tread];
  const suspF = bike.susp ? 1.28 : (bike.futureShock ? 1.07 : 1.0);
  const tireF = [ [1,1,0.96], [0.80,1.0,1.08], [0.60,0.92,1.12] ][cls][bike.tread];
  const vlim = new Float32Array(n);
  const baseCap = cls===0 ? 999 : cls===1 ? 11.5 : 8.6;
  for(let i=0;i<n;i++){
    let v = baseCap * suspF * tireF;
    if(cls>0) v *= clamp(1.25 - course.rms[i]*0.9, 0.55, 1.25);
    vlim[i]=v;
  }
  for(const g of course.gates){
    const vg = Math.min(Math.sqrt(mu*G*g.r), g.vmaxBase * (0.75+0.35*suspF*tireF/1.4));
    const i0=Math.max(0,Math.floor((g.x-2)/DX)), i1=Math.min(n-1,Math.floor((g.x+3)/DX));
    for(let i=i0;i<=i1;i++) vlim[i]=Math.min(vlim[i],vg);
  }
  const aBr = 0.65*mu*G;
  const env = new Float32Array(n); env[n-1]=vlim[n-1];
  for(let i=n-2;i>=0;i--) env[i]=Math.min(vlim[i], Math.sqrt(env[i+1]*env[i+1]+2*aBr*DX));
  return { env, mu, aBr };
}

export function makeState(bike, course){
  const M = RIDER + bike.massBike;
  const Ms = M - bike.unsprung;
  return {
    bike, course, envInfo:null,
    x:0, v:0, t:0, done:false, finishT:0,
    z:0, th:0, zd:0, thd:0,
    fsZ:0, fsZd:0,
    suspSagF:0, suspSagR:0,
    airF:false, airR:false, airCnt:0,
    M, Ms, I: Ms*0.42,
    aRmsAcc:0, aRmsN:0, bumpJ:0, vMax:0,
    wheelPhase:0, pedalPhase:0,
    trace:[], lastTrace:-5,
  };
}

export function groundAt(course,x){
  const i = clamp(x/DX, 0, course.n-2), i0=Math.floor(i), f=i-i0;
  return lerp(course.h[i0], course.h[i0+1], f);
}
export function gradeAt(course,x){
  const i = clamp(Math.floor(x/DX),0,course.n-1); return course.grade[i];
}
export function elevAt(course,x){
  const i = clamp(x/DX, 0, course.n-2), i0=Math.floor(i), f=i-i0;
  return lerp(course.elev[i0], course.elev[i0+1], f);
}
export function envelopedGround(course,x,win){
  return (groundAt(course,x-win)+2*groundAt(course,x)+groundAt(course,x+win))*0.25;
}

export function stepBike(S, power){
  if(S.done) return;
  const b=S.bike, c=S.course, cls=c.cls;
  const {env, mu, aBr} = S.envInfo;
  const i = clamp(Math.floor(S.x/DX),0,c.n-1);
  const grade = c.grade[i], cosT=1/Math.sqrt(1+grade*grade), sinT=grade*cosT;

  const kSusF = b.susp ? 1/(1/b.tireK + 1/b.susp.k) : b.tireK;
  const cSusF = b.susp ? b.susp.c + b.tireC : b.tireC;
  const kSusR = 1/(1/b.tireK + 1/b.seatpostK);
  const cSusR = b.tireC;
  const cBody = 950, cPitch = 260;

  const win = 0.10 + b.tireW*2.2 + (b.susp?0.05:0);
  const hF = envelopedGround(c, S.x+AF, win), hR = envelopedGround(c, S.x-AR, win);
  const slopeF=(envelopedGround(c,S.x+AF+0.1,win)-hF)/0.1, slopeR=(envelopedGround(c,S.x-AR+0.1,win)-hR)/0.1;
  const hdF = clamp(slopeF*S.v,-3.5,3.5), hdR = clamp(slopeR*S.v,-3.5,3.5);
  const zF = S.z + AF*S.th, zR = S.z - AR*S.th;
  const zdF= S.zd + AF*S.thd, zdR= S.zd - AR*S.thd;
  const WF = S.Ms*G*(AR/WB), WR = S.Ms*G*(AF/WB);
  let FF = WF + kSusF*(hF-zF) + cSusF*(hdF-zdF);
  let FR = WR + kSusR*(hR-zR) + cSusR*(hdR-zdR);
  S.airF = FF<=0; S.airR = FR<=0;
  S.airCnt = (S.airF&&S.airR) ? S.airCnt+DT : 0;
  FF=Math.max(0,FF); FR=Math.max(0,FR);
  // body damping acts on heave relative to road grade, so steady
  // climbs/descents aren't counted as vibration
  const zdRel = S.zd - grade*S.v;
  const zdd = (FF+FR-S.Ms*G)/S.Ms - cBody*zdRel/S.Ms;
  const thdd= (FF*AF-FR*AR)/S.I - cPitch*S.thd/S.I;
  S.zd+=zdd*DT; S.z+=S.zd*DT; S.thd+=thdd*DT; S.th+=S.thd*DT;
  S.th=clamp(S.th,-0.2,0.2); S.zd=clamp(S.zd,-6,6);

  const defF=clamp(hF-zF, -0.02, b.susp? b.susp.travel+0.02 : 0.04);
  S.suspSagF = lerp(S.suspSagF, b.susp? clamp(defF,0,b.susp.travel):clamp(defF*0.4,0,0.03), 0.3);
  S.suspSagR = lerp(S.suspSagR, clamp((hR-zR)*0.4,0,0.03), 0.3);

  let handAcc = zdd + AF*thdd;
  if(b.futureShock){
    const kFS=32000/(RIDER*0.30), cFS=550/(RIDER*0.30);
    const fsA = -kFS*S.fsZ - cFS*S.fsZd + handAcc;
    S.fsZd+=fsA*DT; S.fsZ=clamp(S.fsZ+S.fsZd*DT,-0.01,0.012);
    handAcc *= 0.42;
  }
  const saddleAcc = zdd - 0.15*thdd;
  const riderAcc = 0.6*saddleAcc + 0.4*handAcc;
  S.aRmsAcc += riderAcc*riderAcc*DT; S.aRmsN += DT;

  /* impedance (bump) losses: damper + body dissipation.
     0.4 = casing hysteresis efficiency; capped so a single sharp edge
     can't extract unphysical power from the contact patch. A suspended
     corner converts far less of its absorbed energy into forward drag —
     that's the whole point of suspension on rough ground. */
  const PF = cSusF*Math.pow(hdF-zdF,2)*0.5, PR = cSusR*Math.pow(hdR-zdR,2)*0.5,
        PB = cBody*zdRel*zdRel*0.6;
  const pDamp = Math.min(2200, 0.4*(PF+PR+PB));
  const pDrag = Math.min(2200, 0.4*( PF*(b.susp?0.30:1) + PR + PB ));
  S.bumpJ += pDamp*DT;
  const Fbump = Math.min(pDrag/Math.max(S.v,0.8), 0.30*S.M*G);

  const vTarget = env[i];
  const crr = b.crr0 * CRR_MULT[cls][b.tread];
  const Froll = crr*S.M*G*cosT * (S.airF&&S.airR?0:1);
  const Faero = 0.5*RHO*b.cda*S.v*S.v;
  const Fgrade= S.M*G*sinT;
  const vSpinout = b.topRatio*WHEEL_CIRC*CADENCE_MAX;
  let Fdrive=0, Fbrake=0;
  const margin=0.985;
  if((S.v < vTarget*margin || S.v < 1) && S.v < vSpinout){
    const pEff = power*(1-b.bobLoss*(cls>0?1:0.4));
    Fdrive = pEff/Math.max(S.v,1.2);
    Fdrive = Math.min(Fdrive, mu*FR*0.9);
    if(S.airR) Fdrive=0;
  } else if(S.v > vTarget){
    Fbrake = Math.min(S.M*aBr, S.M*aBr*((S.v-vTarget)*2+0.3));
    if(S.airF&&S.airR) Fbrake*=0.1;
  }
  const a=(Fdrive-Faero-Froll-Fgrade-Fbump-Fbrake)/S.M;
  S.v=Math.max(0,S.v+a*DT); S.x+=S.v*DT; S.t+=DT;
  S.vMax=Math.max(S.vMax,S.v);
  S.wheelPhase += S.v/WHEEL_R*DT;
  if(Fdrive>0) S.pedalPhase += S.v/(b.topRatio*0.7*WHEEL_R)*DT;

  if(S.x - S.lastTrace >= 5){ S.trace.push([S.x, S.v]); S.lastTrace=S.x; }
  if(S.x>=c.len){ S.done=true; S.finishT=S.t; S.x=c.len; }
}
