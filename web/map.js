/* Park map: real geometry, one shared scale for both parks.
 *
 * No tile server and no map library — the whole thing is one SVG projected
 * from lat/lon, so it renders offline and prints cleanly. Disneyland Park is
 * hub-and-spoke: Main Street runs north from the entrance to a Central Plaza
 * with the castle on it, and the lands fan out as sectors at their real
 * compass bearings. Both parks are drawn at one scale, so their true relative
 * sizes show; rescaling each half would not be a map of the resort.
 *
 * Geometry comes from dlp/data/park_geometry.json, which is a schematic until
 * `python3 -m dlp.cli import-map` replaces it with OpenStreetMap data.
 */

const NS = "http://www.w3.org/2000/svg";
const LAND_HUE = {
  "Main Street U.S.A.":"#9a7b52", "Frontierland":"#b06a42", "Adventureland":"#3f8459",
  "Fantasyland":"#6560b4", "Discoveryland":"#2f7796", "Production Courtyard":"#84506c",
  "Worlds of Pixar":"#4f76a8", "Avengers Campus":"#964945", "Toon Studio":"#87733d",
  "Front Lot":"#6b7385", "Central Plaza":"#8f9bb0",
};
const PARK_NAME = { DLP:"Disneyland Park", DAW:"Walt Disney Studios" };
const MW = 980, PADX = 30, HEAD = 24, GAPX = 14;

const el = (t, at = {}, tx) => { const n = document.createElementNS(NS, t);
  for (const k in at) n.setAttribute(k, at[k]); if (tx !== undefined) n.textContent = tx; return n; };
const hhmm = m => String(Math.floor(m/60)%24).padStart(2,"0")+":"+String(Math.round(m)%60).padStart(2,"0");
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

export function waitHue(w){
  if (w === null || w === undefined) return "var(--closed)";
  if (w <= 15) return "var(--w1)"; if (w <= 30) return "var(--w2)";
  if (w <= 45) return "var(--w3)"; if (w <= 70) return "var(--w4)"; return "var(--w5)";
}
const pinR = w => (w === null || w === undefined) ? 3.2 : 3.2 + Math.min(6.5, w/14);

/* ---- projection --------------------------------------------------- */
function boundsOf(latlons){
  const la = latlons.map(p=>p[0]), lo = latlons.map(p=>p[1]);
  const laMin=Math.min(...la), laMax=Math.max(...la), loMin=Math.min(...lo), loMax=Math.max(...lo);
  const kx = Math.cos((laMin+laMax)/2*Math.PI/180);
  const w = Math.max(1e-6,(loMax-loMin)*kx), h = Math.max(1e-6,laMax-laMin);
  return {laMax, loMin, kx, w, h, aspect:w/h};
}
const projector = (b, r) => {
  const sc = Math.min((r.w-2*PADX)/b.w, (r.h-2*PADX)/b.h);
  const ox = r.x+(r.w-b.w*sc)/2, oy = r.y+(r.h-b.h*sc)/2;
  return (lat,lon) => [ox+(lon-b.loMin)*b.kx*sc, oy+(b.laMax-lat)*sc];
};
const pathOf = (ring, P, close) =>
  ring.map((p,i)=>{const [x,y]=P(p[0],p[1]);
    return `${i?"L":"M"} ${x.toFixed(1)} ${y.toFixed(1)}`;}).join(" ") + (close?" Z":"");

/* Place labels greedily in priority order, nudging each one up or down a
   little to find a gap and dropping it if none exists. Fantasyland packs a
   dozen attractions into a few hundred metres; without this the names pile
   into an unreadable stack and the map stops being a map. */
function placeLabels(cands){
  const placed=[], out=[];
  const overlaps=(a,b)=> !(a.x1<b.x0||b.x1<a.x0||a.y1<b.y0||b.y1<a.y0);
  for(const c of cands){
    const w=c.text.length*c.em, h=c.size+3;
    let done=false;
    const nudges=c.keep
      ? [[0,0],[0,-13],[0,13],[0,-26],[0,26],[0,-40],[0,40],
         [-w/2,0],[w/2,0],[-w/2,-15],[w/2,-15],[-w/2,15],[w/2,15]]
      : [[0,0],[0,-11],[0,11],[0,-21],[0,21],[0,-31],[0,31]];
    for(const [dx,dy] of nudges){
      const box={x0:c.x+dx-w/2-2,x1:c.x+dx+w/2+2,y0:c.y+dy-h,y1:c.y+dy+3};
      if(placed.some(p=>overlaps(box,p))) continue;
      placed.push(box); out.push({...c,x:c.x+dx,y:c.y+dy}); done=true; break;
    }
    if(!done && c.keep){          // land names must never be dropped
      out.push(c);
      placed.push({x0:c.x-w/2-2,x1:c.x+w/2+2,y0:c.y-h,y1:c.y+3});
    }
  }
  return out;
}

