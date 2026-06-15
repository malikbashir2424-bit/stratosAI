// netlify/functions/save-bet.js
// Saves a bet to Netlify Blobs (persistent storage)
// Each bet: { id, wallet, fixtureId, pick, odds, stake, matchLabel, timestamp, result, settled }

const { getStore } = require("@netlify/blobs");

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed." }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { wallet, fixtureId, pick, odds, stake, matchLabel, homeTeam, awayTeam, kickoff } = body;

    // Basic validation
    if (!wallet || !fixtureId || !pick || !odds || !stake) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields." }) };
    }

    if (!["1","X","2"].includes(pick)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid pick. Must be 1, X, or 2." }) };
    }

    const betId = `${wallet}-${fixtureId}-${Date.now()}`;
    const bet = {
      id: betId,
      wallet: wallet.toLowerCase(),
      fixtureId: parseInt(fixtureId),
      pick,           // "1", "X", "2"
      odds: parseFloat(odds),
      stake: parseFloat(stake),
      potentialWin: parseFloat((odds * stake).toFixed(2)),
      matchLabel: matchLabel || `${homeTeam} vs ${awayTeam}`,
      homeTeam,
      awayTeam,
      kickoff,
      timestamp: new Date().toISOString(),
      result: null,    // filled after match ends
      settled: false,  // true after result confirmed
      won: null,       // true/false after settlement
    };

    // Save to Netlify Blobs
    const store = getStore("stratos-bets");
    await store.setJSON(betId, bet);

    // Also update wallet index for fast lookup
    const walletKey = `wallet-${wallet.toLowerCase()}`;
    let walletBets = [];
    try {
      walletBets = await store.get(walletKey, { type: "json" }) || [];
    } catch(e) { walletBets = []; }
    walletBets.push(betId);
    await store.setJSON(walletKey, walletBets);

    // Update fixture index
    const fixtureKey = `fixture-${fixtureId}`;
    let fixtureBets = [];
    try {
      fixtureBets = await store.get(fixtureKey, { type: "json" }) || [];
    } catch(e) { fixtureBets = []; }
    fixtureBets.push(betId);
    await store.setJSON(fixtureKey, fixtureBets);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ success: true, betId, bet })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err.message) }) };
  }
};
