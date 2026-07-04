import { Router } from "express";
const r = Router();

// GET /api/rate -> { usdPerEth, at }
// Cached for 60s; CoinGecko primary, Coinbase fallback, last-known-good kept
// so a flaky upstream never blanks prices out of the UI.
let cache = { usdPerEth: null, at: 0 };
const TTL = 60_000;

async function fetchRate() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    const v = Number(j?.ethereum?.usd);
    if (v > 0) return v;
  } catch {}
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    const v = Number(j?.data?.amount);
    if (v > 0) return v;
  } catch {}
  return null;
}

export async function usdPerEth() {
  if (cache.usdPerEth && Date.now() - cache.at < TTL) return cache.usdPerEth;
  const v = await fetchRate();
  if (v) cache = { usdPerEth: v, at: Date.now() };
  return cache.usdPerEth; // may be a stale last-known-good, or null before first success
}

r.get("/", async (_req, res) => {
  const v = await usdPerEth();
  if (!v) return res.status(503).json({ error: "rate unavailable" });
  res.json({ usdPerEth: v, at: cache.at });
});

export default r;
