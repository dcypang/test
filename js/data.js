'use strict';
// ---------------------------------------------------------------------------
// Game data: banners, ages, damage table, buildings, units
// ---------------------------------------------------------------------------
const TEAM_COLORS = [
  { name: 'Azure',   main: '#2f6fd6', dark: '#1b3f85', light: '#8fbaff' },
  { name: 'Crimson', main: '#c8342c', dark: '#7a1a15', light: '#ff9a8a' },
  { name: 'Verdant', main: '#2e9a4b', dark: '#17592a', light: '#8fe3a4' },
  { name: 'Amber',   main: '#d08a1a', dark: '#7a4d08', light: '#ffd27a' },
];

const START_COIN = 5000;
const CART_CAP = 500;       // ore a cart can carry
const MINE_RATE = 55;       // ore per second while digging
const UNLOAD_RATE = 260;    // ore per second at the mint
const SKY_T = 240;          // Skyfire Battery charge time (s)
const HAWK_T = 110;         // Hawk's Eye cooldown (s)

const AGES = [
  { name: 'Age of Timber' },
  { name: 'Age of Iron',   cost: 1200, time: 32, req: ['barracks', 'mint'] },
  { name: 'Age of Powder', cost: 2400, time: 48, req: ['academy'] },
];

// damage type -> armour class multiplier
const DMG = {
  melee:  { foot: 1.0, mounted: 0.9,  engine: 1.1,  building: 0.30, wall: 0.25 },
  spear:  { foot: 0.9, mounted: 1.9,  engine: 1.0,  building: 0.25, wall: 0.20 },
  pierce: { foot: 1.0, mounted: 0.75, engine: 0.35, building: 0.10, wall: 0.04 },
  bolt:   { foot: 0.8, mounted: 1.7,  engine: 1.4,  building: 0.22, wall: 0.10 },
  shot:   { foot: 1.6, mounted: 1.1,  engine: 0.7,  building: 0.25, wall: 0.15 },
  siege:  { foot: 0.8, mounted: 0.7,  engine: 1.2,  building: 1.5,  wall: 1.8 },
  ram:    { foot: 0.1, mounted: 0.1,  engine: 0.6,  building: 2.2,  wall: 3.0 },
  fire:   { foot: 1.0, mounted: 1.0,  engine: 1.2,  building: 1.0,  wall: 1.0 },
};

const TABS = [
  { id: 'build',   label: 'Works',   key: 'Q' },
  { id: 'defense', label: 'Walls',   key: 'W' },
  { id: 'foot',    label: 'Foot',    key: 'E' },
  { id: 'mount',   label: 'Horse',   key: 'R' },
];

