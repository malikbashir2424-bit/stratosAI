// netlify/functions/team-stats.js
// Gets real team stats from last 10 matches - works for all teams including national teams

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
  const homeId = params.homeId;
  const awayId = params.awayId;

  if (!homeId || !awayId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing homeId or awayId." }) };
  }

  async function getStatsFromMatches(teamId) {
    try {
      const data = await api(`/fixtures?team=${teamId}&last=10&status=FT`);
      if (!data.response || data.response.length === 0) return null;

      let gf = 0, ga = 0, count = 0;
      let wins = 0, draws = 0, losses = 0;
      let formArr = [];
      let cleanSheets = 0;

      data.response.forEach(m => {
        const isHome = m.teams.home.id == teamId;
        const scored   = isHome ? m.goals.home : m.goals.away;
        const conceded = isHome ? m.goals.away : m.goals.home;

        if (scored === null || conceded === null) return;

        gf += scored;
        ga += conceded;
        count++;

        if (conceded === 0) cleanSheets++;

        if (scored > conceded) { wins++; formArr.push('W'); }
        else if (scored === conceded) { draws++; formArr.push('D'); }
        else { losses++; formArr.push('L'); }
      });

      if (count === 0) return null;

      return {
        goalsScored:   parseFloat((gf / count).toFixed(2)),
        goalsConceded: parseFloat((ga / count).toFixed(2)),
        form:          formArr.slice(0, 5).join(''),
        cleanSheets,
        wins, draws, losses, played: count,
      };
    } catch(e) {
      return null;
    }
  }

  try {
    const [homeStats, awayStats] = await Promise.all([
      getStatsFromMatches(homeId),
      getStatsFromMatches(awayId),
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
