// Gridiron GM local server. Serves the app and proxies the fantasy APIs so the browser
// doesn't hit CORS limits and ESPN private-league cookies never leave your machine.
// Requires Node 18+ (built-in fetch). No npm install needed.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, '.cache');
const POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

const memo = new Map();
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await fn();
  memo.set(key, { at: Date.now(), data });
  return data;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': 'gridiron-gm/1.0', accept: 'application/json', ...headers } });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${res.status} from ${new URL(url).host}`);
    err.status = res.status;
    err.body = text.slice(0, 300);
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// Sleeper's full player list is ~5MB, so keep a slim copy on disk for 12 hours.
async function sleeperPlayers() {
  return cached('sleeper-players', 12 * 3600e3, async () => {
    const file = path.join(CACHE_DIR, 'sleeper-players.json');
    try {
      const st = fs.statSync(file);
      if (Date.now() - st.mtimeMs < 12 * 3600e3) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    const raw = await getJson('https://api.sleeper.app/v1/players/nfl');
    const slim = {};
    for (const [id, p] of Object.entries(raw)) {
      const pos = p.position === 'DEF' ? 'DEF' : (p.fantasy_positions || [])[0] || p.position;
      if (!POS.has(pos)) continue;
      if (pos !== 'DEF' && !p.active) continue;
      slim[id] = {
        id,
        name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
        pos,
        team: p.team || null,
        injury: p.injury_status || null,
        age: p.age || null,
      };
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(slim));
    return slim;
  });
}

async function handleApi(url, req) {
  const q = url.searchParams;
  const p = url.pathname;

  if (p === '/api/sleeper-players') return sleeperPlayers();

  if (p.startsWith('/api/sleeper/')) {
    const rest = p.slice('/api/sleeper/'.length);
    if (!/^[\w\-/]+$/.test(rest)) throw Object.assign(new Error('Bad Sleeper path'), { status: 400 });
    const target = `https://api.sleeper.app/v1/${rest}${url.search}`;
    return cached(target, 60e3, () => getJson(target));
  }

  if (p === '/api/values') {
    const params = new URLSearchParams({
      isDynasty: q.get('isDynasty') === 'true' ? 'true' : 'false',
      numQbs: q.get('numQbs') === '2' ? '2' : '1',
      numTeams: String(Math.min(32, Math.max(4, Number(q.get('numTeams')) || 12))),
      ppr: ['0', '0.5', '1'].includes(q.get('ppr')) ? q.get('ppr') : '1',
    });
    const target = `https://api.fantasycalc.com/values/current?${params}`;
    return cached(target, 3600e3, () => getJson(target));
  }

  // Sleeper projections, season-long or for one week, trimmed to what the app uses.
  if (p === '/api/projections') {
    const season = Number(q.get('season')) || new Date().getFullYear();
    const week = Number(q.get('week'));
    const pos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((x) => `position[]=${x}`).join('&');
    const target = `https://api.sleeper.com/projections/nfl/${season}${week ? '/' + week : ''}?season_type=regular&${pos}&order_by=pts_ppr`;
    return cached(target, 3 * 3600e3, async () => {
      const rows = await getJson(target);
      return (rows || []).map((r) => {
        const pl = r.player || {};
        const stats = {};
        for (const [k, v] of Object.entries(r.stats || {})) if (typeof v === 'number' && !k.startsWith('adp')) stats[k] = v;
        return {
          id: String(r.player_id), name: `${pl.first_name || ''} ${pl.last_name || ''}`.trim(), pos: pl.position,
          team: r.team || pl.team || null, opp: r.opponent || null, stats,
        };
      });
    });
  }

  if (p === '/api/espn') {
    const season = Number(q.get('season'));
    const leagueId = q.get('leagueId');
    if (!season || !/^\d+$/.test(leagueId || '')) throw Object.assign(new Error('League ID must be a number'), { status: 400 });
    const views = (q.get('views') || 'mTeam,mRoster,mSettings').split(',').filter((v) => /^\w+$/.test(v));
    const target = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?`
      + views.map((v) => `view=${v}`).join('&');
    const headers = {};
    const s2 = req.headers['x-espn-s2'];
    let swid = req.headers['x-espn-swid'];
    if (s2 && swid) {
      swid = swid.trim();
      if (!swid.startsWith('{')) swid = `{${swid}}`;
      headers.cookie = `espn_s2=${s2.trim()}; SWID=${swid}`;
    }
    if (q.get('filter')) headers['x-fantasy-filter'] = q.get('filter');
    try {
      return await getJson(target, headers);
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        e.message = 'ESPN says this league is private. Add your espn_s2 and SWID cookies.';
      } else if (e.status === 404) {
        e.message = 'ESPN could not find that league for that season.';
      }
      throw e;
    }
  }

  throw Object.assign(new Error('Not found'), { status: 404 });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      const data = await handleApi(url, req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      if (!e.status) e.message = `This computer couldn't reach the data service (${e.cause && e.cause.code || e.message}). A firewall, antivirus or school/work network may be blocking it.`;
      const status = e.status && e.status < 600 ? e.status : 502;
      console.error(`[api] ${url.pathname}: ${e.message}`);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

process.on('uncaughtException', (e) => console.error('[error]', e));
process.on('unhandledRejection', (e) => console.error('[error]', e));

server.listen(PORT, () => console.log(`Gridiron GM running at http://localhost:${PORT}`));
