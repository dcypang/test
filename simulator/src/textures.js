/* Procedural "real-world" textures, generated on canvas at runtime.
   Artifacts run under a strict CSP (no external images), so every map —
   asphalt, cracks, gravel, forest floor, grass, bark, foliage — is
   synthesized from fractal value noise + painted features. */
import * as THREE from "three";

// deterministic value noise
function hash(ix, iy, seed){
  let h = ix*374761393 + iy*668265263 + seed*974711;
  h = (h ^ (h>>>13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h>>>16)) >>> 0) / 4294967295;
}
const sstep = t => t*t*(3-2*t);
function vnoise(x, y, seed){
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
  const a=hash(ix,iy,seed), b=hash(ix+1,iy,seed), c=hash(ix,iy+1,seed), d=hash(ix+1,iy+1,seed);
  return a + (b-a)*sstep(fx) + (c-a)*sstep(fy) + (a-b-c+d)*sstep(fx)*sstep(fy);
}
function fbm(x, y, oct, seed){
  let v=0, amp=0.5, f=1;
  for(let o=0;o<oct;o++){ v += amp*vnoise(x*f, y*f, seed+o*131); amp*=0.5; f*=2; }
  return v; // ~0..1
}

function makeCanvas(size){
  const cv = document.createElement("canvas"); cv.width=cv.height=size;
  return [cv, cv.getContext("2d")];
}

// paint per-pixel base: cb(u,v) -> [r,g,b]
function pixelFill(ctx, size, cb){
  const img = ctx.createImageData(size,size), d = img.data;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const [r,g,b] = cb(x/size, y/size);
    const i=(y*size+x)*4;
    d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
  }
  ctx.putImageData(img,0,0);
}

