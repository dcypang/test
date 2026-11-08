// Planning rules for SimSaratoga.
//
// District names follow the ones Saratoga uses in its zoning code (R-1-10,000,
// R-1-40,000, HR, C-H, ...). The numbers are simplified for play: check the
// Saratoga Municipal Code before relying on any of them for a real project.
'use strict';
window.SG = window.SG || {};

const SQFT = 0.092903; // m² per sq ft
const ACRE = 4046.86;  // m² per acre

SG.ZONES = [
  // id 0 = outside city limits (unzonable)
  { id: 0, code: 'OUT', name: 'Outside city limits', color: null },
  { id: 1, code: 'HR', name: 'Hillside Residential', color: '#7fa36a', res: true,
    minLot: 2 * ACRE, duPerAcre: 0.5, maxHeightFt: 26, coverage: 0.15,
    note: 'Big lots in the foothills. Grading and tree removal are tightly limited.' },
  { id: 2, code: 'R-1-40,000', name: 'Single-Family, 40,000 sq ft lots', color: '#b9d98a', res: true,
    minLot: 40000 * SQFT, duPerAcre: 1.1, maxHeightFt: 26, coverage: 0.25 },
  { id: 3, code: 'R-1-20,000', name: 'Single-Family, 20,000 sq ft lots', color: '#d6e68c', res: true,
    minLot: 20000 * SQFT, duPerAcre: 2.2, maxHeightFt: 26, coverage: 0.30 },
  { id: 4, code: 'R-1-12,500', name: 'Single-Family, 12,500 sq ft lots', color: '#efe58d', res: true,
    minLot: 12500 * SQFT, duPerAcre: 3.5, maxHeightFt: 26, coverage: 0.35 },
  { id: 5, code: 'R-1-10,000', name: 'Single-Family, 10,000 sq ft lots', color: '#f6d77f', res: true,
    minLot: 10000 * SQFT, duPerAcre: 4.4, maxHeightFt: 26, coverage: 0.40 },
  { id: 6, code: 'R-M', name: 'Multi-Family Residential', color: '#f0a55a', res: true, multi: true,
    minLot: 0.25 * ACRE, duPerAcre: 20, maxHeightFt: 30, coverage: 0.50 },
  { id: 7, code: 'MU', name: 'Mixed Use (Housing Element site)', color: '#c58ae0', res: true, multi: true, com: true,
    minLot: 0.5 * ACRE, duPerAcre: 30, maxHeightFt: 45, coverage: 0.60 },
  { id: 8, code: 'C-N', name: 'Neighborhood Commercial', color: '#6fa8dc', com: true,
    minLot: 0.25 * ACRE, duPerAcre: 0, maxHeightFt: 26, coverage: 0.50 },
  { id: 9, code: 'C-H', name: 'Historic Village Commercial', color: '#3d78c2', com: true, res: true, multi: true,
    minLot: 0.1 * ACRE, duPerAcre: 15, maxHeightFt: 26, coverage: 0.80,
    note: 'Saratoga Village along Big Basin Way. Shops downstairs, homes allowed upstairs, heritage design review.' },
  { id: 10, code: 'PF', name: 'Public Facility', color: '#b4a7d6',
    minLot: 0, duPerAcre: 0, maxHeightFt: 35, coverage: 0.5 },
  { id: 11, code: 'OS', name: 'Open Space', color: '#4f8a4a',
    minLot: 0, duPerAcre: 0, maxHeightFt: 0, coverage: 0,
    note: 'Parks, preserves and protected hillsides. Nothing may be built here.' },
];
SG.Z = Object.fromEntries(SG.ZONES.map(z => [z.code.replace(/[^A-Z0-9]/g, '_'), z.id]));
// SG.Z.HR, SG.Z.R_1_40_000, SG.Z.R_M, SG.Z.MU, SG.Z.C_N, SG.Z.C_H, SG.Z.PF, SG.Z.OS

// Building kinds (from OSM and from new construction).
SG.KIND = {
  house:       { name: 'Single-family home', color: '#e9d8b4', roof: '#c98d6b', units: 1 },
  adu:         { name: 'Accessory dwelling unit (ADU)', color: '#efdcb9', roof: '#d39f7c', units: 1 },
  duplex:      { name: 'SB 9 duplex', color: '#ead1a8', roof: '#c2805c', units: 2 },
  townhomes:   { name: 'Townhomes', color: '#e7c394', roof: '#b9734f', units: 0 },
  apartments:  { name: 'Apartments', color: '#e3b17d', roof: '#a8644a', units: 0 },
  mixeduse:    { name: 'Mixed-use building', color: '#d8b2e6', roof: '#8e5fa6', units: 0 },
  commercial:  { name: 'Shops and offices', color: '#a9c8ea', roof: '#5b86b5', units: 0 },
  school:      { name: 'School', color: '#d9cdf0', roof: '#8a77bd', units: 0 },
  civic:       { name: 'Civic or religious building', color: '#dcd3ee', roof: '#9184b8', units: 0 },
  accessory:   { name: 'Garage, shed or barn', color: '#d8d0c4', roof: '#a39a8c', units: 0 },
  utility:     { name: 'Utility or service building', color: '#cfcfcf', roof: '#8d8d8d', units: 0 },
  other:       { name: 'Building', color: '#e0d6c8', roof: '#a89c8c', units: 0 },
  firestation: { name: 'Fire station', color: '#f2b7ad', roof: '#c0503f', units: 0 },
  library:     { name: 'Library', color: '#dcd3ee', roof: '#7d6bb0', units: 0 },
  community:   { name: 'Community center', color: '#dcd3ee', roof: '#7d6bb0', units: 0 },
};

