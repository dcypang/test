// Reports the triangle budget of everything the game builds.
//   node scripts/polycount.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport:{width:640,height:400} })).newPage();
await p.goto('file:///home/user/test/index.html');
const t0=Date.now();
while (Date.now()-t0 < 240000) { if (await p.evaluate(()=>window.__game&&window.__game.state==='menu').catch(()=>false)) break; await p.waitForTimeout(300); }
const r = await p.evaluate(() => {
  const g = window.__game;
  const tri = (m) => (m ? Math.round(m.count / 3) : 0);
  const sum = (o) => Object.values(o).reduce((a, v) => a + (Array.isArray(v) ? v.reduce((x, m) => x + tri(m), 0) : tri(v)), 0);
  const scene = (s) => ({ terrain: tri(s.meshes.terrain), road: tri(s.meshes.road), props: tri(s.meshes.props) });
  const c = scene(g.circuitScene), h = scene(g.homeScene);
  const car = sum(g.carMeshes);
  const total = c.terrain + c.road + c.props + h.terrain + h.road + h.props + car;
  return { circuit: c, home: h, car, total };
});
console.log(JSON.stringify(r, null, 1));
console.log('TOTAL', r.total);
await b.close();
