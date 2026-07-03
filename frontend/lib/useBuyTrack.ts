"use client";
import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { api, type Track } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export type BuyResult =
  | { ok: true; hash: `0x${string}`; warn?: string }
  | { ok: false; error: string };

/**
 * Shared primary-market buy flow (used by TrackCard and the track detail page):
 * on-chain `buy(trackId, qty)` -> wait for receipt -> POST /api/sales to record it.
 */
export function useBuyTrack() {
  const { isConnected } = useAccount();
  const { token } = useAuth();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);

  async function buy(t: Track, qty = 1): Promise<BuyResult> {
    if (!isConnected || !token) return { ok: false, error: "Connect your wallet first" };
    if (t.chainTokenId == null) return { ok: false, error: "Track not yet on-chain" };
    setBusy(true);
    try {
      const value = BigInt(t.priceWei) * BigInt(qty);
      const hash = await writeContractAsync({
        abi: musicAbi,
        address: MUSIC_CONTRACT,
        functionName: "buy",
        args: [BigInt(t.chainTokenId), BigInt(qty)],
        value,
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      // the on-chain buy succeeded — a failure to record it must not read as a failed purchase
      try {
        await api.recordSale({ trackId: t.id, qty, priceWei: t.priceWei, txHash: hash });
        return { ok: true, hash };
      } catch {
        return { ok: true, hash, warn: "Purchase confirmed on-chain, but recording it to the catalog failed" };
      }
    } catch (e: any) {
      return { ok: false, error: e?.shortMessage || e?.message || "Purchase cancelled" };
    } finally {
      setBusy(false);
    }
  }

  return { buy, busy };
}
