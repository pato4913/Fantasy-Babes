// Gridiron GM analysis engine. Pure functions, no network. Runs in the browser and in Node (tests).
//
// A league looks like:
//   { platform, name, season, numTeams, ppr, numQbs, isDynasty,
//     slots: { QB, RB, WR, TE, FLEX, SUPER_FLEX, REC_FLEX, WRRB_FLEX, BN },
//     teams: [{ id, name, owner, playerIds: [] }],
//     players: { [id]: { id, name, pos, team, injury } },
//     values: { [id]: number },            // trade value, ~0..10000
//     freeAgentIds: [], trending: { [id]: adds }, ownership: { [id]: pct },
//     faab: { budget, remaining } | null,
//     week, playoffWeeks: [], lastWeek,       // fantasy calendar
//     proj: { [week]: { [id]: { pts, opp } } } } // weekly projected points
(function (root) {
  const POS = ['QB', 'RB', 'WR', 'TE'];
  const ALL_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const FLEX_ELIG = {
    REC_FLEX: ['WR', 'TE'],
    WRRB_FLEX: ['RB', 'WR'],
    FLEX: ['RB', 'WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  };
  const FLEX_ORDER = ['REC_FLEX', 'WRRB_FLEX', 'FLEX', 'SUPER_FLEX'];
  const BENCH_W = [0.22, 0.16, 0.11, 0.07, 0.04];
  // How much of a player's value counts toward this week's lineup, by injury designation.
  const AVAIL = { Q: 0.9, QUESTIONABLE: 0.9, D: 0.5, DOUBTFUL: 0.5, O: 0.2, OUT: 0.2, IR: 0.05,
    INJURY_RESERVE: 0.05, PUP: 0.05, SUS: 0.1, SUSPENSION: 0.1, NA: 0.1 };
  // Share of projected points to expect this week, by designation. Later weeks only zero out long-term absences.
  const PLAY_NOW = { Q: 0.85, QUESTIONABLE: 0.85, D: 0.25, DOUBTFUL: 0.25, O: 0, OUT: 0, IR: 0, INJURY_RESERVE: 0,
    PUP: 0, SUS: 0, SUSPENSION: 0, NA: 0 };
  const LONG_OUT = new Set(['IR', 'INJURY_RESERVE', 'PUP']);
  // How much each view counts toward a trade's overall grade, by what the manager is playing for.
  const MODES = {
    balanced: { label: 'Balanced', value: 0.35, next: 0.15, ros: 0.3, playoffs: 0.2 },
    now: { label: 'Win this week', value: 0.1, next: 0.5, ros: 0.3, playoffs: 0.1 },
    playoffs: { label: 'Playoff push', value: 0.15, next: 0.1, ros: 0.25, playoffs: 0.5 },
    long: { label: 'Long term', value: 0.7, next: 0.05, ros: 0.15, playoffs: 0.1 },
  };

  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function normName(n) {
    return String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '');
  }

  // A ctx scores players either by trade value (default) or, with opts.week, by projected points that week.
  function ctxFor(league, opts = {}) {
    const pos = (id) => (league.players[id] || {}).pos;
    const inj = (id) => String((league.players[id] || {}).injury || '').toUpperCase();
    if (opts.week != null) {
      const proj = (league.proj && league.proj[opts.week]) || {};
      const now = opts.week === league.week;
      return {
        slots: league.slots, pos, positions: ALL_POS, points: true,
        val: (id) => (proj[id] ? proj[id].pts : 0),
        avail: (id) => (now ? (PLAY_NOW[inj(id)] != null ? PLAY_NOW[inj(id)] : 1) : LONG_OUT.has(inj(id)) ? 0 : 1),
      };
    }
    const val = (id) => league.values[id] || 0;
    const avail = (id) => (!opts.health ? 1 : AVAIL[inj(id)] != null ? AVAIL[inj(id)] : 1);
    return { slots: league.slots, val, pos, avail, positions: POS };
  }

  function hasProj(league) { return !!(league.proj && league.week && league.proj[league.week]); }

  // The weeks each view of a trade looks at.
  function timeframes(league) {
    if (!hasProj(league)) return null;
    const weeks = Object.keys(league.proj).map(Number).filter((w) => w >= league.week).sort((a, b) => a - b);
    const playoffs = (league.playoffWeeks || []).filter((w) => weeks.includes(w));
    return { next: [league.week], ros: weeks, playoffs };
  }

  // Best possible lineup for a set of player ids, in trade-value units or projected points.
  function evaluate(ids, ctx) {
    const positions = ctx.positions || POS;
    const ps = ids.map((id) => ({ id, pos: ctx.pos(id), v: ctx.val(id) * ctx.avail(id) }))
      .filter((p) => positions.includes(p.pos))
      .sort((a, b) => b.v - a.v);
    const used = new Set();
    const starters = [];
    const fill = (slot, elig) => {
      let n = ctx.slots[slot] || 0;
      for (const p of ps) {
        if (!n) break;
        if (elig.includes(p.pos) && !used.has(p.id)) { used.add(p.id); starters.push({ slot, ...p }); n--; }
      }
      for (; n > 0; n--) starters.push({ slot, id: null, pos: null, v: 0 });
    };
    for (const p of positions) fill(p, [p]);
    for (const f of FLEX_ORDER) fill(f, FLEX_ELIG[f]);
    const bench = ps.filter((p) => !used.has(p.id));
    const startTotal = sum(starters.map((s) => s.v));
    // Projected points only count starters; trade value also credits bench depth.
    const benchTotal = ctx.points ? 0 : bench.slice(0, BENCH_W.length).reduce((s, p, i) => s + p.v * BENCH_W[i], 0);
    const byPos = {};
    for (const p of POS) {
      const st = sum(starters.filter((s) => s.pos === p).map((s) => s.v));
      const bn = bench.find((b) => b.pos === p);
      byPos[p] = st + (bn ? bn.v * 0.2 : 0);
    }
    return { score: startTotal + benchTotal, startTotal, benchTotal, starters, bench, byPos };
  }

  function teamById(league, id) { return league.teams.find((t) => String(t.id) === String(id)); }

  // Positional strength of every team, and where a given team ranks.
  function analyzeLeague(league, opts = {}) {
    const ctx = ctxFor(league, opts);
    const evals = league.teams.map((t) => ({ team: t, ev: evaluate(t.playerIds, ctx) }));
    const avg = {};
    for (const p of POS) avg[p] = sum(evals.map((e) => e.ev.byPos[p])) / evals.length || 1;
    const power = [...evals].sort((a, b) => b.ev.score - a.ev.score)
      .map((e, i) => ({ team: e.team, score: e.ev.score, rank: i + 1 }));
    const positionRanks = {};
    for (const e of evals) {
      positionRanks[e.team.id] = {};
      for (const p of POS) {
        const rank = 1 + evals.filter((o) => o.ev.byPos[p] > e.ev.byPos[p]).length;
        positionRanks[e.team.id][p] = { rank, value: e.ev.byPos[p], vsAvg: e.ev.byPos[p] / avg[p] - 1 };
      }
    }
    return { evals, avg, power, positionRanks };
  }

  // The value of a roster spot: roughly what you could pick up off waivers.
  function replacementValue(league) {
    const fa = (league.freeAgentIds || []).map((id) => league.values[id] || 0).filter((v) => v > 0)
      .sort((a, b) => b - a);
    if (fa.length >= 3) return fa[2];
    const rostered = league.teams.flatMap((t) => t.playerIds).map((id) => league.values[id] || 0)
      .filter((v) => v > 0).sort((a, b) => a - b);
    return rostered.length ? rostered[Math.floor(rostered.length * 0.15)] : 0;
  }

  const GRADES = [[14, 'A+'], [9, 'A'], [5, 'A-'], [2, 'B+'], [-1, 'B'], [-4, 'B-'], [-7, 'C+'],
    [-11, 'C'], [-16, 'D']];
  function letter(score) {
    for (const [min, g] of GRADES) if (score >= min) return g;
    return 'F';
  }

  function pointsOver(league, ids, weeks) {
    let total = 0;
    for (const w of weeks) total += evaluate(ids, ctxFor(league, { week: w })).startTotal;
    return total;
  }

  // Projected starting-lineup points before and after, for this week, rest of season and playoffs.
  function pointLenses(league, team, afterIds, cache) {
    const tf = timeframes(league);
    if (!tf) return null;
    const out = {};
    for (const key of ['next', 'ros', 'playoffs']) {
      const weeks = tf[key];
      if (!weeks.length) continue;
      const ck = team.id + '|' + key;
      if (cache && cache[ck] == null) cache[ck] = pointsOver(league, team.playerIds, weeks);
      const before = cache ? cache[ck] : pointsOver(league, team.playerIds, weeks);
      const after = pointsOver(league, afterIds, weeks);
      const delta = after - before;
      const pctD = delta / Math.max(before, 1);
      const score = clamp(pctD * 100 * (key === 'next' ? 2 : 2.5), -30, 30);
      out[key] = { weeks, before, after, delta, pct: pctD, score, grade: letter(score) };
    }
    return out;
  }

  function combine(lenses, mode) {
    const w = MODES[mode] || MODES.balanced;
    let tot = 0;
    let wsum = 0;
    for (const k of Object.keys(lenses)) { tot += w[k] * lenses[k].score; wsum += w[k]; }
    return wsum ? tot / wsum : 0;
  }

  function sideResult(league, ctx, team, gives, gets, repl, opts = {}) {
    const vOut = sum(gives.map(ctx.val));
    const vIn = sum(gets.map(ctx.val));
    const rosterAdj = (gets.length - gives.length) * repl;
    const net = vIn - vOut - rosterAdj;
    const valuePct = net / Math.max(vIn, vOut, 1);
    const before = evaluate(team.playerIds, ctx);
    const afterIds = team.playerIds.filter((id) => !gives.includes(id)).concat(gets);
    const after = evaluate(afterIds, ctx);
    const lineupPct = (after.score - before.score) / Math.max(before.score, 1);
    const valueScore = 100 * (0.55 * valuePct + 0.45 * clamp(lineupPct * 2.5, -1, 1));
    const lenses = { value: { score: valueScore, grade: letter(valueScore) } };
    if (opts.points) Object.assign(lenses, pointLenses(league, team, afterIds, opts.cache) || {});
    const score = combine(lenses, opts.mode);
    return { team, vIn, vOut, rosterAdj, net, valuePct, before, after, lineupPct, valueScore, lenses, score, grade: letter(score) };
  }

  function posChanges(league, side) {
    const out = {};
    for (const p of POS) out[p] = side.after.byPos[p] - side.before.byPos[p];
    return out;
  }

  function tradeNotes(league, me, them) {
    const notes = [];
    const name = (id) => (league.players[id] || {}).name || id;
    const diff = me.net;
    const fairness = Math.abs(me.vIn - me.vOut - me.rosterAdj) / Math.max(me.vIn, me.vOut, 1);
    if (fairness < 0.08) notes.push('Value is close to even. This is a fair offer.');
    else if (diff > 0) notes.push(`You win on value by about ${Math.round(diff).toLocaleString()} points.`);
    else notes.push(`You overpay by about ${Math.round(-diff).toLocaleString()} points of value.`);
    if (me.rosterAdj > 0) notes.push(`You receive more players than you send, so you'll need to drop someone (about ${Math.round(me.rosterAdj).toLocaleString()} in value) to make room.`);
    if (me.rosterAdj < 0) notes.push(`You consolidate and free a roster spot (worth about ${Math.round(-me.rosterAdj).toLocaleString()} off waivers).`);
    const pc = posChanges(league, me);
    const ups = POS.filter((p) => pc[p] > 150).sort((a, b) => pc[b] - pc[a]);
    const downs = POS.filter((p) => pc[p] < -150).sort((a, b) => pc[a] - pc[b]);
    if (ups.length) notes.push(`Your starting ${ups.join(' and ')} group gets better.`);
    if (downs.length) notes.push(`Your starting ${downs.join(' and ')} group gets thinner.`);
    const emptyCount = (ev) => { const c = {}; ev.starters.filter((s) => !s.id).forEach((s) => { c[s.slot] = (c[s.slot] || 0) + 1; }); return c; };
    const was = emptyCount(me.before);
    const now = emptyCount(me.after);
    const emptied = Object.keys(now).filter((k) => now[k] > (was[k] || 0));
    if (emptied.length) notes.push(`Warning: you'd have no one to start at ${[...new Set(emptied)].join(', ')}.`);
    if (them.lineupPct > 0.01) notes.push(`${them.team.name} improves their lineup too, so they're likely to accept.`);
    else if (them.score < -6) notes.push(`${them.team.name} loses this one clearly. Expect a decline.`);
    const L = me.lenses;
    const pts = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
    if (L.next) notes.push(`Week ${L.next.weeks[0]}: ${pts(L.next.delta)} projected points for your lineup.`);
    if (L.ros && L.ros.weeks.length > 1) notes.push(`Rest of season (Weeks ${L.ros.weeks[0]}–${L.ros.weeks[L.ros.weeks.length - 1]}): ${pts(L.ros.delta)} projected points.`);
    if (L.playoffs) notes.push(`Fantasy playoffs (Weeks ${L.playoffs.weeks.join(', ')}): ${pts(L.playoffs.delta)} projected points.`);
    const newStarters = me.after.starters.filter((s) => s.id && me.vIn && !me.before.starters.some((b) => b.id === s.id));
    if (newStarters.length) notes.push(`New starter${newStarters.length > 1 ? 's' : ''}: ${newStarters.map((s) => name(s.id)).join(', ')}.`);
    return notes;
  }

  function gradeTrade(league, myTeamId, partnerTeamId, give, get, mode) {
    const ctx = ctxFor(league);
    const repl = replacementValue(league);
    const mine = teamById(league, myTeamId);
    const theirs = teamById(league, partnerTeamId);
    const points = hasProj(league);
    const me = sideResult(league, ctx, mine, give, get, repl, { points, mode });
    const them = sideResult(league, ctx, theirs, get, give, repl, { points, mode: 'balanced' });
    return { me, them, repl, notes: tradeNotes(league, me, them), timeframes: timeframes(league) };
  }

  function combos(arr, k) {
    if (k === 1) return arr.map((x) => [x]);
    const out = [];
    for (let i = 0; i < arr.length; i++) for (const rest of combos(arr.slice(i + 1), k - 1)) out.push([arr[i], ...rest]);
    return out;
  }

  // Offers other managers could make for a fixed group of your players: packages of 1–3 of their
  // players that they would accept, ranked by how good they are for you.
  function findOffers(league, myTeamId, give, opts = {}) {
    const ctx = ctxFor(league);
    const repl = replacementValue(league);
    const mine = teamById(league, myTeamId);
    const points = hasProj(league);
    const vOut = sum(give.map(ctx.val));
    const maxGet = Math.min(3, give.length + 1);
    const cache = {};
    const prelim = [];
    for (const partner of league.teams) {
      if (String(partner.id) === String(myTeamId)) continue;
      const pool = partner.playerIds.filter((id) => ctx.val(id) > 0 && POS.includes(ctx.pos(id)))
        .sort((a, b) => ctx.val(b) - ctx.val(a)).slice(0, 16);
      for (let k = 1; k <= maxGet; k++) {
        for (const get of combos(pool, k)) {
          const vIn = sum(get.map(ctx.val));
          if (vIn < vOut * 0.6 - repl || vIn > vOut * 1.25 + repl) continue;
          const them = sideResult(league, ctx, partner, get, give, repl);
          if (them.valuePct < -0.1 || them.valueScore < -4) continue;
          const me = sideResult(league, ctx, mine, give, get, repl);
          prelim.push({ partner, give, get, me, them, rank: me.valueScore });
        }
      }
    }
    prelim.sort((a, b) => b.rank - a.rank);
    let results = prelim.slice(0, 600);
    if (points) {
      results = results.map((r) => {
        const me = sideResult(league, ctx, mine, give, r.get, repl, { points, mode: opts.mode, cache });
        const them = sideResult(league, ctx, r.partner, r.get, give, repl, { points, mode: 'balanced', cache });
        return { ...r, me, them };
      }).filter((r) => r.them.score >= -4);
    }
    results.forEach((r) => { r.rank = r.me.score + 0.3 * clamp(r.them.score, -5, 6); });
    results.sort((a, b) => b.rank - a.rank);
    const perTeam = {};
    const seenPlayer = {};
    const picked = [];
    for (const r of results) {
      if ((perTeam[r.partner.id] || 0) >= (opts.perTeam || 2)) continue;
      if (r.get.some((id) => (seenPlayer[id] || 0) >= 1)) continue;
      perTeam[r.partner.id] = (perTeam[r.partner.id] || 0) + 1;
      r.get.forEach((id) => { seenPlayer[id] = 1; });
      r.notes = tradeNotes(league, r.me, r.them);
      picked.push(r);
      if (picked.length >= (opts.limit || 15)) break;
    }
    return picked;
  }

  // Search every other roster for trades that improve your lineup and that the other manager
  // has a reason to accept.
  function findTrades(league, myTeamId, opts = {}) {
    const ctx = ctxFor(league);
    const repl = replacementValue(league);
    const mine = teamById(league, myTeamId);
    const points = hasProj(league);
    const myPool = mine.playerIds.filter((id) => ctx.val(id) > 0 && POS.includes(ctx.pos(id)))
      .sort((a, b) => ctx.val(b) - ctx.val(a)).slice(0, 14);
    const shapes = opts.shapes || [[1, 1], [2, 1], [1, 2], [2, 2]];
    const results = [];
    for (const partner of league.teams) {
      if (String(partner.id) === String(myTeamId)) continue;
      if (opts.partnerId && String(partner.id) !== String(opts.partnerId)) continue;
      const theirPool = partner.playerIds.filter((id) => ctx.val(id) > 0 && POS.includes(ctx.pos(id)))
        .sort((a, b) => ctx.val(b) - ctx.val(a)).slice(0, 14);
      for (const [g, r] of shapes) {
        const lim = g === 2 && r === 2 ? 9 : 14;
        const gives = combos(myPool.slice(0, lim), g);
        const gets = combos(theirPool.slice(0, lim), r);
        for (const give of gives) {
          const vOut = sum(give.map(ctx.val));
          for (const get of gets) {
            const vIn = sum(get.map(ctx.val));
            // Skip packages that are wildly mismatched before the expensive lineup math.
            if (vIn > vOut * 1.5 + repl || vOut > vIn * 1.6 + repl) continue;
            // First pass on trade value only; projections are checked for the survivors below.
            const me = sideResult(league, ctx, mine, give, get, repl);
            if (me.valueScore < (points ? -6 : 1) || (!points && me.lineupPct < 0.004)) continue;
            const them = sideResult(league, ctx, partner, get, give, repl);
            if (them.valuePct < -0.1 || them.lineupPct < -0.012 || them.valueScore < -4) continue;
            results.push({ partner, give, get, me, them, rank: me.valueScore + 0.5 * clamp(them.valueScore, -5, 6) });
          }
        }
      }
    }
    results.sort((a, b) => b.rank - a.rank);
    if (points) {
      const cache = {};
      const full = [];
      for (const r of results.slice(0, 1500)) {
        const me = sideResult(league, ctx, mine, r.give, r.get, repl, { points, mode: opts.mode, cache });
        if (me.score < 1) continue;
        const lead = { now: 'next', playoffs: 'playoffs', long: 'value' }[opts.mode] || 'ros';
        if (me.lenses[lead] && me.lenses[lead].score <= 0) continue;
        const them = sideResult(league, ctx, r.partner, r.get, r.give, repl, { points, mode: 'balanced', cache });
        if (them.score < -4) continue;
        full.push({ ...r, me, them, rank: me.score + 0.5 * clamp(them.score, -5, 6) });
      }
      results.length = 0;
      results.push(...full.sort((a, b) => b.rank - a.rank));
    }
    const picked = [];
    const targetCount = {};
    const partnerCount = {};
    const giveCount = {};
    for (const r of results) {
      const key = r.get.join('+');
      if (targetCount[key] >= 1) continue;
      if ((partnerCount[r.partner.id] || 0) >= 3) continue;
      if (r.give.some((id) => (giveCount[id] || 0) >= 3)) continue;
      if (r.get.some((id) => (targetCount['p' + id] || 0) >= 2)) continue;
      targetCount[key] = 1;
      r.get.forEach((id) => { targetCount['p' + id] = (targetCount['p' + id] || 0) + 1; });
      r.give.forEach((id) => { giveCount[id] = (giveCount[id] || 0) + 1; });
      partnerCount[r.partner.id] = (partnerCount[r.partner.id] || 0) + 1;
      r.notes = tradeNotes(league, r.me, r.them);
      picked.push(r);
      if (picked.length >= (opts.limit || 12)) break;
    }
    return picked;
  }

  // Best projected lineup for one week, compared with the lineup the manager has set.
  function optimalLineup(league, teamId, week) {
    const team = teamById(league, teamId);
    const ctx = ctxFor(league, { week });
    const ev = evaluate(team.playerIds, ctx);
    const proj = (league.proj && league.proj[week]) || {};
    const current = (team.starters || []).filter((id) => team.playerIds.includes(id));
    const currentPts = current.length ? sum(current.map((id) => ctx.val(id) * ctx.avail(id))) : null;
    const best = new Set(ev.starters.map((s) => s.id).filter(Boolean));
    const cur = new Set(current);
    const moves = current.length ? {
      start: [...best].filter((id) => !cur.has(id)),
      sit: current.filter((id) => !best.has(id)),
    } : null;
    const info = (id) => ({ id, pts: ctx.val(id), exp: ctx.val(id) * ctx.avail(id), opp: (proj[id] || {}).opp || null,
      bye: !proj[id] || (!proj[id].pts && !proj[id].opp) });
    return {
      week, total: ev.startTotal, currentPts, moves,
      holes: ev.starters.filter((s) => !s.id || ctx.val(s.id) * ctx.avail(s.id) === 0).map((s) => s.slot),
      starters: ev.starters.map((s) => ({ slot: s.slot, ...(s.id ? info(s.id) : { id: null }) })),
      bench: team.playerIds.filter((id) => !best.has(id)).map(info).sort((a, b) => b.exp - a.exp),
    };
  }

  function rosterLimit(league) {
    return POS.reduce((s, p) => s + (league.slots[p] || 0), 0)
      + FLEX_ORDER.reduce((s, f) => s + (league.slots[f] || 0), 0)
      + (league.slots.BN || 0) + (league.slots.K || 0) + (league.slots.DEF || 0);
  }

  // Rank free agents by how much they improve your lineup this week (injuries counted),
  // and pick who to drop for each.
  function recommendWaivers(league, myTeamId, opts = {}) {
    const ctx = ctxFor(league, { health: true });
    const full = ctxFor(league);
    const mine = teamById(league, myTeamId);
    const base = evaluate(mine.playerIds, ctx);
    // Blend this week's healthy lineup with full-strength value, so an injured star is never the drop.
    const both = (ids) => (evaluate(ids, ctx).score + evaluate(ids, full).score) / 2;
    const baseBoth = both(mine.playerIds);
    const analysis = analyzeLeague(league, { health: true });
    const ranks = analysis.positionRanks[mine.id];
    const openSpot = mine.playerIds.length < rosterLimit(league);
    const starterIds = new Set(base.starters.map((s) => s.id));
    const dropPool = mine.playerIds.filter((id) => !starterIds.has(id) && POS.includes(ctx.pos(id)));
    const fa = (league.freeAgentIds || []).filter((id) => ctx.val(id) > 0 && POS.includes(ctx.pos(id)))
      .sort((a, b) => ctx.val(b) - ctx.val(a)).slice(0, opts.pool || 120);
    const out = [];
    for (const id of fa) {
      let best = null;
      const candidates = openSpot ? [null, ...dropPool] : dropPool;
      for (const d of candidates) {
        const ids = mine.playerIds.filter((x) => x !== d).concat(id);
        const s = both(ids);
        if (!best || s > best.score) best = { score: s, drop: d };
      }
      if (!best) continue;
      const gain = best.score - baseBoth;
      const gainPct = gain / Math.max(baseBoth, 1);
      const pos = ctx.pos(id);
      const trend = (league.trending || {})[id] || 0;
      const rank = gainPct * 100 + Math.log10(1 + trend) * 0.15 + ctx.val(id) / 20000;
      const after = evaluate(mine.playerIds.filter((x) => x !== best.drop).concat(id), ctx);
      const startsFor = after.starters.find((s) => s.id === id);
      const reasons = [];
      if (startsFor) {
        const bumped = base.starters.find((s) => s.slot === startsFor.slot && !after.starters.some((a) => a.id === s.id));
        reasons.push(bumped && bumped.id
          ? `Starts at ${slotLabel(startsFor.slot)} over ${league.players[bumped.id].name}`
          : `Fills an empty ${slotLabel(startsFor.slot)} spot`);
      } else {
        reasons.push(`Bench depth at ${pos}`);
      }
      if (ranks[pos].rank > league.teams.length * 0.6) {
        reasons.push(`Your ${pos} room ranks ${ordinal(ranks[pos].rank)} of ${league.teams.length}`);
      }
      const hurt = base.starters.filter((s) => s.id && s.pos === pos && ctx.avail(s.id) < 0.6);
      if (hurt.length) reasons.push(`Covers for ${hurt.map((s) => league.players[s.id].name).join(', ')} (injured)`);
      if (trend > 1000) reasons.push(`${compact(trend)} adds in the last 24h`);
      out.push({ id, gain, gainPct, drop: best.drop, rank, reasons, tier: waiverTier(gainPct), bid: bidFor(league, gainPct) });
    }
    out.sort((a, b) => b.rank - a.rank);
    return { picks: out.slice(0, opts.limit || 25), base, ranks, openSpot };
  }

  function waiverTier(g) {
    if (g >= 0.04) return 'Priority add';
    if (g >= 0.015) return 'Strong add';
    if (g >= 0.003) return 'Depth add';
    return 'Stash';
  }

  function bidFor(league, g) {
    const pct = g >= 0.04 ? [15, 30] : g >= 0.015 ? [5, 15] : g >= 0.003 ? [1, 5] : [0, 1];
    if (!league.faab) return { pct, dollars: null };
    const b = league.faab.budget || 100;
    const rem = league.faab.remaining != null ? league.faab.remaining : b;
    return { pct, dollars: pct.map((p) => Math.min(rem, Math.round((b * p) / 100))) };
  }

  function slotLabel(s) {
    return { SUPER_FLEX: 'Superflex', REC_FLEX: 'WR/TE flex', WRRB_FLEX: 'RB/WR flex', FLEX: 'Flex' }[s] || s;
  }
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function compact(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); }

  // Fallback values when the trade-value service is unreachable: value over replacement
  // from season projections, scaled to the same 0..10000 range.
  function valuesFromProjections(rows, league) {
    const out = {};
    const flexShare = { QB: (league.slots.SUPER_FLEX || 0) * 0.8, RB: 0.45, WR: 0.5, TE: 0.08 };
    const flexCount = (league.slots.FLEX || 0) + (league.slots.WRRB_FLEX || 0) + (league.slots.REC_FLEX || 0) * 0.5;
    for (const p of POS) {
      const list = rows.filter((r) => r.pos === p).sort((a, b) => b.pts - a.pts);
      const starters = (league.slots[p] || 0) + (p === 'QB' ? flexShare.QB : flexShare[p] * flexCount);
      const replIdx = Math.max(0, Math.round(league.numTeams * starters * 1.15));
      const repl = (list[replIdx] || list[list.length - 1] || { pts: 0 }).pts;
      for (const r of list) out[r.id] = Math.max(0, r.pts - repl * 0.85);
    }
    const max = Math.max(1, ...Object.values(out));
    for (const id in out) out[id] = Math.round(10000 * Math.pow(out[id] / max, 1.25));
    return out;
  }

  const Engine = { POS, ALL_POS, MODES, hasProj, timeframes, optimalLineup, pointsOver, evaluate, analyzeLeague, gradeTrade, findTrades, recommendWaivers, replacementValue,
    findOffers, valuesFromProjections, normName, letter, slotLabel, ordinal, compact, teamById, rosterLimit, ctxFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof self !== 'undefined' ? self : this);