// w,h = footprint in tiles; grain > 0 produces, < 0 consumes; tall = sprite height (px)
const BUILDINGS = {
  keep: { name: 'Keep', tab: null, cost: 3000, hp: 2200, w: 3, h: 3, grain: 0, age: 0, req: [], tall: 110, sight: 8,
    weapon: { dmg: 9, type: 'pierce', range: 5.5, cd: 1.1, proj: 'arrow', pspeed: 13, arc: 0.12 }, fireZ: 60,
    desc: 'Heart of your holdings. Lets you raise every other structure.' },
  mill: { name: 'Windmill', tab: 'build', cost: 350, hp: 520, w: 2, h: 2, grain: 100, age: 0, req: [], tall: 80,
    desc: 'Grinds grain. Every other building needs grain to work at full pace.' },
  mint: { name: 'Mint', tab: 'build', cost: 1400, hp: 950, w: 3, h: 3, grain: -40, age: 0, req: ['mill'], tall: 78,
    desc: 'Ox carts unload gold here to be struck into coin. Comes with one cart.' },
  barracks: { name: 'Barracks', tab: 'build', cost: 450, hp: 750, w: 3, h: 2, grain: -15, age: 0, req: ['mill'], tall: 60,
    desc: 'Musters soldiers on foot.' },
  stable: { name: 'Stable', tab: 'build', cost: 1100, hp: 900, w: 3, h: 3, grain: -25, age: 0, req: ['mint', 'barracks'], tall: 56,
    desc: 'Raises riders and builds carts.' },
  beacon: { name: 'Beacon Tower', tab: 'build', cost: 700, hp: 620, w: 2, h: 2, grain: -40, age: 0, req: ['mint'], tall: 116, sight: 10,
    desc: 'Lights the minimap and grants the Hawk’s Eye scouting power.' },
  siegeworks: { name: 'Siege Works', tab: 'build', cost: 1500, hp: 1000, w: 3, h: 3, grain: -35, age: 1, req: ['stable'], tall: 70,
    desc: 'Carpenters who assemble rams, mangonels and trebuchets.' },
  academy: { name: 'Academy', tab: 'build', cost: 1800, hp: 900, w: 3, h: 3, grain: -60, age: 1, req: ['beacon', 'siegeworks'], tall: 82,
    desc: 'Scholars of the new sciences. Required for the Age of Powder.' },
  skyfire: { name: 'Skyfire Battery', tab: 'build', cost: 4000, hp: 1100, w: 3, h: 3, grain: -120, age: 2, req: ['academy'], tall: 78,
    desc: 'Charges a rocket barrage that can strike anywhere on the map.' },

  palisade: { name: 'Palisade', tab: 'defense', cost: 60, hp: 380, w: 1, h: 1, grain: 0, age: 0, req: ['barracks'], tall: 26, armor: 'wall', sight: 2,
    desc: 'A stretch of sharpened stakes. Blocks movement.' },
  watchtower: { name: 'Watchtower', tab: 'defense', cost: 500, hp: 540, w: 1, h: 1, grain: 0, age: 0, req: ['barracks'], tall: 76, sight: 8,
    weapon: { dmg: 13, type: 'pierce', range: 6.5, cd: 0.85, proj: 'arrow', pspeed: 14, arc: 0.12 }, fireZ: 46,
    desc: 'Archers on a platform. Good against foot soldiers. Needs no grain.' },
  bolttower: { name: 'Bolt Tower', tab: 'defense', cost: 850, hp: 700, w: 1, h: 1, grain: -35, age: 1, req: ['beacon'], tall: 70, sight: 8,
    weapon: { dmg: 58, type: 'bolt', range: 7, cd: 1.7, proj: 'bolt', pspeed: 17, arc: 0.05 }, fireZ: 52,
    desc: 'A mounted ballista. Punches through riders and engines. Needs grain.' },
  bombardtower: { name: 'Bombard Tower', tab: 'defense', cost: 1500, hp: 1100, w: 2, h: 2, grain: -70, age: 2, req: ['academy'], tall: 66, sight: 9,
    weapon: { dmg: 120, type: 'siege', range: 8.5, minRange: 1.5, cd: 3.2, proj: 'ball', pspeed: 11, arc: 0.25, splash: 1.3, sfx: 'cannon' }, fireZ: 44,
    desc: 'A great gun behind stone. Shatters massed attackers. Needs grain.' },
};

