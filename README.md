# Gridiron GM

A fantasy football assistant for **Sleeper** and **ESPN** leagues:

- **My team**: best lineup by trade value, positional strength vs. the rest of your league, power rankings.
- **Trade grader**: pick players on both sides and get a letter grade for you *and* your trade partner, based on trade value, the roster spot you gain or lose, and how each starting lineup changes.
- **Trade finder**: scans every roster for 1-for-1, 2-for-1, 1-for-2 and 2-for-2 deals that improve your lineup and that the other manager also has a reason to accept.
- **Lineup**: your best projected lineup for any week through the fantasy playoffs, with matchups, byes and injury designations, plus exactly who to put in and take out compared with the lineup you have set.
- **Trade grades by timeframe**: every trade is graded for this week, the rest of the season, your fantasy-playoff weeks and long-term trade value. Pick what you're playing for (Balanced, Win this week, Playoff push, Long term) and the overall grade weights those views to match. The grader also shows each player's playoff matchups.
- **Waivers**: ranks free agents by how much they improve your lineup this week (injured starters are discounted), suggests who to drop, and gives a FAAB bid range.

## Run it

Needs Node.js 18 or newer. No `npm install`.

```bash
cd gridiron-gm
npm start          # or: node server.js
```

Open http://localhost:3000.

- **Sleeper**: enter your username and pick a league.
- **ESPN**: enter the league ID (the `leagueId=` number in the league URL). Private leagues need your `espn_s2` and `SWID` cookies from fantasy.espn.com (Developer tools → Application → Cookies). They are only sent from your computer to ESPN.
- **Demo**: a built-in 10-team league with illustrative values, no account needed.

## Where the data comes from

| Data | Source |
| --- | --- |
| Sleeper leagues, rosters, players, trending adds | `api.sleeper.app` (public) |
| ESPN leagues, rosters, free agents, % rostered | `lm-api-reads.fantasy.espn.com` (unofficial) |
| Trade values (redraft or dynasty, 1QB or superflex, PPR setting, league size) | FantasyCalc `api.fantasycalc.com` |
| Weekly projections, opponents, byes | Sleeper weekly projections (`api.sleeper.com`), scored with your league's settings |
| Fallback values if FantasyCalc is down | Sleeper season projections, converted to value over replacement |

The local server (`server.js`) proxies these so the browser doesn't run into CORS limits. Responses are cached briefly; the Sleeper player list is cached in `.cache/` for 12 hours.

Kickers and defenses have no trade value and are left out of the analysis.

## How grading works

For each side: `net value = value received − value sent − (extra players received × replacement value)`, where replacement value is roughly what the best waiver-wire player is worth. That is blended with the change in the team's best-lineup score (starters plus a weighted bench). Grade bands run A+ to F.

## Tests

```bash
npm test
```
