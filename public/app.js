/* global Engine, Demo */
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(n || 0).toLocaleString();
  const pct = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('ggm:' + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('ggm:' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('ggm:' + k); } catch {} },
  };

  const state = {
    league: null, myTeamId: null, tab: 'team', conn: null,
    grader: { partnerId: null, give: new Set(), get: new Set() },
    finderPartner: 'all', finderCache: null, finderView: 'suggest', shopBlock: new Set(), wantPos: new Set(), waiverPos: 'ALL', mode: 'balanced', lineupWeek: null,
  };
  const TABS = ['team', 'lineup', 'grader', 'finder', 'waivers'];

  async function api(path, headers) {
    let res;
    try {
      res = await fetch(path, { headers: headers || {} });
    } catch {
      throw new Error("Can't reach the Gridiron GM server. Keep the black window running `node server.js` open, then try again.");
    }
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
    return body;
  }

  function setStatus(msg, isError) {
    const el = $('#connect-status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function currentSeasonGuess() {
    const d = new Date();
    return d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
  }

  // ---------- Sleeper ----------
  const SLEEPER_SLOT = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX', SUPER_FLEX: 'SUPER_FLEX',
    REC_FLEX: 'REC_FLEX', WRRB_FLEX: 'WRRB_FLEX', K: 'K', DEF: 'DEF', BN: 'BN' };

  async function sleeperFindLeagues(username) {
    const nfl = await api('/api/sleeper/state/nfl');
    const user = await api(`/api/sleeper/user/${encodeURIComponent(username)}`);
    if (!user || !user.user_id) throw new Error(`No Sleeper user named "${username}".`);
    const season = nfl.league_season || nfl.season;
    let leagues = await api(`/api/sleeper/user/${user.user_id}/leagues/nfl/${season}`);
    if (!leagues || !leagues.length) {
      leagues = await api(`/api/sleeper/user/${user.user_id}/leagues/nfl/${Number(season) - 1}`);
    }
    if (!leagues || !leagues.length) throw new Error(`${username} has no Sleeper leagues for ${season}.`);
    return { user, leagues, week: nfl.week };
  }

  async function loadSleeper(userId, leagueId) {
    const [nfl, lg, rosters, users, players, trending] = await Promise.all([
      api('/api/sleeper/state/nfl'),
      api(`/api/sleeper/league/${leagueId}`),
      api(`/api/sleeper/league/${leagueId}/rosters`),
      api(`/api/sleeper/league/${leagueId}/users`),
      api('/api/sleeper-players'),
      api('/api/sleeper/players/nfl/trending/add?lookback_hours=24&limit=100').catch(() => []),
    ]);
    const slots = {};
    for (const s of lg.roster_positions || []) {
      const k = SLEEPER_SLOT[s];
      if (k) slots[k] = (slots[k] || 0) + 1;
    }
    const userName = {};
    for (const u of users || []) userName[u.user_id] = { owner: u.display_name, team: (u.metadata && u.metadata.team_name) || null };
    const teams = rosters.map((r) => {
      const u = userName[r.owner_id] || {};
      return {
        id: String(r.roster_id),
        name: u.team || u.owner || `Team ${r.roster_id}`,
        owner: u.owner || '',
        ownerIds: [r.owner_id, ...(r.co_owners || [])],
        playerIds: (r.players || []).filter((id) => players[id]),
        starters: (r.starters || []).filter((id) => id && id !== '0'),
        faabUsed: (r.settings && r.settings.waiver_budget_used) || 0,
      };
    });
    const rostered = new Set(teams.flatMap((t) => t.playerIds));
    const freeAgentIds = Object.values(players)
      .filter((p) => Engine.POS.includes(p.pos) && p.team && !rostered.has(p.id)).map((p) => p.id);
    const mine = teams.find((t) => t.ownerIds.includes(userId));
    const st = lg.settings || {};
    const faab = st.waiver_type === 2
      ? { budget: st.waiver_budget || 100, remaining: (st.waiver_budget || 100) - (mine ? mine.faabUsed : 0) } : null;
    const trend = {};
    for (const t of trending || []) trend[t.player_id] = t.count;
    const sameSeason = String(nfl.season) === String(lg.season) && nfl.season_type !== 'post';
    const week = !sameSeason ? null : nfl.season_type === 'pre' ? 1 : Number(nfl.week) || 1;
    return {
      ...calendar(week, st.playoff_week_start || 15, st.playoff_teams || 6, 1),
      scoring: lg.scoring_settings || null,
      platform: 'sleeper', id: leagueId, name: lg.name, season: Number(lg.season), numTeams: lg.total_rosters || teams.length,
      ppr: (lg.scoring_settings && lg.scoring_settings.rec) || 0,
      numQbs: slots.SUPER_FLEX || (slots.QB || 0) > 1 ? 2 : 1,
      isDynasty: st.type === 2, slots, teams, players, values: {}, freeAgentIds, trending: trend, ownership: {}, faab,
      myTeamId: mine ? mine.id : teams[0].id,
    };
  }

  // ---------- ESPN ----------
  const ESPN_POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
  const ESPN_SLOT = { 0: 'QB', 2: 'RB', 3: 'WRRB_FLEX', 4: 'WR', 5: 'REC_FLEX', 6: 'TE', 7: 'SUPER_FLEX', 16: 'DEF', 17: 'K', 20: 'BN', 23: 'FLEX' };
  const ESPN_TEAM = { 0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND',
    12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
    24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' };
  const ESPN_INJ = { ACTIVE: null, NORMAL: null, QUESTIONABLE: 'Q', DOUBTFUL: 'D', OUT: 'Out', INJURY_RESERVE: 'IR', SUSPENSION: 'Sus' };

  function espnPlayer(p) {
    return {
      id: 'e' + p.id, espnId: String(p.id), name: p.fullName, pos: ESPN_POS[p.defaultPositionId] || 'NA',
      team: ESPN_TEAM[p.proTeamId] || null, injury: ESPN_INJ[p.injuryStatus] !== undefined ? ESPN_INJ[p.injuryStatus] : null,
    };
  }

  async function loadEspn({ leagueId, season, s2, swid }) {
    const headers = s2 && swid ? { 'x-espn-s2': s2, 'x-espn-swid': swid } : {};
    const base = `/api/espn?leagueId=${encodeURIComponent(leagueId)}&season=${encodeURIComponent(season)}`;
    const data = await api(`${base}&views=mTeam,mRoster,mSettings`, headers);
    const filter = JSON.stringify({ players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: [0, 2, 4, 6] }, limit: 300,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    } });
    const faData = await api(`${base}&views=kona_player_info&filter=${encodeURIComponent(filter)}`, headers).catch(() => ({ players: [] }));
    const settings = data.settings || {};
    const slots = {};
    const counts = (settings.rosterSettings && settings.rosterSettings.lineupSlotCounts) || {};
    for (const [sid, n] of Object.entries(counts)) {
      const k = ESPN_SLOT[sid];
      if (k && n) slots[k] = (slots[k] || 0) + n;
    }
    const members = {};
    for (const m of data.members || []) members[m.id] = m.displayName || `${m.firstName || ''} ${m.lastName || ''}`.trim();
    const players = {};
    const teams = (data.teams || []).map((t) => {
      const ids = [];
      const starters = [];
      for (const e of (t.roster && t.roster.entries) || []) {
        const p = e.playerPoolEntry && e.playerPoolEntry.player;
        if (!p) continue;
        const pl = espnPlayer(p);
        players[pl.id] = pl;
        ids.push(pl.id);
        if (e.lineupSlotId != null && e.lineupSlotId !== 20 && e.lineupSlotId !== 21) starters.push(pl.id);
      }
      const ownerId = t.primaryOwner || (t.owners || [])[0];
      return {
        id: String(t.id), name: t.name || `${t.location || ''} ${t.nickname || ''}`.trim() || `Team ${t.id}`,
        owner: members[ownerId] || '', ownerIds: (t.owners || []).map((o) => String(o).toUpperCase()), playerIds: ids, starters,
        faabUsed: (t.transactionCounter && t.transactionCounter.acquisitionBudgetSpent) || 0,
      };
    });
    if (!teams.length) throw new Error('ESPN returned no teams. If this is a private league, add your cookies.');
    const freeAgentIds = [];
    const ownership = {};
    for (const entry of faData.players || []) {
      const p = entry.player;
      if (!p) continue;
      const pl = espnPlayer(p);
      if (!Engine.POS.includes(pl.pos) || players[pl.id]) continue;
      players[pl.id] = pl;
      freeAgentIds.push(pl.id);
      if (p.ownership) ownership[pl.id] = p.ownership.percentOwned;
    }
    const swidKey = swid ? (swid.trim().startsWith('{') ? swid.trim() : `{${swid.trim()}}`).toUpperCase() : null;
    const mine = swidKey ? teams.find((t) => t.ownerIds.includes(swidKey)) : null;
    const scoring = ((settings.scoringSettings && settings.scoringSettings.scoringItems) || []).find((s) => s.statId === 53);
    const acq = settings.acquisitionSettings || {};
    const faab = acq.isUsingAcquisitionBudget
      ? { budget: acq.acquisitionBudget || 100, remaining: (acq.acquisitionBudget || 100) - (mine ? mine.faabUsed : 0) } : null;
    const sched = settings.scheduleSettings || {};
    const week = data.scoringPeriodId || (data.status && data.status.currentMatchupPeriod) || null;
    return {
      ...calendar(week, (sched.matchupPeriodCount || 14) + 1, sched.playoffTeamCount || 6, sched.playoffMatchupPeriodLength || 1),
      platform: 'espn', id: leagueId, name: settings.name || `ESPN league ${leagueId}`, season: Number(season),
      numTeams: settings.size || teams.length, ppr: scoring ? scoring.points : 0,
      numQbs: slots.SUPER_FLEX || (slots.QB || 0) > 1 ? 2 : 1, isDynasty: false,
      slots, teams, players, values: {}, freeAgentIds, trending: {}, ownership, faab,
      myTeamId: mine ? mine.id : null,
    };
  }

  // ---------- Calendar and projections ----------
  function calendar(week, playoffStart, playoffTeams, roundLength) {
    const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, playoffTeams))));
    const playoffWeeks = [];
    for (let w = playoffStart; w < playoffStart + rounds * roundLength && w <= 18; w++) playoffWeeks.push(w);
    const lastWeek = playoffWeeks.length ? playoffWeeks[playoffWeeks.length - 1] : 17;
    return { week: week && week <= lastWeek ? week : null, playoffWeeks, lastWeek };
  }

  // Projected fantasy points for one Sleeper projection row under this league's scoring.
  function projPoints(row, league) {
    const st = row.stats || {};
    if (league.scoring && row.pos !== 'K' && row.pos !== 'DEF') {
      let p = 0;
      for (const [k, mult] of Object.entries(league.scoring)) if (typeof st[k] === 'number') p += st[k] * mult;
      if (p > 0) return p;
    }
    const pick = league.ppr >= 0.75 ? st.pts_ppr : league.ppr >= 0.25 ? st.pts_half_ppr : st.pts_std;
    return pick ?? st.pts_ppr ?? 0;
  }

  const TEAM_ALIAS = { WSH: 'WAS' };
  async function attachProjections(league) {
    league.proj = {};
    if (!league.week) { league.projSource = 'Weekly projections: the season is over or hasn\'t started.'; return; }
    const weeks = [];
    for (let w = league.week; w <= league.lastWeek; w++) weeks.push(w);
    try {
      const all = await Promise.all(weeks.map((w) => api(`/api/projections?season=${league.season}&week=${w}`)));
      weeks.forEach((w, i) => {
        const index = {};
        for (const r of all[i] || []) {
          const pts = Math.round(projPoints(r, league) * 10) / 10;
          const entry = { pts, opp: r.opp };
          if (league.platform === 'sleeper') { index[r.id] = entry; continue; }
          const key = r.pos === 'DEF' ? 'DEF|' + r.id : Engine.normName(r.name) + '|' + r.pos;
          index[key] = entry;
        }
        const map = {};
        for (const pl of Object.values(league.players)) {
          const key = league.platform === 'sleeper' ? pl.id
            : pl.pos === 'DEF' ? 'DEF|' + (TEAM_ALIAS[pl.team] || pl.team) : Engine.normName(pl.name) + '|' + pl.pos;
          if (index[key]) map[pl.id] = index[key];
        }
        league.proj[w] = map;
      });
      league.projSource = `Weekly projections: Sleeper, Weeks ${weeks[0]}–${weeks[weeks.length - 1]}. Fantasy playoffs: Weeks ${league.playoffWeeks.join(', ')}.`;
    } catch (e) {
      league.proj = {};
      league.projSource = `Weekly projections unavailable (${e.message}). Lineup tips and weekly trade grades are off.`;
    }
  }

  // ---------- Values ----------
  async function attachValues(league) {
    const ppr = league.ppr >= 0.75 ? 1 : league.ppr >= 0.25 ? 0.5 : 0;
    const q = new URLSearchParams({ isDynasty: String(!!league.isDynasty), numQbs: String(league.numQbs),
      numTeams: String(league.numTeams), ppr: String(ppr) });
    league.values = {};
    try {
      const rows = await api(`/api/values?${q}`);
      const bySleeper = {};
      const byEspn = {};
      const byName = {};
      for (const r of rows) {
        const p = r.player || {};
        const v = r.value || 0;
        if (p.sleeperId) bySleeper[String(p.sleeperId)] = v;
        if (p.espnId) byEspn[String(p.espnId)] = v;
        byName[Engine.normName(p.name) + '|' + p.position] = v;
      }
      for (const pl of Object.values(league.players)) {
        const v = (league.platform === 'sleeper' ? bySleeper[pl.id] : byEspn[pl.espnId])
          ?? byName[Engine.normName(pl.name) + '|' + pl.pos];
        if (v) league.values[pl.id] = v;
      }
      league.valueSource = `Trade values: FantasyCalc ${league.isDynasty ? 'dynasty' : 'redraft'}, ${league.numQbs === 2 ? 'superflex' : '1QB'}, ${ppr} PPR, ${league.numTeams} teams`;
    } catch (e) {
      const rows = await api(`/api/projections?season=${league.season}`);
      const byName = {};
      const flat = [];
      for (const r of rows || []) {
        const pts = projPoints(r, league);
        if (!pts || !Engine.POS.includes(r.pos)) continue;
        flat.push({ id: r.id, pos: r.pos, pts, name: r.name });
      }
      const vals = Engine.valuesFromProjections(flat, league);
      for (const f of flat) byName[Engine.normName(f.name) + '|' + f.pos] = vals[f.id];
      for (const pl of Object.values(league.players)) {
        const v = league.platform === 'sleeper' ? vals[pl.id] : byName[Engine.normName(pl.name) + '|' + pl.pos];
        if (v) league.values[pl.id] = v;
      }
      league.valueSource = `Trade values: built from Sleeper season projections (FantasyCalc was unreachable: ${e.message})`;
    }
  }

  // ---------- Connect ----------
  async function openLeague(league, conn) {
    state.league = league;
    state.conn = conn;
    state.myTeamId = league.myTeamId || store.get(`team:${league.platform}:${league.id}`) || league.teams[0].id;
    state.grader = { partnerId: null, give: new Set(), get: new Set() };
    state.finderCache = null;
    state.shopBlock = new Set();
    state.mode = store.get('mode') || (league.isDynasty ? 'long' : 'balanced');
    state.lineupWeek = league.week;
    if (conn) store.set('last', conn);
    $('#connect').hidden = true;
    $('#workspace').hidden = false;
    $('#league-meta').hidden = false;
    $('#league-name').textContent = `${league.name} · ${league.season}`;
    $('#type-select').value = String(!!league.isDynasty);
    $('#team-select').innerHTML = league.teams.map((t) =>
      `<option value="${esc(t.id)}">${esc(t.name)}${t.owner && t.owner !== t.name ? ' (' + esc(t.owner) + ')' : ''}</option>`).join('');
    $('#team-select').value = state.myTeamId;
    setSource();
    const hash = location.hash.slice(1);
    selectTab(TABS.includes(hash) ? hash : 'team');
  }

  function setSource() {
    const L = state.league;
    $('#value-source').textContent = [L.valueSource, L.projSource].filter(Boolean).join(' · ')
      + (!L.myTeamId && !store.get(`team:${L.platform}:${L.id}`) ? ' · Pick your team from the Team menu above.' : '');
  }

  async function withBusy(btn, fn) {
    const label = btn && btn.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try { await fn(); } catch (e) { setStatus(e.message, true); }
    finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
  }

  let sleeperLookup = null;
  $('#sleeper-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const btn = $('#sleeper-go');
    withBusy(btn, async () => {
      const username = $('#sleeper-user').value.trim();
      if (!sleeperLookup || sleeperLookup.username !== username) {
        setStatus('Looking up your Sleeper leagues…');
        const r = await sleeperFindLeagues(username);
        sleeperLookup = { username, ...r };
        $('#sleeper-league').innerHTML = r.leagues.map((l) =>
          `<option value="${esc(l.league_id)}">${esc(l.name)} (${l.total_rosters} teams, ${l.season})</option>`).join('');
        $('#sleeper-leagues').hidden = false;
        store.set('sleeperUser', username);
        if (r.leagues.length > 1) { setStatus('Pick a league, then load it.'); btn.dataset.next = '1'; return; }
      }
      setStatus('Loading league, rosters and player values…');
      const leagueId = $('#sleeper-league').value;
      const league = await loadSleeper(sleeperLookup.user.user_id, leagueId);
      await Promise.all([attachValues(league), attachProjections(league)]);
      setStatus('');
      openLeague(league, { platform: 'sleeper', username, userId: sleeperLookup.user.user_id, leagueId });
    }).then(() => { if (btn.dataset.next) { btn.textContent = 'Load league'; delete btn.dataset.next; } });
  });

  // Accept either the bare number or a pasted league URL.
  function espnLeagueId(raw) {
    const v = String(raw || '').trim();
    const m = v.match(/leagueId=(\d+)/i);
    return m ? m[1] : v.replace(/\D/g, '');
  }

  $('#espn-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || $('#espn-form .btn');
    withBusy(btn, async () => {
      const conn = {
        platform: 'espn', leagueId: espnLeagueId($('#espn-league').value), season: $('#espn-season').value.trim() || currentSeasonGuess(),
        s2: $('#espn-s2').value.trim(), swid: $('#espn-swid').value.trim(),
      };
      setStatus('Loading your ESPN league and player values…');
      const league = await loadEspn(conn);
      await Promise.all([attachValues(league), attachProjections(league)]);
      setStatus('');
      const saved = { platform: 'espn', leagueId: conn.leagueId, season: conn.season };
      if ($('#espn-remember').checked) Object.assign(saved, { s2: conn.s2, swid: conn.swid });
      openLeague(league, saved);
    });
  });

  $('#demo-go').addEventListener('click', () => openLeague(Demo.build(), { platform: 'demo' }));

  $('#switch-league').addEventListener('click', () => {
    $('#workspace').hidden = true;
    $('#league-meta').hidden = true;
    $('#connect').hidden = false;
    setStatus('');
  });

  $('#team-select').addEventListener('change', (e) => {
    state.myTeamId = e.target.value;
    store.set(`team:${state.league.platform}:${state.league.id}`, state.myTeamId);
    state.grader = { partnerId: null, give: new Set(), get: new Set() };
    state.finderCache = null;
    render();
  });

  $('#type-select').addEventListener('change', async (e) => {
    const L = state.league;
    L.isDynasty = e.target.value === 'true';
    if (L.platform === 'demo') return;
    $('#view').innerHTML = '<p class="loading">Reloading values…</p>';
    try { await attachValues(L); } catch (err) { $('#view').innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    setSource();
    state.finderCache = null;
    render();
  });

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  function selectTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    try { history.replaceState(null, '', '#' + tab); } catch {}
    render();
  }

  // ---------- Rendering helpers ----------
  const P = (id) => state.league.players[id] || { name: id, pos: '?' };
  const V = (id) => state.league.values[id] || 0;
  const posChip = (pos) => `<span class="pos ${esc(pos)}">${esc(pos)}</span>`;
  function injBadge(inj) {
    if (!inj) return '';
    const q = /^(q|questionable)$/i.test(inj);
    return `<span class="inj${q ? ' q' : ''}" title="Injury status">${esc(inj)}</span>`;
  }
  const gradeClass = (g) => 'g-' + g[0].toLowerCase();
  const myTeam = () => Engine.teamById(state.league, state.myTeamId);

  function render() {
    const v = $('#view');
    if (!state.league) return;
    if (state.tab === 'team') v.innerHTML = renderTeam();
    else if (state.tab === 'lineup') { v.innerHTML = renderLineup(); bindLineup(); }
    else if (state.tab === 'grader') { v.innerHTML = renderGrader(); bindGrader(); }
    else if (state.tab === 'finder') renderFinder(v);
    else if (state.tab === 'waivers') { v.innerHTML = renderWaivers(); bindWaivers(); }
  }

  function strengthBars(teamId, analysis) {
    const ranks = analysis.positionRanks[teamId];
    const n = state.league.teams.length;
    return `<div class="strength">${Engine.POS.map((p) => {
      const r = ranks[p];
      const color = r.rank <= n / 3 ? 'var(--good)' : r.rank > (2 * n) / 3 ? 'var(--bad)' : 'var(--warn)';
      const scale = Math.max(r.value, analysis.avg[p]) * 1.25 || 1;
      return `<div class="str-row">${posChip(p)}
        <div class="str-track" title="${esc(p)}: ${fmt(r.value)} vs league average ${fmt(analysis.avg[p])}">
          <div class="str-fill" style="width:${Math.min(100, (r.value / scale) * 100)}%;background:${color}"></div>
          <div class="str-avg" style="left:${Math.min(100, (analysis.avg[p] / scale) * 100)}%"></div>
        </div>
        <span class="str-rank">${Engine.ordinal(r.rank)}/${n}</span></div>`;
    }).join('')}</div>
    <p class="legend">Bar = your starters plus top backup at each spot. Tick = league average. Rank is out of ${n} teams.</p>`;
  }

  function modeSelect(id) {
    if (!Engine.hasProj(state.league)) return '';
    return `<label class="field-inline" for="${id}">Playing for</label>
      <select id="${id}" class="mode-select">${Object.entries(Engine.MODES).map(([k, m]) =>
        `<option value="${k}"${state.mode === k ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select>`;
  }
  function bindMode(after) {
    document.querySelectorAll('.mode-select').forEach((sel) => sel.addEventListener('change', (e) => {
      state.mode = e.target.value;
      store.set('mode', state.mode);
      state.finderCache = null;
      after();
    }));
  }
  const pts1 = (x) => (x == null ? '–' : (Math.round(x * 10) / 10).toFixed(1));
  const signed = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
  const weekSpan = (ws) => (ws.length === 1 ? `Wk ${ws[0]}` : `Wk ${ws[0]}–${ws[ws.length - 1]}`);

  // ---------- Lineup ----------
  function renderLineup() {
    const L = state.league;
    if (!Engine.hasProj(L)) {
      return `<p class="empty">${esc(L.projSource || 'Weekly projections are not available for this league.')}</p>`;
    }
    const weeks = Object.keys(L.proj).map(Number).sort((a, b) => a - b);
    if (!weeks.includes(state.lineupWeek)) state.lineupWeek = weeks[0];
    const wk = state.lineupWeek;
    const r = Engine.optimalLineup(L, state.myTeamId, wk);
    const isNow = wk === L.week;
    const opp = (x) => (x.bye ? '<span class="muted">Bye / no game</span>' : x.opp ? `vs ${esc(x.opp)}` : '');
    const row = (x, slot) => x.id
      ? `<tr class="${x.exp === 0 ? 'dim' : ''}"><td class="slot">${esc(slot)}</td><td>${posChip(P(x.id).pos)}</td>
          <td>${esc(P(x.id).name)}${injBadge(P(x.id).injury)} <span class="muted">${esc(P(x.id).team || '')}</span></td>
          <td>${opp(x)}</td><td class="r num">${x.exp < x.pts - 0.05 ? `<span class="muted" title="Full projection before the injury discount">${pts1(x.pts)} →</span> ` : ''}${pts1(x.exp)}</td></tr>`
      : `<tr><td class="slot">${esc(slot)}</td><td></td><td class="muted">Nobody available</td><td></td><td></td></tr>`;
    const gain = r.currentPts != null && isNow ? r.total - r.currentPts : null;
    const moves = isNow && r.moves && (r.moves.start.length || r.moves.sit.length)
      ? `<div class="moves">
          <div><h4>Put in</h4>${r.moves.start.length ? '' : '<p class="detail">Nobody. Leave the spot empty.</p>'}<ul class="plist">${r.moves.start.map((id) => `<li>${posChip(P(id).pos)}<span class="nm">${esc(P(id).name)}</span><span class="num good">${pts1(r.starters.find((s) => s.id === id).exp)}</span></li>`).join('')}</ul></div>
          <div><h4>Take out</h4>${r.moves.sit.length ? '' : '<p class="detail">Nobody. Fill the open spot.</p>'}<ul class="plist">${r.moves.sit.map((id) => { const b = r.bench.find((x) => x.id === id) || {}; return `<li>${posChip(P(id).pos)}<span class="nm">${esc(P(id).name)}${injBadge(P(id).injury)}</span><span class="num muted">${pts1(b.exp)}</span></li>`; }).join('')}</ul></div>
        </div>` : '';
    const holes = [...new Set(r.holes)];
    return `<div class="toolbar">
        <label class="field-inline" for="lineup-week">Week</label>
        <select id="lineup-week">${weeks.map((w) => `<option value="${w}"${w === wk ? ' selected' : ''}>Week ${w}${w === L.week ? ' (this week)' : ''}${L.playoffWeeks.includes(w) ? ' · playoffs' : ''}</option>`).join('')}</select>
      </div>
      <div class="grid-2">
        <div class="stack">
          <div class="panel">
            <h3 class="sec">Projected points</h3>
            <div class="big-num num">${pts1(r.total)}</div>
            <p class="detail">Best possible lineup for Week ${wk}${isNow ? ', with injury designations counted' : ''}.</p>
            ${gain != null ? (gain > 0.05
              ? `<p class="callout">Your current lineup projects <b class="num">${pts1(r.currentPts)}</b>. Make the changes below to gain <b class="num good">${signed(gain)}</b> points.</p>`
              : `<p class="callout ok">Your current lineup is already the best one. Nothing to change.</p>`) : ''}
            ${holes.length ? `<p class="callout warn">No healthy starter for ${holes.map((h) => esc(Engine.slotLabel(h))).join(', ')} this week. Check the Waivers tab.</p>` : ''}
            ${moves}
          </div>
        </div>
        <div class="panel">
          <h3 class="sec">Best lineup · Week ${wk}</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Slot</th><th>Pos</th><th>Player</th><th>Matchup</th><th class="r">Proj</th></tr></thead>
            <tbody><tr class="group"><td colspan="5">Starters</td></tr>${r.starters.map((x) => row(x, Engine.slotLabel(x.slot))).join('')}
            <tr class="group"><td colspan="5">Bench</td></tr>${r.bench.map((x) => row(x, 'BN')).join('')}</tbody>
          </table></div>
          <p class="legend">Questionable players count at 85% of their projection, doubtful at 25%, out and IR at zero.</p>
        </div>
      </div>`;
  }

  function bindLineup() {
    const sel = $('#lineup-week');
    if (sel) sel.addEventListener('change', (e) => { state.lineupWeek = Number(e.target.value); render(); });
  }

  // ---------- My team ----------
  function renderTeam() {
    const L = state.league;
    const team = myTeam();
    const analysis = Engine.analyzeLeague(L);
    const ev = analysis.evals.find((e) => e.team.id === team.id).ev;
    const myPower = analysis.power.find((p) => p.team.id === team.id);
    const topScore = analysis.power[0].score;
    const rows = ev.starters.map((s) => s.id
      ? `<tr><td class="slot">${esc(Engine.slotLabel(s.slot))}</td><td>${posChip(P(s.id).pos)}</td><td>${esc(P(s.id).name)}${injBadge(P(s.id).injury)}</td><td class="muted">${esc(P(s.id).team || '')}</td><td class="r num">${fmt(V(s.id))}</td></tr>`
      : `<tr><td class="slot">${esc(Engine.slotLabel(s.slot))}</td><td></td><td class="muted">Empty</td><td></td><td></td></tr>`).join('');
    const unvalued = team.playerIds.filter((id) => !Engine.POS.includes(P(id).pos));
    const bench = ev.bench.concat(unvalued.map((id) => ({ id }))).map((b) =>
      `<tr><td class="slot">BN</td><td>${posChip(P(b.id).pos)}</td><td>${esc(P(b.id).name)}${injBadge(P(b.id).injury)}</td><td class="muted">${esc(P(b.id).team || '')}</td><td class="r num">${Engine.POS.includes(P(b.id).pos) ? fmt(V(b.id)) : '–'}</td></tr>`).join('');
    const weakest = Engine.POS.slice().sort((a, b) => analysis.positionRanks[team.id][b].rank - analysis.positionRanks[team.id][a].rank)[0];
    const strongest = Engine.POS.slice().sort((a, b) => analysis.positionRanks[team.id][a].rank - analysis.positionRanks[team.id][b].rank)[0];
    return `<div class="grid-2">
      <div class="stack">
        <div class="panel">
          <h3 class="sec">Roster strength</h3>
          <p style="margin:0 0 16px">${esc(team.name)} ranks <b>${Engine.ordinal(myPower.rank)}</b> of ${L.teams.length} on paper.
            Strongest at <b>${strongest}</b>, thinnest at <b>${weakest}</b>.</p>
          ${strengthBars(team.id, analysis)}
        </div>
        <div class="panel">
          <h3 class="sec">Power rankings</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Team</th><th class="r">Roster score</th></tr></thead>
            <tbody>${analysis.power.map((p) => `<tr class="${p.team.id === team.id ? 'me-row' : ''}"><td class="num">${p.rank}</td>
              <td>${esc(p.team.name)}<div class="power-bar" style="width:${(p.score / topScore) * 100}%"></div></td>
              <td class="r num">${fmt(p.score)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
      <div class="panel">
        <h3 class="sec">Best lineup by value</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Slot</th><th>Pos</th><th>Player</th><th>NFL</th><th class="r">Value</th></tr></thead>
          <tbody><tr class="group"><td colspan="5">Starters</td></tr>${rows}<tr class="group"><td colspan="5">Bench</td></tr>${bench}</tbody>
        </table></div>
        ${unvalued.length ? '<p class="legend">Kickers and defenses have no trade value and are left out of the analysis.</p>' : ''}
      </div>
    </div>`;
  }

  // ---------- Trade grader ----------
  function renderGrader() {
    const L = state.league;
    const g = state.grader;
    const others = L.teams.filter((t) => t.id !== state.myTeamId);
    if (!g.partnerId || !others.some((t) => t.id === g.partnerId)) g.partnerId = others[0].id;
    const partner = Engine.teamById(L, g.partnerId);
    const list = (team, set, side) => team.playerIds.filter((id) => Engine.POS.includes(P(id).pos))
      .sort((a, b) => V(b) - V(a)).map((id) =>
        `<button type="button" class="pick" data-side="${side}" data-id="${esc(id)}" aria-pressed="${set.has(id)}">
          ${posChip(P(id).pos)}<span class="nm">${esc(P(id).name)}${injBadge(P(id).injury)}</span><span class="num muted">${fmt(V(id))}</span></button>`).join('');
    return `<div class="stack">
      <div class="grader-cols">
        <div class="panel">
          <div class="side-head"><h3 class="sec">You send</h3></div>
          <div class="pick-list">${list(myTeam(), g.give, 'give')}</div>
        </div>
        <div class="panel">
          <div class="side-head"><h3 class="sec">You receive from</h3>
            <select id="partner-select">${others.map((t) => `<option value="${esc(t.id)}"${t.id === g.partnerId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
          </div>
          <div class="pick-list">${list(partner, g.get, 'get')}</div>
        </div>
      </div>
      <div class="panel" id="verdict"></div>
    </div>`;
  }

  function bindGrader() {
    const g = state.grader;
    $('#partner-select').addEventListener('change', (e) => { g.partnerId = e.target.value; g.get.clear(); render(); });
    document.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => {
      const set = b.dataset.side === 'give' ? g.give : g.get;
      const id = b.dataset.id;
      if (set.has(id)) set.delete(id); else set.add(id);
      b.setAttribute('aria-pressed', String(set.has(id)));
      updateVerdict();
    }));
    updateVerdict();
  }

  function updateVerdict() {
    const L = state.league;
    const g = state.grader;
    const el = $('#verdict');
    if (!g.give.size || !g.get.size) {
      el.innerHTML = '<p class="empty">Pick at least one player on each side to grade the trade.</p>';
      return;
    }
    const r = Engine.gradeTrade(L, state.myTeamId, g.partnerId, [...g.give], [...g.get], state.mode);
    const { me, them } = r;
    const total = me.vIn + me.vOut || 1;
    const lineupChanges = (side) => {
      const before = new Set(side.before.starters.map((s) => s.id));
      const after = new Set(side.after.starters.map((s) => s.id));
      const added = [...after].filter((id) => id && !before.has(id));
      const lost = [...before].filter((id) => id && !after.has(id));
      return { added, lost };
    };
    const ch = lineupChanges(me);
    const LABEL = { value: 'Trade value', next: 'This week', ros: 'Rest of season', playoffs: 'Playoffs' };
    const lensCard = (k, x) => `<div class="lens"><div class="lens-head"><span>${LABEL[k]}</span><span class="lens-grade ${gradeClass(x.grade)}">${x.grade}</span></div>
      <div class="lens-val num">${k === 'value' ? `${me.net >= 0 ? '+' : '−'}${fmt(Math.abs(me.net))}` : `${signed(x.delta)} pts`}</div>
      <div class="lens-sub">${k === 'value' ? 'market value, after roster spots' : `${weekSpan(x.weeks)} · ${pts1(x.before)} → ${pts1(x.after)}`}</div></div>`;
    const lenses = Object.keys(me.lenses).length > 1
      ? `<div class="lenses">${['next', 'ros', 'playoffs', 'value'].filter((k) => me.lenses[k]).map((k) => lensCard(k, me.lenses[k])).join('')}</div>` : '';
    const tf = r.timeframes;
    const sched = tf && tf.playoffs.length ? scheduleTable([...g.give], [...g.get], tf) : '';
    el.innerHTML = `<div class="side-head"><h3 class="sec">Verdict</h3><div class="toolbar tight">${modeSelect('grader-mode')}</div></div>
      <div class="verdict">
        <div class="grade-card"><div class="grade ${gradeClass(me.grade)}">${me.grade}</div>
          <div><div class="who">You</div><div class="detail">${Object.keys(me.lenses).length > 1 ? `Overall grade, weighted for ${esc(Engine.MODES[state.mode].label.toLowerCase())}` : `Value ${me.net >= 0 ? '+' : ''}${fmt(me.net)} · Lineup ${pct(me.lineupPct)}`}</div></div></div>
        <div class="grade-card"><div class="grade ${gradeClass(them.grade)}">${them.grade}</div>
          <div><div class="who">${esc(them.team.name)}</div><div class="detail">${them.lenses.ros ? `Rest of season ${signed(them.lenses.ros.delta)} pts · ` : ''}Value ${them.net >= 0 ? '+' : ''}${fmt(them.net)}</div></div></div>
      </div>
      ${lenses}
      <div class="balance">
        <div class="balance-bar"><div class="in" style="width:${(me.vIn / total) * 100}%"></div><div class="out" style="width:${(me.vOut / total) * 100}%"></div></div>
        <div class="balance-labels"><span>You get <b class="num">${fmt(me.vIn)}</b></span><span>You give <b class="num">${fmt(me.vOut)}</b></span></div>
      </div>
      ${ch.added.length || ch.lost.length ? `<p class="detail" style="margin:10px 0 0">Your starting lineup:
        ${ch.added.map((id) => `<b>+ ${esc(P(id).name)}</b>`).join(', ')}${ch.added.length && ch.lost.length ? '; ' : ''}${ch.lost.map((id) => `− ${esc(P(id).name)}`).join(', ')}</p>` : ''}
      <ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      ${sched}`;
    bindMode(updateVerdict);
  }

  // Each player in the trade: rest-of-season average and their fantasy-playoff matchups.
  function scheduleTable(give, get, tf) {
    const L = state.league;
    const avg = (id) => {
      const ws = tf.ros.filter((w) => L.proj[w][id] && L.proj[w][id].pts);
      return ws.length ? ws.reduce((s, w) => s + L.proj[w][id].pts, 0) / ws.length : 0;
    };
    const cell = (id, w) => {
      const x = L.proj[w] && L.proj[w][id];
      if (!x || (!x.pts && !x.opp)) return '<td class="r muted">Bye</td>';
      return `<td class="r"><span class="muted">${esc(x.opp || '')}</span> <span class="num">${pts1(x.pts)}</span></td>`;
    };
    const tot = (id) => tf.playoffs.reduce((s, w) => s + ((L.proj[w][id] || {}).pts || 0), 0);
    const row = (id, side) => `<tr><td><span class="side-tag ${side}">${side === 'in' ? 'Get' : 'Send'}</span></td>
      <td>${posChip(P(id).pos)} ${esc(P(id).name)}</td><td class="r num">${pts1(avg(id))}</td>
      ${tf.playoffs.map((w) => cell(id, w)).join('')}<td class="r num"><b>${pts1(tot(id))}</b></td></tr>`;
    return `<h3 class="sec" style="margin-top:22px">Schedule</h3>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>Player</th><th class="r">Avg ${weekSpan(tf.ros)}</th>${tf.playoffs.map((w) => `<th class="r">Wk ${w}</th>`).join('')}<th class="r">Playoffs</th></tr></thead>
        <tbody>${get.map((id) => row(id, 'in')).join('')}${give.map((id) => row(id, 'out')).join('')}</tbody>
      </table></div>
      <p class="legend">Opponent and projected points for each fantasy-playoff week. Average is projected points per game for the rest of the season.</p>`;
  }

  // ---------- Trade finder ----------
  function renderFinder(v) {
    const L = state.league;
    const others = L.teams.filter((t) => t.id !== state.myTeamId);
    const shop = state.finderView === 'shop';
    const mineIds = myTeam().playerIds.filter((id) => Engine.POS.includes(P(id).pos)).sort((a, b) => V(b) - V(a));
    for (const id of [...state.shopBlock]) if (!mineIds.includes(id)) state.shopBlock.delete(id);
    v.innerHTML = `<div class="toolbar">
        <div class="chips" role="group" aria-label="Finder mode">
          <button type="button" class="chip" data-view="suggest" aria-pressed="${!shop}">Suggested trades</button>
          <button type="button" class="chip" data-view="shop" aria-pressed="${shop}">Shop my players</button>
        </div>
        <label class="field-inline" for="finder-partner">Trade partner</label>
        <select id="finder-partner"><option value="all">All teams</option>${others.map((t) => `<option value="${esc(t.id)}"${state.finderPartner === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        ${modeSelect('finder-mode')}
      </div>
      <div class="toolbar">
        <span class="field-inline">Positions you want</span>
        <div class="chips" role="group" aria-label="Positions you want back">
          <button type="button" class="chip" data-want="ALL" aria-pressed="${!state.wantPos.size}">Any</button>
          ${Engine.POS.map((p) => `<button type="button" class="chip" data-want="${p}" aria-pressed="${state.wantPos.has(p)}">${p}</button>`).join('')}
        </div>
      </div>
      ${shop ? `<div class="panel shop-panel">
          <div class="side-head"><h3 class="sec">Players you want to trade</h3><span class="muted" id="shop-total"></span></div>
          <p class="detail" style="margin:0 0 10px">Pick one or more players. You'll see the best packages each manager could offer for that group and would likely accept.</p>
          <div class="shop-picks">${mineIds.map((id) => `<button type="button" class="pick" data-shop="${esc(id)}" aria-pressed="${state.shopBlock.has(id)}">
            ${posChip(P(id).pos)}<span class="nm">${esc(P(id).name)}${injBadge(P(id).injury)}</span><span class="num muted">${fmt(V(id))}</span></button>`).join('')}</div>
        </div>` : `<p class="detail" style="margin:0 0 14px">Deals that improve your team and that the other manager has a reason to accept.</p>`}
      <div id="finder-results"></div>`;
    $('#finder-partner').addEventListener('change', (e) => { state.finderPartner = e.target.value; state.finderCache = null; renderFinder(v); });
    v.querySelectorAll('.chip[data-view]').forEach((c) => c.addEventListener('click', () => {
      state.finderView = c.dataset.view; state.finderCache = null; renderFinder(v);
    }));
    v.querySelectorAll('.chip[data-want]').forEach((c) => c.addEventListener('click', () => {
      const p = c.dataset.want;
      if (p === 'ALL') state.wantPos.clear();
      else if (state.wantPos.has(p)) state.wantPos.delete(p);
      else state.wantPos.add(p);
      if (state.wantPos.size === Engine.POS.length) state.wantPos.clear();
      v.querySelectorAll('.chip[data-want]').forEach((x) => x.setAttribute('aria-pressed',
        String(x.dataset.want === 'ALL' ? !state.wantPos.size : state.wantPos.has(x.dataset.want))));
      state.finderCache = null;
      runFinder();
    }));
    v.querySelectorAll('[data-shop]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.shop;
      if (state.shopBlock.has(id)) state.shopBlock.delete(id); else state.shopBlock.add(id);
      b.setAttribute('aria-pressed', String(state.shopBlock.has(id)));
      state.finderCache = null;
      runFinder();
    }));
    bindMode(() => renderFinder(v));
    runFinder();
  }

  let finderTimer = null;
  function runFinder() {
    const L = state.league;
    const out = $('#finder-results');
    if (!out) return;
    const shop = state.finderView === 'shop';
    const block = [...state.shopBlock];
    const total = $('#shop-total');
    if (total) total.textContent = block.length ? `${block.length} selected · value ${fmt(block.reduce((s, id) => s + V(id), 0))}` : '';
    if (shop && !block.length) { out.innerHTML = '<p class="empty">Pick the players you want to trade to see offers.</p>'; return; }
    out.innerHTML = `<p class="loading">${shop ? 'Building offers from every roster…' : 'Scanning every roster…'}</p>`;
    clearTimeout(finderTimer);
    finderTimer = setTimeout(() => {
      const wantPos = [...state.wantPos];
      const key = `${state.myTeamId}|${state.finderPartner}|${state.mode}|${state.finderView}|${block.join(',')}|${wantPos.join(',')}`;
      if (!state.finderCache || state.finderCache.key !== key) {
        let trades;
        if (shop) {
          trades = Engine.findOffers(L, state.myTeamId, block, { mode: state.mode, wantPos, limit: 40, perTeam: state.finderPartner === 'all' ? 2 : 6 });
          if (state.finderPartner !== 'all') trades = trades.filter((t) => t.partner.id === state.finderPartner);
          trades = trades.slice(0, 15);
        } else {
          const opts = state.finderPartner === 'all' ? { limit: 12, mode: state.mode, wantPos } : { partnerId: state.finderPartner, limit: 9, mode: state.mode, wantPos };
          trades = Engine.findTrades(L, state.myTeamId, opts);
        }
        state.finderCache = { key, trades };
      }
      renderTradeCards(out, state.finderCache.trades, shop);
    }, 30);
  }

  function renderTradeCards(out, trades, shop) {
    if (!trades.length) {
      out.innerHTML = `<p class="empty">${shop
        ? `No manager has a package that matches this group${state.wantPos.size ? ' at ' + [...state.wantPos].join('/') : ''}. Try adding or removing a player, another position, or another trade partner.`
        : `No trades found that help both sides${state.wantPos.size ? ' at ' + [...state.wantPos].join('/') : ''}. Try another position or partner, or check back after values move.`}</p>`;
      return;
    }
    const plist = (ids) => `<ul class="plist">${ids.map((id) => `<li>${posChip(P(id).pos)}<span class="nm">${esc(P(id).name)}${injBadge(P(id).injury)}</span><span class="num muted">${fmt(V(id))}</span></li>`).join('')}</ul>`;
    out.innerHTML = `<div class="cards">${trades.map((t, i) => `<article class="panel trade-card">
        <div class="trade-top"><span class="partner">${esc(t.partner.name)}</span>
          <span class="mini-grades"><span class="${gradeClass(t.me.grade)}" title="Your grade">You ${t.me.grade}</span><span class="${gradeClass(t.them.grade)}" title="Their grade">Them ${t.them.grade}</span></span></div>
        <div class="swap"><div><h4>You send</h4>${plist(t.give)}</div><div><h4>${shop ? 'They offer' : 'You get'}</h4>${plist(t.get)}</div></div>
        <p class="why">${t.me.lenses.ros
          ? `This week ${signed(t.me.lenses.next.delta)} · Rest of season ${signed(t.me.lenses.ros.delta)}${t.me.lenses.playoffs ? ` · Playoffs ${signed(t.me.lenses.playoffs.delta)}` : ''} pts. `
          : `Your lineup ${pct(t.me.lineupPct)}, theirs ${pct(t.them.lineupPct)}. `}${esc(t.notes.find((n) => /starting|consolidate|receive more/.test(n)) || '')}</p>
        <button class="btn ghost small" type="button" data-open="${i}">Open in grader</button>
      </article>`).join('')}</div>`;
    out.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
      const t = trades[Number(b.dataset.open)];
      state.grader = { partnerId: t.partner.id, give: new Set(t.give), get: new Set(t.get) };
      selectTab('grader');
    }));
  }

  // ---------- Waivers ----------
  function renderWaivers() {
    const L = state.league;
    const w = Engine.recommendWaivers(L, state.myTeamId, { limit: 40 });
    const n = L.teams.length;
    const filtered = w.picks.filter((p) => state.waiverPos === 'ALL' || P(p.id).pos === state.waiverPos);
    const tierCls = { 'Priority add': 'priority', 'Strong add': 'strong', 'Depth add': 'depth', Stash: 'stash' };
    const bid = (b) => {
      if (b.dollars) return `$${b.dollars[0]}–${b.dollars[1]}`;
      return `${b.pct[0]}–${b.pct[1]}%`;
    };
    const extra = (id) => {
      if (L.trending[id]) return `${Engine.compact(L.trending[id])} adds`;
      if (L.ownership[id] != null) return `${L.ownership[id].toFixed(1)}% rostered`;
      return '';
    };
    const rows = filtered.map((p, i) => `<div class="wrow">
      <span class="num muted wrank">${i + 1}</span>
      ${posChip(P(p.id).pos)}
      <div class="wmain"><b>${esc(P(p.id).name)}</b>${injBadge(P(p.id).injury)} <span class="muted">${esc(P(p.id).team || '')}</span>
        <div class="reasons">${esc(p.reasons.join(' · '))}</div></div>
      <div class="wstats">
        <span class="tier ${tierCls[p.tier]}">${esc(p.tier)}</span>
        <span class="wstat"><small>Gain</small><span class="num gain ${p.gain > 0 ? 'pos-gain' : ''}">${pct(p.gainPct)}</span></span>
        <span class="wstat"><small>Drop</small>${p.drop ? esc(P(p.drop).name) : '<span class="muted">Open spot</span>'}</span>
        <span class="wstat"><small>${L.faab ? 'Bid' : 'Priority'}</small><span class="num">${L.faab ? bid(p.bid) : (p.tier === 'Priority add' ? 'High' : p.tier === 'Strong add' ? 'Medium' : 'Low')}</span></span>
        ${extra(p.id) ? `<span class="wstat"><small>Buzz</small>${esc(extra(p.id))}</span>` : ''}
      </div>
    </div>`).join('');
    const remain = L.faab ? `FAAB left: <b class="num">$${L.faab.remaining}</b> of $${L.faab.budget}` : 'Rolling waivers';
    return `<div class="needs">${Engine.POS.map((pos) => {
        const r = w.ranks[pos];
        return `<div class="need${r.rank > (2 * n) / 3 ? ' weak' : ''}">${posChip(pos)} <span>Your room: <b>${Engine.ordinal(r.rank)}</b> of ${n}</span></div>`;
      }).join('')}<div class="need">${remain}</div></div>
      <div class="toolbar"><div class="chips" role="group" aria-label="Filter by position">
        ${['ALL', ...Engine.POS].map((pos) => `<button type="button" class="chip" data-pos="${pos}" aria-pressed="${state.waiverPos === pos}">${pos === 'ALL' ? 'All' : pos}</button>`).join('')}
      </div><span class="muted" style="font-size:13px">Gain = how much your best lineup and bench improve after the add and drop, with injured players discounted for this week.</span></div>
      <div class="panel wlist">${filtered.length ? rows : '<p class="empty">No free agents at this position would improve your team.</p>'}</div>`;
  }

  function bindWaivers() {
    document.querySelectorAll('.chip[data-pos]').forEach((c) => c.addEventListener('click', () => {
      state.waiverPos = c.dataset.pos;
      render();
    }));
  }

  // ---------- Boot ----------
  $('#espn-season').value = currentSeasonGuess();
  const su = store.get('sleeperUser');
  if (su) $('#sleeper-user').value = su;
  const last = store.get('last');
  if (last && last.platform === 'espn') {
    $('#espn-league').value = last.leagueId || '';
    if (last.s2) { $('#espn-s2').value = last.s2; $('#espn-swid').value = last.swid || ''; $('#espn-remember').checked = true; }
  }
})();
