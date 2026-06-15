// netlify/functions/get-bets.js
// Gets bets for a wallet address + settles finished ones

const { getStore } = require("@netlify/blobs");

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const params = event.queryStringParameters || {};
  const wallet = params.wallet;

  if (!wallet) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing wallet address." }) };
  }

  try {
    const store = getStore("stratos-bets");
    const walletKey = `wallet-${wallet.toLowerCase()}`;

    let betIds = [];
    try {
      betIds = await store.get(walletKey, { type: "json" }) || [];
    } catch(e) { betIds = []; }

    // Fetch all bets
    const bets = await Promise.all(
      betIds.map(async function(id) {
        try {
          return await store.get(id, { type: "json" });
        } catch(e) { return null; }
      })
    );

    const validBets = bets.filter(Boolean);

    // Try to settle unsettled bets where match may have finished
    const unsettled = validBets.filter(b => !b.settled);
    const API_KEY = process.env.API_FOOTBALL_KEY;

    if (API_KEY && unsettled.length > 0) {
      await Promise.all(unsettled.map(async function(bet) {
        try {
          const res = await fetch(`https://v3.football.api-sports.io/fixtures?id=${bet.fixtureId}`, {
            headers: { "x-apisports-key": API_KEY }
          });
          const data = await res.json();
          if (!data.response || !data.response.length) return;

          const match = data.response[0];
          const status = match.fixture.status.short;

          if (["FT","AET","PEN"].includes(status)) {
            const hg = match.goals.home;
            const ag = match.goals.away;
            let result = hg > ag ? "1" : hg === ag ? "X" : "2";

            bet.result = result;
            bet.settled = true;
            bet.won = (bet.pick === result);
            bet.finalScore = `${hg} - ${ag}`;

            await store.setJSON(bet.id, bet);
          }
        } catch(e) { /* skip */ }
      }));
    }

    // Re-fetch updated bets
    const updatedBets = await Promise.all(
      betIds.map(async function(id) {
        try { return await store.get(id, { type: "json" }); }
        catch(e) { return null; }
      })
    );

    const finalBets = updatedBets.filter(Boolean).sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Stats
    const settled = finalBets.filter(b => b.settled);
    const won = settled.filter(b => b.won);
    const stats = {
      total: finalBets.length,
      settled: settled.length,
      won: won.length,
      lost: settled.length - won.length,
      pending: finalBets.length - settled.length,
      winRate: settled.length ? ((won.length / settled.length) * 100).toFixed(1) + "%" : "N/A"
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ bets: finalBets, stats })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err.message) }) };
  }
};
