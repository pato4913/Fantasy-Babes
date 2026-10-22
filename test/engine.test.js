const assert = require('assert');
const E = require('../public/engine.js');
const D = require('../public/demo.js');
const L = D.build();
const name = (id) => L.players[id].name;

const me = E.teamById(L, '1');
console.log('My roster:', me.playerIds.map((id) => `${name(id)} ${L.players[id].pos}`).join(', '));
const a = E.analyzeLeague(L);
console.log('Power:', a.power.map((p) => `${p.rank}. ${p.team.name} ${Math.round(p.score)}`).join(' | '));
console.log('My pos ranks:', JSON.stringify(a.positionRanks['1']));

// Lopsided trade should grade high for the receiver and low for the giver.
const t2 = E.teamById(L, '2');
const g = E.gradeTrade(L, '1', '2', [me.playerIds[me.playerIds.length - 1]], [t2.playerIds[0]]);
console.log('Lopsided:', g.me.grade, g.them.grade, g.notes);
assert(['A+', 'A'].includes(g.me.grade) && ['D', 'F'].includes(g.them.grade));

// Grading is symmetric-ish: swapping sides flips the result.
const g2 = E.gradeTrade(L, '2', '1', [t2.playerIds[0]], [me.playerIds[me.playerIds.length - 1]]);
assert.strictEqual(g2.me.grade, g.them.grade);

let t0 = Date.now();
const trades = E.findTrades(L, '1');
console.log(`findTrades: ${trades.length} in ${Date.now() - t0}ms`);
for (const t of trades.slice(0, 6)) console.log(`  give ${t.give.map(name)} to ${t.partner.name} for ${t.get.map(name)} | me ${t.me.grade} (${(t.me.lineupPct*100).toFixed(1)}%) them ${t.them.grade}`);
assert(trades.length > 0);
for (const t of trades) assert(t.me.lineupPct > 0 && t.them.valuePct >= -0.1);

t0 = Date.now();
const w = E.recommendWaivers(L, '1');
console.log(`waivers in ${Date.now() - t0}ms`);
for (const p of w.picks.slice(0, 6)) console.log(`  ${name(p.id)} ${L.players[p.id].pos} +${(p.gainPct*100).toFixed(1)}% drop ${p.drop && name(p.drop)} [${p.tier}] ${p.reasons.join('; ')} bid ${JSON.stringify(p.bid)}`);
assert(w.picks.length > 0);
assert(!w.picks.some((p) => me.playerIds.includes(p.id)));

// Projection fallback produces values in range.
const rows = Object.keys(L.players).map((id, i) => ({ id, pos: L.players[id].pos, pts: 400 - i * 2 }));
const v = E.valuesFromProjections(rows, L);
assert(Math.max(...Object.values(v)) === 10000 && Math.min(...Object.values(v)) >= 0);
console.log('ok');

// Projections: lineup, timeframes, lens grading.
const opt = E.optimalLineup(L, '1', 8);
console.log('Week 8 lineup:', opt.starters.map((s) => `${s.slot}:${s.id ? name(s.id) + ' ' + s.pts : '-'}`).join(', '), 'total', opt.total.toFixed(1));
assert(opt.total > 50 && opt.starters.length === 7);
// Engram (Out) is the only TE, so he holds the slot with 0 expected points and is flagged.
const te = opt.starters.find((s) => s.slot === 'TE');
assert(te.exp === 0 && opt.holes.includes('TE'));
assert(!opt.starters.some((s) => s.id && s.slot !== 'TE' && L.players[s.id].injury === 'Out'));
const tf = E.timeframes(L);
assert.deepStrictEqual(tf.playoffs, [15, 16, 17]);
const g3 = E.gradeTrade(L, '1', '2', [me.playerIds[me.playerIds.length - 1]], [t2.playerIds[0]], 'balanced');
console.log('Lenses:', Object.entries(g3.me.lenses).map(([k, v]) => `${k}:${v.grade}`).join(' '), '| notes', g3.notes.filter((n) => /Week|season|playoffs/.test(n)));
assert(g3.me.lenses.ros.delta > 0 && g3.me.lenses.playoffs);
for (const mode of Object.keys(E.MODES)) {
  t0 = Date.now();
  const tr = E.findTrades(L, '1', { mode });
  console.log(`findTrades ${mode}: ${tr.length} in ${Date.now() - t0}ms; top: give ${tr[0].give.map(name)} get ${tr[0].get.map(name)} me ${tr[0].me.grade} them ${tr[0].them.grade}`);
}
console.log('ok projections');

// Shopping a fixed group: every offer sends exactly that group and is acceptable to the partner.
const block = [me.playerIds[2], me.playerIds[4]];
t0 = Date.now();
const offers = E.findOffers(L, '1', block, { mode: 'balanced' });
console.log(`findOffers for ${block.map(name)}: ${offers.length} in ${Date.now() - t0}ms`);
for (const o of offers.slice(0, 5)) console.log(`  ${o.partner.name}: ${o.get.map(name)} | me ${o.me.grade} them ${o.them.grade}`);
assert(offers.length > 0);
for (const o of offers) { assert.deepStrictEqual(o.give, block); assert(o.them.score >= -4); assert(o.get.length <= 3); }
assert.strictEqual(E.findOffers(L, '1', [me.playerIds[0]]).every((o) => o.get.length <= 2), true);
console.log('ok offers');
