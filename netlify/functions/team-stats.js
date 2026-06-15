// netlify/functions/team-stats.js
exports.handler = async function (event) {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const BASE = "https://v3.football.api-sports.io";

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing API key." }) };
  }

  const apiHeaders = { "x-apisports-key": API_KEY };

  async function api(path) {
    const res = await fetch(BASE + path, { headers: apiHeaders });
    if (!res.ok) throw new Error("API failed: " + res.status);
    return res.json();
  }

  const params = event.queryStringParameters || {};
  const homeId   = params.homeId;
  const awayId   = params.awayId;
  const leagueId = params.leagueId;

  if (!homeId || !awayId || !leagueId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing params." }) };
  }

  function parseStats(data) {
    if (!data || !data.response) return null;
    const s = data.response;
    const gf     = s.goals?.for?.average?.total;
    const ga     = s.goals?.against?.average?.total;
    const form   = (s.form || "").slice(-5);
    const cs     = s.clean_sheet?.total ?? null;
    const wins   = s.fixtures?.wins?.total   ?? 0;
    const draws  = s.fixtures?.draws?.total  ?? 0;
    const losses = s.fixtures?.loses?.total  ?? 0;
    const played = s.fixtures?.played?.total ?? 0;
    if (played === 0) return null;
    return {
      goalsScored:   gf ? parseFloat(gf) : null,
      goalsConceded: ga ? parseFloat(ga) : null,
      form, cleanSheets: cs,
      wins, draws, losses, played,
    };
  }

  // Try to get stats for a team across multiple leagues/seasons
  async function getBestStats(teamId, primaryLeagueId) {
    const currentYear = new Date().getFullYear();

    // 1) Try primary league, current and previous seasons
    for (const season of [currentYear, currentYear - 1]) {
      try {
        const data = await api(`/teams/statistics?team=${teamId}&league=${primaryLeagueId}&season=${season}`);
        const stats = parseStats(data);
        if (stats) return { ...stats, source: `League ${primaryLeagueId} ${season}` };
      } catch(e) {}
    }

    // 2) Get all leagues this team played in recently
    try {
      const leaguesData = await api(`/leagues?team=${teamId}&season=${currentYear - 1}`);
      if (leaguesData.response && leaguesData.response.length) {
        // Try top leagues first (prioritize by type)
        const sorted = leaguesData.response.sort((a, b) => {
          const order = { 'League': 0, 'Cup': 1, 'Friendly': 2 };
          return (order[a.league.type] ?? 3) - (order[b.league.type] ?? 3);
        });
        for (const entry of sorted.slice(0, 5)) {
          try {
            const data = await api(`/teams/statistics?team=${teamId}&league=${entry.league.id}&season=${currentYear - 1}`);
            const stats = parseStats(data);
            if (stats) return { ...stats, source: `${entry.league.name} ${currentYear - 1}` };
          } catch(e) {}
        }
      }
    } catch(e) {}

    // 3) Try last 5 matches directly
    try {
      const matches = await api(`/fixtures?team=${teamId}&last=10&status=FT`);
      if (matches.response && matches.response.length) {
        let gf = 0, ga = 0, count = 0;
        let formArr = [];
        matches.response.forEach(m => {
          const isHome = m.teams.home.id == teamId;
          const scored    = isHome ? m.goals.home : m.goals.away;
          const conceded  = isHome ? m.goals.away : m.goals.home;
          if (scored !== null && conceded !== null) {
            gf += scored; ga += conceded; count++;
            formArr.push(scored > conceded ? 'W' : scored === conceded ? 'D' : 'L');
          }
        });
        if (count > 0) {
          return {
            goalsScored:   parseFloat((gf / count).toFixed(2)),
            goalsConceded: parseFloat((ga / count).toFixed(2)),
            form: formArr.slice(0, 5).join(''),
            cleanSheets: null,
            wins: formArr.filter(r=>r==='W').length,
            draws: formArr.filter(r=>r==='D').length,
            losses: formArr.filter(r=>r==='L').length,
            played: count,
            source: 'Last ' + count + ' matches'
          };
        }
      }
    } catch(e) {}

    return null;
  }

  try {
    const [homeStats, awayStats] = await Promise.all([
      getBestStats(homeId, leagueId),
      getBestStats(awayId, leagueId),
    ]);

    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=3600" },
      body: JSON.stringify({ home: homeStats, away: awayStats }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
