// Demo league: 10 teams, half-PPR, made-up managers and approximate values.
// Lets you try every feature without connecting an account.
(function (root) {
  // Rough overall order. Values come from rank, so they are illustrative, not live.
  const BOARD = `Ja'Marr Chase,WR,CIN|Bijan Robinson,RB,ATL|Jahmyr Gibbs,RB,DET|Justin Jefferson,WR,MIN|CeeDee Lamb,WR,DAL|Puka Nacua,WR,LAR|Saquon Barkley,RB,PHI|Malik Nabers,WR,NYG|Christian McCaffrey,RB,SF|Amon-Ra St. Brown,WR,DET|Ashton Jeanty,RB,LV|De'Von Achane,RB,MIA|Jaxon Smith-Njigba,WR,SEA|Nico Collins,WR,HOU|Brian Thomas Jr.,WR,JAX|Derrick Henry,RB,BAL|Brock Bowers,TE,LV|Jonathan Taylor,RB,IND|Josh Allen,QB,BUF|Lamar Jackson,QB,BAL|A.J. Brown,WR,PHI|Drake London,WR,ATL|Trey McBride,TE,ARI|Bucky Irving,RB,TB|James Cook,RB,BUF|Josh Jacobs,RB,GB|Ladd McConkey,WR,LAC|Jayden Daniels,QB,WAS|Jalen Hurts,QB,PHI|Kyren Williams,RB,LAR|Chase Brown,RB,CIN|Tee Higgins,WR,CIN|Garrett Wilson,WR,NYJ|Omarion Hampton,RB,LAC|George Kittle,TE,SF|Tetairoa McMillan,WR,CAR|Joe Burrow,QB,CIN|Breece Hall,RB,NYJ|Zay Flowers,WR,BAL|Terry McLaurin,WR,WAS|Mike Evans,WR,TB|Emeka Egbuka,WR,TB|Kenneth Walker III,RB,KC|Davante Adams,WR,LAR|Rashee Rice,WR,KC|Alvin Kamara,RB,NO|TreVeyon Henderson,RB,NE|Marvin Harrison Jr.,WR,ARI|Sam LaPorta,TE,DET|Patrick Mahomes,QB,KC|Jameson Williams,WR,DET|George Pickens,WR,DAL|DK Metcalf,WR,PIT|Tyler Warren,TE,IND|Chuba Hubbard,RB,CAR|Quinshon Judkins,RB,CLE|DJ Moore,WR,BUF|Xavier Worthy,WR,KC|James Conner,RB,ARI|Tucker Kraft,TE,GB|Baker Mayfield,QB,TB|Courtland Sutton,WR,DEN|Jaylen Waddle,WR,DEN|Drake Maye,QB,NE|RJ Harvey,RB,DEN|Bo Nix,QB,DEN|David Montgomery,RB,HOU|D'Andre Swift,RB,CHI|Rome Odunze,WR,CHI|Chris Olave,WR,NO|T.J. Hockenson,TE,MIN|Travis Kelce,TE,KC|Jordan Addison,WR,MIN|Kyle Monangai,RB,CHI|Calvin Ridley,WR,TEN|Javonte Williams,RB,DAL|Justin Herbert,QB,LAC|Caleb Williams,QB,CHI|Khalil Shakir,WR,BUF|Jakobi Meyers,WR,JAX|Mark Andrews,TE,BAL|Kaleb Johnson,RB,PIT|Jaylen Warren,RB,PIT|Travis Hunter,WR,JAX|Tony Pollard,RB,TEN|Colston Loveland,TE,CHI|Jake Ferguson,TE,DAL|Michael Pittman Jr.,WR,IND|Jerry Jeudy,WR,CLE|Kyler Murray,QB,ARI|Dak Prescott,QB,DAL|Isiah Pacheco,RB,DET|Rhamondre Stevenson,RB,NE|Josh Downs,WR,IND|Wan'Dale Robinson,WR,TEN|Jared Goff,QB,DET|Zach Charbonnet,RB,SEA|Tyrone Tracy Jr.,RB,NYG|Dalton Kincaid,TE,BUF|Brock Purdy,QB,SF|Ricky Pearsall,WR,SF|Matthew Golden,WR,GB|Jayden Reed,WR,GB|Bhayshul Tuten,RB,JAX|Woody Marks,RB,HOU|Rashid Shaheed,WR,SEA|David Njoku,TE,LAC|Kyle Pitts,TE,ATL|Jordan Mason,RB,MIN|Quentin Johnston,WR,LAC|Troy Franklin,WR,DEN|Hunter Henry,TE,NE|Jaydon Blue,RB,DAL|Cam Skattebo,RB,NYG|Trevor Lawrence,QB,JAX|C.J. Stroud,QB,HOU|Jordan Love,QB,GB|Rachaad White,RB,WAS|Ray Davis,RB,BUF|Tank Bigsby,RB,PHI|Juwan Johnson,TE,NO|Harold Fannin Jr.,TE,CLE|Keon Coleman,WR,BUF|Romeo Doubs,WR,NE|Stefon Diggs,WR,NE|Deebo Samuel,WR,WAS|Chris Godwin,WR,TB|Cooper Kupp,WR,SEA|Christian Kirk,WR,HOU|Darnell Mooney,WR,ATL|Jalen McMillan,WR,TB|Dallas Goedert,TE,PHI|Evan Engram,TE,DEN|Mason Taylor,TE,NYJ|Oronde Gadsden,TE,LAC|Zach Ertz,TE,WAS|Jonnu Smith,TE,PIT|J.J. McCarthy,QB,MIN|Cam Ward,QB,TEN|Aaron Jones,RB,MIN|Tyjae Spears,RB,TEN|Braelon Allen,RB,NYJ|Kendre Miller,RB,NO|Jacory Croskey-Merritt,RB,WAS|Blake Corum,RB,LAR|Devin Neal,RB,NO|Dylan Sampson,RB,CLE|Tre Tucker,WR,LV|Jauan Jennings,WR,SF|Alec Pierce,WR,IND|Marquise Brown,WR,KC|Jalen Coker,WR,CAR|Adam Thielen,WR,CAR|Theo Johnson,TE,NYG|Brenton Strange,TE,JAX|AJ Barner,TE,SEA|Pat Freiermuth,TE,PIT|Geno Smith,QB,LV|Matthew Stafford,QB,LAR|Tua Tagovailoa,QB,MIA|Daniel Jones,QB,IND`;

  const OWNERS = [
    ['You', 'Fourth & Forever'], ['Marisol', 'Blitz Krieg'], ['Dev', 'Hail Murray'], ['Jordan', 'Waiver Wire Warriors'],
    ['Priya', 'Mixon It Up'], ['Theo', 'Kamara Shy'], ['Sam', 'Lamb Chops'], ['Ana', 'Purdy Good'],
    ['Kofi', 'Burrow Under'], ['Riley', 'Pitts Stop'],
  ];

  function build() {
    const players = {};
    const values = {};
    const order = BOARD.split('|').map((s, i) => {
      const [name, pos, team] = s.split(',');
      const id = 'd' + i;
      players[id] = { id, name, pos, team, injury: null };
      values[id] = Math.round(10200 * Math.exp(-i / 42) + 60);
      return id;
    });
    // A couple of injuries so the waiver tab has something to react to.
    const byName = (n) => order.find((id) => players[id].name === n);
    players[byName('Mark Andrews')].injury = 'Out';
    players[byName('Rashee Rice')].injury = 'Questionable';
    players[byName('Breece Hall')].injury = 'IR';
    players[byName('Evan Engram')].injury = 'Out';
    players[byName('RJ Harvey')].injury = 'Doubtful';

    const teams = OWNERS.map(([owner, name], i) => ({ id: String(i + 1), name, owner, playerIds: [] }));
    // Snake draft with position caps. "You" draft RB-heavy and skip TE, so the tools have work to do.
    const caps = { QB: 2, RB: 5, WR: 6, TE: 2 };
    const myCaps = { QB: 2, RB: 7, WR: 5, TE: 1 };
    const pool = [...order];
    const rounds = 14;
    for (let r = 0; r < rounds; r++) {
      const seq = r % 2 ? [...teams].reverse() : teams;
      for (const t of seq) {
        const c = t.id === '1' ? myCaps : caps;
        const count = (pos) => t.playerIds.filter((id) => players[id].pos === pos).length;
        let pickIdx = pool.findIndex((id) => {
          const pos = players[id].pos;
          if (count(pos) >= c[pos]) return false;
          if (t.id === '1' && pos === 'TE' && r < 11) return false;
          if (pos === 'QB' && count('QB') === 1 && r < 9) return false;
          return true;
        });
        if (pickIdx < 0) pickIdx = 0;
        t.playerIds.push(pool.splice(pickIdx, 1)[0]);
      }
    }
    // "Your" saved lineup: the obvious starters by draft order, injuries ignored, so the Lineup tab has fixes to suggest.
    const firstN = (pos, n) => teams[0].playerIds.filter((id) => players[id].pos === pos).slice(0, n);
    const wrs = firstN('WR', 3);
    teams[0].starters = [...firstN('QB', 1), ...firstN('RB', 2), ...wrs, ...firstN('TE', 1)];
    const trending = {};
    pool.slice(0, 12).forEach((id, i) => { trending[id] = Math.round(42000 / (i + 1.6)); });
    // Seeded schedule (opponents, byes, defense strength) so weekly projections vary like real ones.
    const NFL = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
      'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const defense = {};
    NFL.forEach((t) => { defense[t] = 0.82 + rnd() * 0.36; });
    const bye = {};
    NFL.forEach((t, i) => { bye[t] = 5 + (i % 10); });
    const opp = (team, w) => {
      const i = NFL.indexOf(team);
      let j = (i + w * 7 + 3) % NFL.length;
      if (j === i) j = (j + 1) % NFL.length;
      return NFL[j];
    };
    const BASE = { QB: [13, 12], RB: [5, 15], WR: [5, 14], TE: [3.5, 11] };
    const week = 8;
    const proj = {};
    for (let w = week; w <= 17; w++) {
      proj[w] = {};
      for (const id of order) {
        const p = players[id];
        if (bye[p.team] === w) continue;
        const [b, k] = BASE[p.pos];
        const o = opp(p.team, w);
        const ppg = (b + k * Math.pow(values[id] / 10000, 0.7)) * defense[o] * (0.93 + rnd() * 0.14);
        proj[w][id] = { pts: Math.round(ppg * 10) / 10, opp: o };
      }
    }
    return {
      platform: 'demo', id: 'demo', name: 'Demo League', season: 2026, numTeams: 10, ppr: 0.5, numQbs: 1, isDynasty: false,
      slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 7 },
      teams, players, values, freeAgentIds: pool, trending, ownership: {}, faab: { budget: 100, remaining: 64 },
      myTeamId: '1', valueSource: 'Demo values and projections (illustrative)',
      week, playoffWeeks: [15, 16, 17], lastWeek: 17, proj,
    };
  }

  const Demo = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = Demo;
  else root.Demo = Demo;
})(typeof self !== 'undefined' ? self : this);
