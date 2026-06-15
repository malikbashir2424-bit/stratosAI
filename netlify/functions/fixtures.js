// netlify/functions/fixtures.js
// Secure middleman: fetches upcoming football fixtures from API-Football.

exports.handler = async function (event) {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const BASE = "https://v3.football.api-sports.io";

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing API key on server." }) };
  }

  const apiHeaders = { "x-apisports-key": API_KEY };

  async function api(path) {
    const res = await fetch(BASE + path, { headers: apiHeaders });
    if (!res.ok) throw new Error("API request failed: " + res.status);
    return res.json();
  }

  try {
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    const from = fmt(today);
    const to = fmt(new Date(today.getTime() + 5 * 86400000)); // next 5 days

    // Try both current year and previous year as season
    const currentYear = today.getFullYear();
    const seasons = [currentYear, currentYear - 1];

    // Popular leagues: 39=EPL, 140=La Liga, 135=Serie A, 78=Bundesliga, 61=Ligue 1, 2=UCL
    // Also add World Cup leagues: 1=World Cup
    const leagues = [1, 39, 140, 135, 78, 61, 2];

    let fixtures = [];

    for (const season of seasons) {
      for (const lg of leagues) {
        try {
          const data = await api(`/fixtures?league=${lg}&season=${season}&from=${from}&to=${to}&status=NS`);
          if (data.response && data.response.length) {
            fixtures = fixtures.concat(data.response);
          }
        } catch (e) {
          // skip failed league
        }
        if (fixtures.length >= 16) break;
      }
      if (fixtures.length >= 16) break;
    }

    // Remove duplicates by fixture id
    const seen = new Set();
    fixtures = fixtures.filter(f => {
      if (seen.has(f.fixture.id)) return false;
      seen.add(f.fixture.id);
      return true;
    });

    // Sort by kickoff, keep soonest 10
    fixtures.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
    fixtures = fixtures.slice(0, 10);

    const matches = fixtures.map((f) => ({
      id: f.fixture.id,
      kickoff: f.fixture.date,
      league: f.league.name,
      leagueLogo: f.league.logo,
      homeId: f.teams.home.id,
      home: f.teams.home.name,
      homeLogo: f.teams.home.logo,
      awayId: f.teams.away.id,
      away: f.teams.away.name,
      awayLogo: f.teams.away.logo,
      season,
      leagueId: f.league.id,
    }));

    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=900" }, // cache 15 min
      body: JSON.stringify({ updated: new Date().toISOString(), count: matches.length, matches }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
