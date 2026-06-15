// netlify/functions/team-stats.js
// Fetches real team statistics for a given match from API-Football.
// Returns: avg goals scored/conceded, form (last 5), clean sheets, etc.

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
  const season   = params.season || new Date().getFullYear();

  if (!homeId || !awayId || !leagueId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing homeId, awayId, or leagueId." }) };
  }

  function parseStats(data) {
    if (!data.response) return null;
    const s = data.response;

    // Goals scored/conceded per game
    const gf = s.goals?.for?.average?.total;
    const ga = s.goals?.against?.average?.total;

    // Form string e.g. "WWDLW"
    const form = s.form || "";
    const last5 = form.slice(-5);

    // Clean sheets
    const cs = s.clean_sheet?.total ?? null;

    // Wins/draws/losses
    const wins   = s.fixtures?.wins?.total   ?? 0;
    const draws  = s.fixtures?.draws?.total  ?? 0;
    const losses = s.fixtures?.loses?.total  ?? 0;
    const played = s.fixtures?.played?.total ?? 0;

    return {
      goalsScored:    gf ? parseFloat(gf) : null,
      goalsConceded:  ga ? parseFloat(ga) : null,
      form:           last5,
      cleanSheets:    cs,
      wins, draws, losses, played,
    };
  }

  try {
    // Fetch both teams in parallel
    const [homeData, awayData] = await Promise.all([
      api(`/teams/statistics?team=${homeId}&league=${leagueId}&season=${season}`),
      api(`/teams/statistics?team=${awayId}&league=${leagueId}&season=${season}`),
    ]);

    const home = parseStats(homeData);
    const away = parseStats(awayData);

    // If season data missing, try previous season
    let homeFinal = home;
    let awayFinal = away;

    if (!home || home.played === 0) {
      const prevSeason = parseInt(season) - 1;
      const fallback = await api(`/teams/statistics?team=${homeId}&league=${leagueId}&season=${prevSeason}`);
      homeFinal = parseStats(fallback) || home;
    }
    if (!away || away.played === 0) {
      const prevSeason = parseInt(season) - 1;
      const fallback = await api(`/teams/statistics?team=${awayId}&league=${leagueId}&season=${prevSeason}`);
      awayFinal = parseStats(fallback) || away;
    }

    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=3600" },
      body: JSON.stringify({ home: homeFinal, away: awayFinal }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