// Things the player can build. Footprint w x d in metres, front faces the road.
// cost is what the city pays; private projects cost the city nothing (developers pay fees).
SG.BUILDS = {
  adu:        { kind: 'adu', label: 'ADU', icon: '🏡', w: 8, d: 9, levels: 1, units: 1, private: true,
                zones: 'res', ministerial: true, fee: 15000,
                desc: 'Backyard cottage next to an existing home. State law requires the city to approve it.' },
  house:      { kind: 'house', label: 'Home', icon: '🏠', w: 16, d: 20, levels: 2, units: 1, private: true,
                zones: 'sfr', fee: 40000, desc: 'Detached single-family home on its own lot.' },
  duplex:     { kind: 'duplex', label: 'SB 9 Duplex', icon: '🏘', w: 18, d: 20, levels: 2, units: 2, private: true,
                zones: 'sfr', ministerial: true, fee: 50000,
                desc: 'Lot split or duplex on a single-family lot (California SB 9). Ministerial approval.' },
  townhomes:  { kind: 'townhomes', label: 'Townhomes', icon: '🏘', w: 36, d: 16, levels: 2, units: 6, private: true,
                zones: 'multi', fee: 120000, desc: 'A row of six townhomes.' },
  apartments: { kind: 'apartments', label: 'Apartments', icon: '🏢', w: 42, d: 26, levels: 3, units: 36, private: true,
                zones: 'multi', fee: 400000, desc: 'Three-story building with 36 apartments, some at below-market rents.' },
  mixeduse:   { kind: 'mixeduse', label: 'Mixed Use', icon: '🏬', w: 48, d: 30, levels: 4, units: 60, jobs: 40, private: true,
                zones: 'mu', fee: 700000, desc: 'Shops on the ground floor and 60 apartments above.' },
  commercial: { kind: 'commercial', label: 'Shops', icon: '🏪', w: 24, d: 22, levels: 1, jobs: 25, private: true,
                zones: 'com', fee: 80000, desc: 'Small storefront building for local shops and restaurants.' },
  park:       { kind: 'park', label: 'Park', icon: '🌳', w: 60, d: 60, cost: 900000, area: true,
                zones: 'any', desc: 'Neighborhood park with lawns and a playground.' },
  firestation:{ kind: 'firestation', label: 'Fire Stn', icon: '🚒', w: 30, d: 24, levels: 1, cost: 6500000, upkeep: 2200000,
                jobs: 15, zones: 'pf', service: 'fire', radius: 2500,
                desc: 'Engine company. Covers about 2.5 km. Essential in the wildland interface.' },
  library:    { kind: 'library', label: 'Library', icon: '📚', w: 34, d: 28, levels: 1, cost: 8000000, upkeep: 600000,
                jobs: 12, zones: 'pf', service: 'library', radius: 3000, desc: 'Branch library.' },
  community:  { kind: 'community', label: 'Comm. Ctr', icon: '🎭', w: 30, d: 26, levels: 1, cost: 5000000, upkeep: 400000,
                jobs: 8, zones: 'pf', service: 'community', radius: 3000, desc: 'Community and senior center.' },
};

SG.zoneAllows = function (zoneId, build) {
  const z = SG.ZONES[zoneId];
  if (!z || zoneId === 0) return false;
  switch (build.zones) {
    case 'any': return zoneId !== 0;
    case 'res': return !!z.res;
    case 'sfr': return zoneId >= 1 && zoneId <= 5;
    case 'multi': return !!z.multi;
    case 'mu': return zoneId === SG.Z.MU || zoneId === SG.Z.C_H;
    case 'com': return !!z.com;
    case 'pf': return zoneId === SG.Z.PF || zoneId === SG.Z.C_N || zoneId === SG.Z.MU;
  }
  return false;
};

// Economy (yearly unless noted). Simplified, game-balanced values.
SG.ECON = {
  startFunds: 18000000,
  // California caps property tax at 1% of assessed value (Prop 13); a city gets a small share of it.
  propTaxRate: 0.01,
  cityShare: 0.075,
  salesTaxPerJob: 1400,      // city share of sales tax per local job
  otherRevPerCapita: 160,    // franchise fees, permits, TOT, interest...
  lawPerCapita: 230,         // county sheriff contract
  roadPerKm: 9000,           // maintenance
  parkPerHa: 14000,
  adminBase: 10000000,
  hhSize: 2.8,               // people per household
  avgHomeValue: 1350000,     // assessed (well below market thanks to Prop 13)
  jobsPerCommercialM2: 1 / 35,
};

// Regional Housing Needs Allocation for the 2023–2031 cycle.
SG.RHNA = { target: 1712, start: { y: 2023, m: 0 }, end: { y: 2031, m: 0 } };

SG.fmtMoney = function (v) {
  const s = v < 0 ? '-' : '';
  v = Math.abs(v);
  if (v >= 1e9) return s + '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return s + '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return s + '$' + (v / 1e3).toFixed(0) + 'K';
  return s + '$' + Math.round(v);
};
SG.fmtInt = v => Math.round(v).toLocaleString('en-US');
SG.MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
