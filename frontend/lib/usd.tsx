"use client";
import { useEffect, useState } from "react";
import { BASE } from "@/lib/api";

// Shared ETH→USD rate for price display. One fetch per page load (module-level
// cache + in-flight dedupe), refreshed every 60s while any component is mounted.
let cached: number | null = null;
let fetchedAt = 0;
let inflight: Promise<number | null> | null = null;

async function getRate(): Promise<number | null> {
  if (cached && Date.now() - fetchedAt < 60_000) return cached;
  if (!inflight) {
    inflight = fetch(`${BASE}/api/rate`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.usdPerEth > 0) { cached = d.usdPerEth; fetchedAt = Date.now(); }
        return cached;
      })
      .catch(() => cached)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useUsdRate(): number | null {
  const [rate, setRate] = useState<number | null>(cached);
  useEffect(() => {
    let alive = true;
    getRate().then((r) => alive && setRate(r));
    const id = setInterval(() => getRate().then((r) => alive && setRate(r)), 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return rate;
}

/** wei -> compact ETH string that never rounds small prices to "0.000"
 *  (0.00005 -> "0.00005", 0.85 -> "0.85", 1.97 -> "1.97", 12 -> "12") */
export function fmtEth(wei: string | bigint | null | undefined): string {
  if (wei == null) return "0";
  try {
    const v = Number(BigInt(wei)) / 1e18;
    if (!Number.isFinite(v) || v === 0) return "0";
    const s = v >= 0.01 ? v.toFixed(3) : v.toPrecision(2);
    return String(parseFloat(s));
  } catch {
    return "0";
  }
}

/** wei -> "$1,234.56" (null when the rate isn't loaded yet) */
export function usd(wei: string | bigint | null | undefined, rate: number | null): string | null {
  if (wei == null || rate == null) return null;
  try {
    const eth = Number(BigInt(wei)) / 1e18;
    const v = eth * rate;
    if (!Number.isFinite(v)) return null;
    return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 4 : 2 });
  } catch {
    return null;
  }
}