/* ---- rendering ---------------------------------------------------- */
export function drawMap(svg, rides, waits, plan, geo, onHover, onLeave){
  svg.innerHTML="";
  const parks=[...new Set(rides.map(a=>a.park))].sort((x,y)=>x==="DLP"?-1:y==="DLP"?1:0);
  const inP={}, bn={};
  for(const p of parks){
    inP[p]=rides.filter(a=>a.park===p);
    // Frame on the park outline, not just the pins, so the whole park shows
    // and its shape reads correctly.
    const pts=[...inP[p].map(a=>[a.lat,a.lon])];
    const o=geo && geo.parks && geo.parks[p] && geo.parks[p].outline;
    if(o) pts.push(...o);
    bn[p]=boundsOf(pts);
  }

  // One scale for both parks. Disneyland Park really is about twice the
  // Studios, and drawing each to fit its own panel would quietly hide that;
  // a map that rescales each half is not a map of the resort.
  const totalW=parks.reduce((s,p)=>s+bn[p].w,0);
  const maxH=Math.max(...parks.map(p=>bn[p].h));
  const scale=Math.min((MW-2*PADX-GAPX*(parks.length-1))/totalW,
                       (660-2*PADX)/maxH);
  const ph=Math.max(300, maxH*scale+2*PADX);
  svg.setAttribute("viewBox",`0 0 ${MW} ${HEAD+ph}`);

  const R={}, P={}, xy={};
  let cx=PADX;
  for(const p of parks){
    const w=bn[p].w*scale, h=bn[p].h*scale;
    R[p]={x:cx, y:HEAD+(ph-h)/2, w, h};
    const b=bn[p], ox=R[p].x, oy=R[p].y;
    P[p]=(lat,lon)=>[ox+(lon-b.loMin)*b.kx*scale, oy+(b.laMax-lat)*scale];
    for(const a of inP[p]) xy[a.id]=P[p](a.lat,a.lon);
    cx+=w+GAPX;
  }

  const gFrame=el("g"), gLand=el("g"), gWater=el("g"), gPath=el("g"),
        gMark=el("g"), gRoute=el("g"), gPin=el("g"), gText=el("g");
  svg.append(gFrame,gLand,gWater,gPath,gMark,gRoute,gPin,gText);

  /* park outline and title */
  for(const p of parks){
    const r=R[p], o=geo?.parks?.[p]?.outline;
    if(o) gFrame.append(el("path",{d:pathOf(o,P[p],true),fill:"var(--card)",
      stroke:"var(--edge)","stroke-width":1.4}));
    else gFrame.append(el("rect",{x:r.x,y:r.y,width:r.w,height:r.h,rx:10,
      fill:"var(--card)",stroke:"var(--edge)","stroke-width":1}));
    gFrame.append(el("text",{x:r.x,y:r.y-9,class:"panel-t"},PARK_NAME[p]||p));
  }

  /* themed lands, drawn as real regions */
  const landLabels=[];
  for(const L of (geo?.lands||[])){
    const p=L.park; if(!P[p]) continue;
    const hue=LAND_HUE[L.name]||"#5b6479";
    gLand.append(el("path",{d:pathOf(L.polygon,P[p],true),fill:hue,
      stroke:hue,"stroke-width":1,class:"land"}));
    const c=L.polygon.reduce((s,q)=>[s[0]+q[0],s[1]+q[1]],[0,0]).map(v=>v/L.polygon.length);
    const [lx,ly]=P[p](c[0],c[1]);
    landLabels.push({x:lx,y:ly,size:8.5,em:7.3,text:L.name,cls:"llabel",keep:true});
  }

  for(const W of (geo?.water||[])){
    const p=W.park; if(!P[p]) continue;
    // Lands are washed back to 34%; water at the same weight just reads as
    // another land, so give it full strength.
    gWater.append(el("path",{d:pathOf(W.polygon,P[p],true),
      fill:"var(--water)",stroke:"var(--water)","stroke-width":1,opacity:.55}));
  }
  for(const T of (geo?.paths||[])){
    // Each park has its own projection, so a path spanning both would be a
    // line between two unrelated coordinate frames. Skip it.
    if(T.park==="BOTH") continue;
    const p=T.park; if(!P[p]) continue;
    gPath.append(el("path",{d:pathOf(T.line,P[p],false),fill:"none",
      stroke:"var(--edge)","stroke-width":T.name==="Main Street U.S.A."?4:1.6,
      "stroke-linecap":"round",opacity:.9}));
  }

  /* landmarks: the castle is how anyone orients on this map */
  /* landmarks last, so they can join the same label pass */
  for(const M of (geo?.landmarks||[])){
    const p=M.park; if(!P[p]||!M.at) continue;
    const [x,y]=P[p](M.at[0],M.at[1]);
    if(M.kind==="castle"){
      const s=1.5;   // the castle is how anyone orients on this map
      gMark.append(el("path",{d:`M ${x-9*s} ${y+6*s} L ${x-9*s} ${y-3*s} L ${x-5.5*s} ${y-7*s}`
        +` L ${x-2*s} ${y-3*s} L ${x-2*s} ${y-7*s} L ${x} ${y-13*s} L ${x+2*s} ${y-7*s}`
        +` L ${x+2*s} ${y-3*s} L ${x+5.5*s} ${y-7*s} L ${x+9*s} ${y-3*s} L ${x+9*s} ${y+6*s} Z`,
        fill:"var(--ink-2)",opacity:.9}));
    } else if(M.kind==="entrance"){
      gMark.append(el("circle",{cx:x,cy:y,r:4.5,fill:"var(--card)",
        stroke:"var(--ink-3)","stroke-width":1.8}));
      landLabels.push({x,y:y+15,size:8.5,em:7.3,text:"Entrance",cls:"llabel"});
    }
  }
  const named=new Set(stopsOf(plan,xy)[0].map(i=>i.ride_id));
  const nameLabels=rides.filter(a=>named.has(a.id))
    .sort((a,b)=>b.appeal-a.appeal)
    .map(a=>({x:xy[a.id][0], y:xy[a.id][1]+14, size:7.4, em:3.5,
              text:a.name.length>22?a.name.slice(0,21)+"\u2026":a.name, cls:"plabel"}));
  for(const l of placeLabels(landLabels.concat(nameLabels)))
    gText.append(el("text",{x:l.x,y:l.y,class:l.cls,"text-anchor":"middle"},l.text));

  fitViewBox(svg);

  /* the two routes, broken where the party crosses between parks */
  const stops=stopsOf(plan,xy);
  for(const tr of [1,0]){
    let run=[]; const runs=[];
    for(const i of stops[tr]){ if(run.length&&run[run.length-1].park!==i.park){runs.push(run);run=[];} run.push(i); }
    if(run.length) runs.push(run);
    for(const seg of runs){ if(seg.length<2) continue;
      const d=seg.map((i,k)=>{const [x,y]=xy[i.ride_id];return `${k?"L":"M"} ${x.toFixed(1)} ${y.toFixed(1)}`;}).join(" ");
      gRoute.append(el("path",{d,class:"route",stroke:tr===0?"var(--route-a)":"var(--route-b)",
        "stroke-width":tr===0?2.4:1.8,"stroke-dasharray":tr===0?"none":"6 5",opacity:.85})); }
  }

  for(const a of rides){
    const [x,y]=xy[a.id]; const w=waits[a.id]===undefined?null:waits[a.id];
    const g=el("g",{class:"pin"});
    g.append(el("circle",{cx:x,cy:y,r:pinR(w)+7,fill:waitHue(w),opacity:0,class:"halo"}));
    g.append(el("circle",{cx:x,cy:y,r:pinR(w),fill:waitHue(w),stroke:"var(--card)","stroke-width":1.4}));
    g.addEventListener("mousemove",e=>onHover&&onHover(e,a,w));
    g.addEventListener("mouseleave",()=>onLeave&&onLeave());
    gPin.append(g);
  }
  for(const tr of [0,1]){
    stops[tr].forEach((it,k)=>{
      const [x,y]=xy[it.ride_id], dx=tr===0?-11:11;
      const g=el("g",{class:"pin"});
      g.append(el("circle",{cx:x+dx,cy:y-10,r:7,fill:tr===0?"var(--route-a)":"var(--route-b)",
        stroke:"var(--card)","stroke-width":1.3}));
      g.append(el("text",{x:x+dx,y:y-10,class:"seqno"},String(k+1)));
      g.addEventListener("mousemove",e=>onHover&&onHover(e,it,null,true));
      g.addEventListener("mouseleave",()=>onLeave&&onLeave());
      gPin.append(g);
    });
  }
}

/* Titles and place names spill past the park outlines, so the canvas is
   sized to what was actually drawn. Without this the bottom of Disneyland
   Park — Main Street and the entrance — is quietly cut off. */
function fitViewBox(svg){
  try{
    const b=svg.getBBox();
    if(!b.width||!b.height) return;
    const m=6;
    svg.setAttribute("viewBox",
      `${(b.x-m).toFixed(1)} ${(b.y-m).toFixed(1)} `
      +`${(b.width+2*m).toFixed(1)} ${(b.height+2*m).toFixed(1)}`);
  }catch(e){ /* not laid out yet; the geometry-derived box still works */ }
}

function stopsOf(plan, xy){
  const items=(plan.items||[]).filter(i=>i.ride_id&&xy[i.ride_id]).sort((a,b)=>a.start-b.start);
  const stops={0:[],1:[]};
  for(const i of items){ const prev=stops[i.track][stops[i.track].length-1];
    if(!prev||prev.ride_id!==i.ride_id) stops[i.track].push(i); }
  return stops;
}

