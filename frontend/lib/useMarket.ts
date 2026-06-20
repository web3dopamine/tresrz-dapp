"use client";
import { useCallback, useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useReadContract } from "wagmi";
import { parseEther } from "viem";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { marketAbi, MARKET_CONTRACT } from "@/lib/marketAbi";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export type TxResult =
  | { ok: true; hash: `0x${string}` }
  | { ok: false; error: string };

function errMsg(e: any): string {
  return e?.shortMessage || e?.message || "Transaction cancelled";
}

/**
 * Reads isApprovedForAll(address, MARKET_CONTRACT) and exposes ensureApproved(),
 * which sends setApprovalForAll(MARKET_CONTRACT, true) and waits, if not already
 * approved. Throws on failure so callers can short-circuit.
 */
export function useApproval() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const { data: approved, refetch } = useReadContract({
    abi: musicAbi,
    address: MUSIC_CONTRACT,
    functionName: "isApprovedForAll",
    args: address ? [address, MARKET_CONTRACT] : undefined,
    query: { enabled: !!address },
  });

  const ensureApproved = useCallback(async () => {
    if (!isConnected || !address) throw new Error("Connect your wallet first");
    if (approved) return;
    const hash = await writeContractAsync({
      abi: musicAbi,
      address: MUSIC_CONTRACT,
      functionName: "setApprovalForAll",
      args: [MARKET_CONTRACT, true],
    });
    await publicClient?.waitForTransactionReceipt({ hash });
    await refetch();
  }, [isConnected, address, approved, writeContractAsync, publicClient, refetch]);

  return { approved: !!approved, ensureApproved };
}

function useGuard() {
  const { isConnected } = useAccount();
  const { token } = useAuth();
  return useCallback((): string | null => {
    if (!isConnected || !token) return "Connect your wallet first";
    return null;
  }, [isConnected, token]);
}

export function useListTrack() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { ensureApproved } = useApproval();
  const guard = useGuard();
  const [busy, setBusy] = useState(false);

  const list = useCallback(
    async (tokenId: number, qty: number, priceEthString: string): Promise<TxResult> => {
      const g = guard();
      if (g) return { ok: false, error: g };
      setBusy(true);
      try {
        await ensureApproved();
        const hash = await writeContractAsync({
          abi: marketAbi,
          address: MARKET_CONTRACT,
          functionName: "list",
          args: [BigInt(tokenId), BigInt(qty), parseEther(priceEthString)],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return { ok: true, hash };
      } catch (e: any) {
        return { ok: false, error: errMsg(e) };
      } finally {
        setBusy(false);
      }
    },
    [guard, ensureApproved, writeContractAsync, publicClient],
  );

  return { list, busy };
}

export function useBuyListing() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const guard = useGuard();
  const [busy, setBusy] = useState(false);

  const buy = useCallback(
    async (listingId: number, qty: number, unitPriceWei: bigint, trackId: string): Promise<TxResult> => {
      const g = guard();
      if (g) return { ok: false, error: g };
      setBusy(true);
      try {
        const value = unitPriceWei * BigInt(qty);
        const hash = await writeContractAsync({
          abi: marketAbi,
          address: MARKET_CONTRACT,
          functionName: "buy",
          args: [BigInt(listingId), BigInt(qty)],
          value,
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        // best-effort: record to backend, swallow errors so the on-chain success stands
        try {
          await api.recordSecondarySale({ trackId, qty, txHash: hash });
        } catch {
          /* ignore */
        }
        return { ok: true, hash };
      } catch (e: any) {
        return { ok: false, error: errMsg(e) };
      } finally {
        setBusy(false);
      }
    },
    [guard, writeContractAsync, publicClient],
  );

  return { buy, busy };
}

export function useMakeOffer() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const guard = useGuard();
  const [busy, setBusy] = useState(false);

  const makeOffer = useCallback(
    async (tokenId: number, qty: number, priceEthString: string): Promise<TxResult> => {
      const g = guard();
      if (g) return { ok: false, error: g };
      setBusy(true);
      try {
        const unit = parseEther(priceEthString);
        const value = unit * BigInt(qty);
        const hash = await writeContractAsync({
          abi: marketAbi,
          address: MARKET_CONTRACT,
          functionName: "makeOffer",
          args: [BigInt(tokenId), BigInt(qty), unit],
          value,
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return { ok: true, hash };
      } catch (e: any) {
        return { ok: false, error: errMsg(e) };
      } finally {
        setBusy(false);
      }
    },
    [guard, writeContractAsync, publicClient],
  );

  return { makeOffer, busy };
}

export function useAcceptOffer() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { ensureApproved } = useApproval();
  const guard = useGuard();
  const [busy, setBusy] = useState(false);

  const accept = useCallback(
    async (offerId: number): Promise<TxResult> => {
      const g = guard();
      if (g) return { ok: false, error: g };
      setBusy(true);
      try {
        await ensureApproved();
        const hash = await writeContractAsync({
          abi: marketAbi,
          address: MARKET_CONTRACT,
          functionName: "acceptOffer",
          args: [BigInt(offerId)],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return { ok: true, hash };
      } catch (e: any) {
        return { ok: false, error: errMsg(e) };
      } finally {
        setBusy(false);
      }
    },
    [guard, ensureApproved, writeContractAsync, publicClient],
  );

  return { accept, busy };
}

export function useCancelListing() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const guard = useGuard();
  const [busy, setBusy] = useState(false);

  const cancel = useCallback(
    async (listingId: number): Promise<TxResult> => {
      const g = guard();
      if (g) return { ok: false, error: g };
      setBusy(true);
      try {
        const hash = await writeContractAsync({
          abi: marketAbi,
          address: MARKET_CONTRACT,
          functionName: "cancelListing",
          args: [BigInt(listingId)],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return { ok: true, hash };
      } catch (e: any) {
        return { ok: false, error: errMsg(e) };
      } finally {
        setBusy(false);
      }
    },
    [guard, writeContractAsync, publicClient],
  );

  return { cancel, busy };
}

export function useCancelOffer() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const guard = useGuard();
  const [busy, setBusy] = useState(false);

  const cancel = useCallback(
    async (offerId: number): Promise<TxResult> => {
      const g = guard();
      if (g) return { ok: false, error: g };
      setBusy(true);
      try {
        const hash = await writeContractAsync({
          abi: marketAbi,
          address: MARKET_CONTRACT,
          functionName: "cancelOffer",
          args: [BigInt(offerId)],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return { ok: true, hash };
      } catch (e: any) {
        return { ok: false, error: errMsg(e) };
      } finally {
        setBusy(false);
      }
    },
    [guard, writeContractAsync, publicClient],
  );

  return { cancel, busy };
}

export function useTransfer() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const guard = useGuard();
  const [busy, setBusy] = useState(false);

  const transfer = useCallback(
    async (tokenId: number, to: string, qty: number): Promise<TxResult> => {
      const g = guard();
      if (g) return { ok: false, error: g };
      if (!address) return { ok: false, error: "Connect your wallet first" };
      if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return { ok: false, error: "Invalid recipient address" };
      setBusy(true);
      try {
        const hash = await writeContractAsync({
          abi: musicAbi,
          address: MUSIC_CONTRACT,
          functionName: "safeTransferFrom",
          args: [address, to as `0x${string}`, BigInt(tokenId), BigInt(qty), "0x"],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return { ok: true, hash };
      } catch (e: any) {
        return { ok: false, error: errMsg(e) };
      } finally {
        setBusy(false);
      }
    },
    [guard, address, writeContractAsync, publicClient],
  );

  return { transfer, busy };
}