function tex(cv, repX, repY, aniso){
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// random-walk crack polyline
function drawCrack(ctx, size, rnd){
  let x=rnd()*size, y=rnd()*size, a=rnd()*Math.PI*2;
  ctx.strokeStyle=`rgba(12,12,14,${0.55+rnd()*0.3})`;
  ctx.lineWidth=0.8+rnd()*1.6;
  ctx.beginPath(); ctx.moveTo(x,y);
  const steps=30+rnd()*50|0;
  for(let s=0;s<steps;s++){
    a += (rnd()-0.5)*1.1;
    x=(x+Math.cos(a)*(3+rnd()*6)+size)%size; y=(y+Math.sin(a)*(3+rnd()*6)+size)%size;
    // wrap-jumps break the path so cracks tile without streaks
    if(Math.abs(x-((x+size)%size))>size/2){ ctx.moveTo(x,y); continue; }
    ctx.lineTo(x,y);
  }
  ctx.stroke();
}

export function makeTextures(rndSeed=7){
  const S=512;
  let seedCtr=rndSeed;
  const mkRnd = () => { let s=seedCtr++*2654435761; return ()=>{ s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; }; };

  /* ---- asphalt: dark aggregate + speckle + faint tar patches ---- */
  const [aCv,aCtx]=makeCanvas(S);
  pixelFill(aCtx,S,(u,v)=>{
    const n=fbm(u*90,v*90,4,11), blotch=fbm(u*6,v*6,3,77);
    let g = 66 + n*34 + (blotch-0.5)*22;
    return [g, g, g+4];
  });
  { const rnd=mkRnd();
    for(let i=0;i<2600;i++){ const x=rnd()*S,y=rnd()*S,l=110+rnd()*90;
      aCtx.fillStyle=`rgba(${l},${l},${l+6},${0.25+rnd()*0.4})`;
      aCtx.fillRect(x,y,1.2,1.2); } }

  /* ---- cracked asphalt: asphalt + cracks + patch scars + faded paint ---- */
  const [cCv,cCtx]=makeCanvas(S);
  cCtx.drawImage(aCv,0,0);
  { const rnd=mkRnd();
    for(let i=0;i<7;i++){ // tar patch rectangles
      cCtx.save(); cCtx.translate(rnd()*S,rnd()*S); cCtx.rotate(rnd()*0.6-0.3);
      cCtx.fillStyle=`rgba(30,30,34,${0.35+rnd()*0.25})`;
      cCtx.fillRect(-rnd()*70,-rnd()*26,60+rnd()*120,18+rnd()*36); cCtx.restore(); }
    for(let i=0;i<16;i++) drawCrack(cCtx,S,rnd); }

  /* ---- center-line paint (drawn on both asphalts; v runs along road) ---- */
  for(const [ctx,alpha] of [[aCtx,0.85],[cCtx,0.42]]){
    ctx.fillStyle=`rgba(228,205,92,${alpha})`;
    ctx.fillRect(S/2-5, 0, 10, S*0.46);           // one dash per tile
  }

  /* ---- gravel / dirt road: browns, stones, wheel tracks ---- */
  const [dCv,dCtx]=makeCanvas(S);
  pixelFill(dCtx,S,(u,v)=>{
    const n=fbm(u*70,v*70,4,23), big=fbm(u*7,v*7,3,101);
    // two packed wheel tracks (lighter, smoother) at u=0.3 / 0.7
    const track=Math.exp(-Math.pow((u-0.30)/0.075,2))+Math.exp(-Math.pow((u-0.70)/0.075,2));
    let r=138+n*44+(big-0.5)*36+track*16;
    let g=r*0.78, b=r*0.55;
    return [r,g,b];
  });
  { const rnd=mkRnd();
    for(let i=0;i<900;i++){ const x=rnd()*S,y=rnd()*S,rad=0.8+rnd()*2.6,l=95+rnd()*110;
      dCtx.fillStyle=`rgba(${l},${l*0.86},${l*0.66},0.85)`;
      dCtx.beginPath(); dCtx.ellipse(x,y,rad,rad*0.75,rnd()*3,0,7); dCtx.fill();
      dCtx.fillStyle="rgba(40,30,18,0.35)";
      dCtx.beginPath(); dCtx.ellipse(x+rad*0.5,y+rad*0.55,rad*0.8,rad*0.5,0,0,7); dCtx.fill(); } }

  /* ---- forest floor / singletrack: dark loam, roots, leaf litter ---- */
  const [fCv,fCtx]=makeCanvas(S);
  pixelFill(fCtx,S,(u,v)=>{
    const n=fbm(u*60,v*60,4,37), big=fbm(u*5,v*5,3,91);
    const track=Math.exp(-Math.pow((u-0.5)/0.16,2));      // worn center rut
    let r=74+n*40+(big-0.5)*30+track*24;
    return [r, r*0.76, r*0.52];
  });
  { const rnd=mkRnd();
    for(let i=0;i<14;i++){ // roots crossing the trail
      fCtx.strokeStyle=`rgba(52,38,24,${0.5+rnd()*0.3})`;
      fCtx.lineWidth=2.5+rnd()*3.5; fCtx.beginPath();
      let x=0,y=rnd()*S; fCtx.moveTo(x,y);
      while(x<S){ x+=14+rnd()*26; y+=(rnd()-0.5)*30; fCtx.lineTo(x,y); }
      fCtx.stroke(); }
    for(let i=0;i<650;i++){ const l=60+rnd()*70;         // leaves & twigs
      fCtx.fillStyle=`rgba(${l+40},${l*0.9},${l*0.4},0.5)`;
      fCtx.save(); fCtx.translate(rnd()*S,rnd()*S); fCtx.rotate(rnd()*3);
      fCtx.fillRect(0,0,3+rnd()*4,1.5+rnd()*2); fCtx.restore(); } }

  /* ---- grass shoulder ---- */
  const [gCv,gCtx]=makeCanvas(S);
  pixelFill(gCtx,S,(u,v)=>{
    const n=fbm(u*50,v*50,4,53), big=fbm(u*6,v*6,3,131);
    let g=96+n*54+(big-0.5)*40;
    return [g*0.62, g, g*0.42];
  });
  { const rnd=mkRnd();
    for(let i=0;i<2400;i++){ const g=90+rnd()*90;        // blade streaks
      gCtx.strokeStyle=`rgba(${g*0.55},${g},${g*0.35},0.5)`; gCtx.lineWidth=1;
      const x=rnd()*S,y=rnd()*S; gCtx.beginPath(); gCtx.moveTo(x,y);
      gCtx.lineTo(x+(rnd()-0.5)*3,y-2-rnd()*5); gCtx.stroke(); } }

  /* ---- dry meadow (for dirt course shoulders) ---- */
  const [mCv,mCtx]=makeCanvas(S);
  pixelFill(mCtx,S,(u,v)=>{
    const n=fbm(u*46,v*46,4,61), big=fbm(u*5,v*5,3,171);
    let g=118+n*48+(big-0.5)*36;
    return [g*0.82, g*0.74, g*0.44];
  });

  /* ---- bark ---- */
  const [bCv,bCtx]=makeCanvas(256);
  pixelFill(bCtx,256,(u,v)=>{
    const ridge=fbm(u*18,v*3,4,71);
    let r=70+ridge*54;
    return [r, r*0.76, r*0.55];
  });

  /* ---- foliage ---- */
  const [lCv,lCtx]=makeCanvas(256);
  pixelFill(lCtx,256,(u,v)=>{
    const n=fbm(u*22,v*22,4,81), big=fbm(u*4,v*4,2,201);
    let g=72+n*66+(big-0.5)*30;
    return [g*0.42, g, g*0.36];
  });

  /* ---- rock ---- */
  const [rCv,rCtx]=makeCanvas(256);
  pixelFill(rCtx,256,(u,v)=>{
    const n=fbm(u*14,v*14,4,99);
    let g=104+n*54;
    return [g, g*0.97, g*0.9];
  });

  /* ---- sky gradient ---- */
  function skyCanvas(top, mid, bottom){
    const [cv,ctx]=makeCanvas(64);
    const g=ctx.createLinearGradient(0,0,0,64);
    g.addColorStop(0,top); g.addColorStop(0.55,mid); g.addColorStop(1,bottom);
    ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; return t;
  }

  const A = 8; // anisotropy; caller may re-set from renderer caps
  return {
    asphalt:  tex(aCv, 1, 1, A),   // repeat set per-mesh
    cracked:  tex(cCv, 1, 1, A),
    dirt:     tex(dCv, 1, 1, A),
    forest:   tex(fCv, 1, 1, A),
    grass:    tex(gCv, 1, 1, A),
    meadow:   tex(mCv, 1, 1, A),
    bark:     tex(bCv, 1, 2, A),
    foliage:  tex(lCv, 1, 1, A),
    rock:     tex(rCv, 1, 1, A),
    skyDay:    skyCanvas("#7fb2e0","#b7d4ea","#e8eef0"),
    skyHazy:   skyCanvas("#8fb3d6","#c9d8dd","#efe9dc"),
    skyGold:   skyCanvas("#87a8cc","#d8cfae","#f0e3c2"),
    skyForest: skyCanvas("#6f95b5","#a8bfb4","#d7e0ce"),
  };
}
