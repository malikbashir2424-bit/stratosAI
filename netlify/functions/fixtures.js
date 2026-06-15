// netlify/functions/fixtures.js
// Secure middleman: fetches upcoming football fixtures + team form from API-Football.
// The API key stays hidden in Netlify Environment Variables (never exposed to the browser).

exports.handler = async function (event) {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const BASE = "https://v3.football.api-sports.io";

  // CORS so our own page can call this function
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing API key on server." }) };
  }

  const apiHeaders = { "x-apisports-key": API_KEY };

  // Helper to call API-Football
  async function api(path) {
    const res = await fetch(BASE + path, { headers: apiHeaders });
    if (!res.ok) throw new Error("API request failed: " + res.status);
    return res.json();
  }

  try {
    // 1) Get next fixtures (next 15 upcoming matches across major leagues)
    //    We pull by date range: today -> +3 days, then keep a handful.
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    const from = fmt(today);
    const to = fmt(new Date(today.getTime() + 3 * 86400000));

    // Popular leagues: 39=EPL, 140=La Liga, 135=Serie A, 78=Bundesliga, 61=Ligue 1, 2=UCL
    const leagues = [39, 140, 135, 78, 61, 2];
    const season = today.getFullYear(); // API-Football uses starting year of season

    let fixtures = [];
    for (const lg of leagues) {
      const data = await api(`/fixtures?league=${lg}&season=${season}&from=${from}&to=${to}`);
      if (data.response && data.response.length) {
        fixtures = fixtures.concat(data.response);
      }
      if (fixtures.length >= 12) break;
    }

    // Sort by kickoff time, keep the soonest 8
    fixtures.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
    fixtures = fixtures.slice(0, 8);

    // 2) Shape a clean, lightweight payload for the page.
    //    We include team names, logos, league, kickoff — the page's Poisson
    //    model can use simple league-average baselines until we add per-team stats.
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
      headers: { ...headers, "Cache-Control": "public, max-age=1800" }, // cache 30 min
      body: JSON.stringify({ updated: new Date().toISOString(), count: matches.length, matches }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