// r = collision radius (tiles); speed in tiles/s
const UNITS = {
  spearman: { name: 'Spearman', tab: 'foot', from: 'barracks', cost: 90, hp: 70, speed: 1.7, sight: 5, r: 0.27, armor: 'foot', age: 0, req: [],
    weapon: { dmg: 10, type: 'spear', range: 0.9, cd: 1.0 },
    desc: 'Cheap levy with a long spear. Brings down riders.' },
  archer: { name: 'Archer', tab: 'foot', from: 'barracks', cost: 150, hp: 50, speed: 1.7, sight: 6, r: 0.27, armor: 'foot', age: 0, req: [],
    weapon: { dmg: 9, type: 'pierce', range: 4.6, cd: 1.3, proj: 'arrow', pspeed: 12, arc: 0.14 },
    desc: 'Looses arrows from range. Weak against riders and walls.' },
  sapper: { name: 'Sapper', tab: 'foot', from: 'barracks', cost: 450, hp: 55, speed: 1.7, sight: 4, r: 0.27, armor: 'foot', age: 0, req: ['mint'],
    capture: true,
    desc: 'Seizes an enemy building, or fully mends one of yours. Used up on entry.' },
  swordsman: { name: 'Swordsman', tab: 'foot', from: 'barracks', cost: 240, hp: 160, speed: 1.6, sight: 5, r: 0.28, armor: 'foot', age: 1, req: [],
    weapon: { dmg: 18, type: 'melee', range: 0.9, cd: 0.9 },
    desc: 'Mailed infantry with sword and shield. Holds the line.' },
  arbalest: { name: 'Arbalest', tab: 'foot', from: 'barracks', cost: 280, hp: 70, speed: 1.6, sight: 7, r: 0.27, armor: 'foot', age: 1, req: [],
    weapon: { dmg: 24, type: 'bolt', range: 5.4, cd: 1.9, proj: 'bolt', pspeed: 16, arc: 0.06 },
    desc: 'Heavy crossbow. Slow to load, deadly to riders and engines.' },
  friar: { name: 'Friar', tab: 'foot', from: 'barracks', cost: 320, hp: 60, speed: 1.6, sight: 6, r: 0.27, armor: 'foot', age: 1, req: ['beacon'],
    heal: { rate: 9, range: 3.6 },
    desc: 'Tends the wounded. Heals nearby soldiers and riders.' },
  handgunner: { name: 'Handgunner', tab: 'foot', from: 'barracks', cost: 400, hp: 85, speed: 1.6, sight: 7, r: 0.27, armor: 'foot', age: 2, req: [],
    weapon: { dmg: 44, type: 'shot', range: 5.0, cd: 2.4, proj: 'shot', pspeed: 30, arc: 0, sfx: 'gun' },
    desc: 'Black-powder handgun. Cuts down foot soldiers.' },

  oxcart: { name: 'Ox Cart', tab: 'mount', from: 'stable', cost: 700, hp: 400, speed: 1.55, sight: 4, r: 0.42, armor: 'engine', age: 0, req: ['mint'],
    cart: true,
    desc: 'Digs gold and hauls it to the nearest Mint.' },
  outrider: { name: 'Outrider', tab: 'mount', from: 'stable', cost: 260, hp: 120, speed: 3.4, sight: 8, r: 0.36, armor: 'mounted', age: 0, req: [],
    weapon: { dmg: 10, type: 'melee', range: 0.95, cd: 0.8 },
    desc: 'Fast light rider. Scouts and runs down archers.' },
  knight: { name: 'Knight', tab: 'mount', from: 'stable', cost: 620, hp: 340, speed: 2.7, sight: 6, r: 0.38, armor: 'mounted', age: 1, req: [],
    weapon: { dmg: 30, type: 'melee', range: 0.95, cd: 1.0 },
    desc: 'Armoured lancer. The hammer of any assault.' },
  ram: { name: 'Battering Ram', tab: 'mount', from: 'siegeworks', cost: 560, hp: 520, speed: 1.25, sight: 4, r: 0.45, armor: 'engine', age: 1, req: ['siegeworks'],
    weapon: { dmg: 70, type: 'ram', range: 1.0, cd: 2.2, bOnly: true, sfx: 'thud' },
    desc: 'Shrugs off arrows and batters buildings down. Cannot strike troops.' },
  mangonel: { name: 'Mangonel', tab: 'mount', from: 'siegeworks', cost: 780, hp: 190, speed: 1.2, sight: 7, r: 0.45, armor: 'engine', age: 1, req: ['siegeworks'],
    weapon: { dmg: 46, type: 'siege', range: 7, minRange: 2, cd: 4.2, proj: 'stone', pspeed: 9, arc: 0.3, splash: 1.25, sfx: 'thunk' },
    desc: 'Flings stones that burst among packed troops.' },
  trebuchet: { name: 'Trebuchet', tab: 'mount', from: 'siegeworks', cost: 1400, hp: 230, speed: 0.95, sight: 8, r: 0.5, armor: 'engine', age: 2, req: ['siegeworks'],
    weapon: { dmg: 170, type: 'siege', range: 11, minRange: 3, cd: 6.5, proj: 'boulder', pspeed: 9, arc: 0.4, splash: 1.0, setup: 1.4, sfx: 'thunk' },
    desc: 'Outranges every tower. Must settle before each volley.' },
  wagon: { name: 'Founding Wagon', tab: 'mount', from: 'siegeworks', cost: 2400, hp: 650, speed: 1.1, sight: 5, r: 0.5, armor: 'engine', age: 1, req: ['siegeworks'],
    deploy: 'keep',
    desc: 'Unpacks into a new Keep wherever there is room (D).' },
};

(function finalizeDefs() {
  for (const k in BUILDINGS) { const d = BUILDINGS[k]; d.id = k; d.kind = 'b'; d.time = d.armor === 'wall' ? 2.5 : Math.max(5, d.cost / 48); d.sight = d.sight || 6; }
  for (const k in UNITS) { const d = UNITS[k]; d.id = k; d.kind = 'u'; d.time = Math.max(3.5, d.cost / 40); }
})();

function defOf(type) { return BUILDINGS[type] || UNITS[type]; }

const DIFFS = {
  easy:   { label: 'Squire',  income: 0.85, build: 0.8,  first: 360, wave: 5, grow: 2, maxWave: 14, cap: 22 },
  normal: { label: 'Baron',   income: 1.0,  build: 1.0,  first: 240, wave: 6, grow: 3, maxWave: 24, cap: 34 },
  hard:   { label: 'Warlord', income: 1.3,  build: 1.25, first: 160, wave: 8, grow: 4, maxWave: 34, cap: 50 },
};
