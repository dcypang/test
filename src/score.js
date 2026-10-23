'use strict';

// Compare on letters and digits only, so "5829-TOVA", "5829 tova" and "**5829TOVA**" all match.
const compact = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const ABSTAIN = new RegExp(
  [
    "(don'?t|do not|didn'?t|did not|haven'?t|have not|never) (know|mention|tell|told|share|shared|say|said|have|recall)",
    "(not|wasn'?t|isn'?t) (been )?(mentioned|shared|provided|told|specified|stated)",
    "no (information|record|mention|details?)",
    "(can'?t|cannot|unable to) (find|recall|remember|see|know|tell)",
    "not sure", "no idea", "i'?m not aware", "you haven'?t",
  ].join('|'),
  'i',
);

// Returns { score in [0,1], pass, detail }. `all` gives partial credit per expected value.
function score(expect, reply) {
  const text = reply ?? '';
  if (expect.abstain) {
    const pass = ABSTAIN.test(text);
    return { score: pass ? 1 : 0, pass, detail: pass ? 'abstained' : 'did not abstain' };
  }
  const hay = compact(text);
  const found = expect.all.filter((v) => hay.includes(compact(v)));
  const s = found.length / expect.all.length;
  return { score: s, pass: s === 1, detail: `${found.length}/${expect.all.length} expected values found` };
}

module.exports = { score, compact };
