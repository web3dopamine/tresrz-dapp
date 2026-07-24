// Lightweight load / performance test for the read-heavy API endpoints.
// Dependency-free (uses global fetch). Fires N concurrent workers for D seconds
// against a rotating set of GET endpoints and reports throughput + latency p50/p95/p99.
//
//   node scripts/loadtest.mjs            # defaults: 50 conns, 10s, localhost:31338
//   CONNS=100 DURATION=20 API=http://localhost:31338 node scripts/loadtest.mjs
const API = process.env.API || "http://localhost:31338";
const CONNS = Number(process.env.CONNS || 50);
const DURATION = Number(process.env.DURATION || 10) * 1000;

const ENDPOINTS = [
  "/api/tracks",
  "/api/tracks?hot=true",
  "/api/tracks?q=midnight",
  "/api/artists",
  "/health",
];

const lat = [];
let done = 0, errors = 0, limited = 0, started = 0;

async function pickTrackId() {
  try {
    const r = await fetch(`${API}/api/tracks?limit=1`);
    const a = await r.json();
    return a?.[0]?.id || null;
  } catch { return null; }
}

async function worker(deadline, trackId) {
  let i = 0;
  while (Date.now() < deadline) {
    const eps = trackId ? [...ENDPOINTS, `/api/tracks/${trackId}`, `/api/sales/history/${trackId}`] : ENDPOINTS;
    const url = API + eps[i++ % eps.length];
    const t0 = performance.now();
    try {
      const res = await fetch(url);
      await res.text();
      if (res.status === 429) limited++;
      else if (!res.ok) errors++;
    } catch { errors++; }
    lat.push(performance.now() - t0);
    done++;
  }
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function main() {
  console.log(`Load test -> ${API} | ${CONNS} conns | ${DURATION / 1000}s`);
  const trackId = await pickTrackId();
  const deadline = Date.now() + DURATION;
  started = Date.now();
  await Promise.all(Array.from({ length: CONNS }, () => worker(deadline, trackId)));
  const secs = (Date.now() - started) / 1000;

  console.log(`\nrequests:   ${done}`);
  console.log(`rate-limited(429): ${limited} (expected — express-rate-limit guarding the API)`);
  console.log(`real errors: ${errors} (${((errors / done) * 100).toFixed(2)}%)`);
  console.log(`throughput: ${(done / secs).toFixed(0)} req/s`);
  console.log(`latency ms: avg ${(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(1)} | p50 ${pct(lat, 50).toFixed(1)} | p95 ${pct(lat, 95).toFixed(1)} | p99 ${pct(lat, 99).toFixed(1)} | max ${Math.max(...lat).toFixed(1)}`);
}
main();
