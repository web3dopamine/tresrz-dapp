import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../db.js";
import { sendEth, txStatus } from "../chain.js";

// Custodial creator dashboard: view held earnings + tracks, and withdraw
// accrued balance to a wallet address. Auth is the bearer "manage token"
// (format: `<creatorId>.<secret>`) issued at custodial mint time.
const r = Router();
const PLATFORM_FEE_BPS = 250n; // matches TresrzMusic.platformFeeBps
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Artist's economic share of a primary sale (total minus the 2.5% platform fee). */
export function artistShareWei(totalWei) {
  const t = BigInt(totalWei);
  return (t * (10000n - PLATFORM_FEE_BPS)) / 10000n;
}

/**
 * Credit a custodial creator's withdrawable balance INSIDE the caller's
 * transaction (atomic with the Sale insert) so a crash can't lose earnings.
 * `amountWei` MUST come from an on-chain-verified amount, never client input.
 * No-op for wallet-owned tracks.
 */
export async function creditEarningsTx(tx, trackId, amountWei) {
  const track = await tx.track.findUnique({ where: { id: trackId }, select: { custodial: true, artistId: true } });
  if (!track?.custodial) return;
  const u = await tx.user.findUnique({ where: { id: track.artistId }, select: { balanceWei: true } });
  const next = (BigInt(u?.balanceWei || "0") + BigInt(amountWei)).toString();
  await tx.user.update({ where: { id: track.artistId }, data: { balanceWei: next } });
}

/** Standalone credit (its own transaction) for callers not already in one. */
export async function creditCustodialEarnings(trackId, amountWei) {
  try {
    await prisma.$transaction((tx) => creditEarningsTx(tx, trackId, amountWei));
  } catch (e) {
    console.error("creditCustodialEarnings failed:", trackId, e.message);
  }
}

async function authCreator(token) {
  const t = String(token || "");
  const dot = t.indexOf(".");
  if (dot < 1) return null;
  const id = t.slice(0, dot), secret = t.slice(dot + 1);
  if (!id || !secret) return null;
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u || !u.custodial || !u.manageTokenHash) return null;
  // constant-time compare
  const a = Buffer.from(sha(secret));
  const b = Buffer.from(u.manageTokenHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return u;
}

// GET /api/creator/me?token=...  -> profile, balance, tracks
r.get("/me", async (req, res) => {
  const u = await authCreator(req.query.token);
  if (!u) return res.status(401).json({ error: "invalid manage token" });
  const tracks = await prisma.track.findMany({
    where: { artistId: u.id }, orderBy: { createdAt: "desc" },
    include: { _count: { select: { likes: true, sales: true } } },
  });
  res.json({
    creator: { id: u.id, email: u.email, handle: u.handle, avatarSeed: u.avatarSeed },
    balanceWei: u.balanceWei,
    tracks: tracks.map((t) => ({
      id: t.id, title: t.title, genre: t.genre, coverSeed: t.coverSeed, chainTokenId: t.chainTokenId,
      priceWei: t.priceWei, maxSupply: t.maxSupply, minted: t.minted, left: t.maxSupply - t.minted,
      likes: t._count.likes, sales: t._count.sales, flagged: t.flagged,
    })),
  });
});

// POST /api/creator/withdraw { token, address } -> send full balance on-chain
r.post("/withdraw", async (req, res) => {
  const { token, address } = req.body || {};
  const to = String(address || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return res.status(400).json({ error: "valid 0x wallet address required" });
  const u = await authCreator(token);
  if (!u) return res.status(401).json({ error: "invalid manage token" });

  // Zero the balance via an atomic COMPARE-AND-SET so two concurrent withdraws
  // can't both read a positive balance and both pay out (double-spend). The
  // loser matches 0 rows and aborts.
  let payout;
  if (BigInt(u.balanceWei || "0") <= 0n) return res.status(400).json({ error: "nothing to withdraw" });
  try {
    payout = await prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUnique({ where: { id: u.id }, select: { balanceWei: true } });
      const amt = BigInt(fresh?.balanceWei || "0");
      if (amt <= 0n) throw new Error("nothing to withdraw");
      const won = await tx.user.updateMany({ where: { id: u.id, balanceWei: fresh.balanceWei }, data: { balanceWei: "0" } });
      if (won.count !== 1) throw new Error("another withdrawal is in progress");
      return tx.payout.create({ data: { creatorId: u.id, amountWei: amt.toString(), toAddress: to, status: "pending" } });
    });
  } catch (e) {
    return res.status(409).json({ error: String(e.message || "withdraw blocked") });
  }

  const sent = await sendEth({ to, wei: payout.amountWei });
  if (sent.ok) {
    await prisma.payout.update({ where: { id: payout.id }, data: { status: "sent", txHash: sent.txHash } });
    return res.json({ ok: true, txHash: sent.txHash, amountWei: payout.amountWei, toAddress: to });
  }
  if (sent.pending) {
    // BROADCAST but receipt unconfirmed — the ETH may well have left. Do NOT
    // refund (that would risk paying twice). Leave the payout pending w/ its tx
    // hash for the reconciler to finalize; keep the balance at 0.
    await prisma.payout.update({ where: { id: payout.id }, data: { status: "pending", txHash: sent.txHash || null } }).catch(() => {});
    return res.json({ ok: true, pending: true, txHash: sent.txHash || null, amountWei: payout.amountWei, toAddress: to });
  }
  // DEFINITELY failed (never broadcast) — safe to restore the balance exactly once.
  await prisma.$transaction(async (tx) => {
    const cur = await tx.user.findUnique({ where: { id: u.id }, select: { balanceWei: true } });
    const restored = (BigInt(cur?.balanceWei || "0") + BigInt(payout.amountWei)).toString();
    await tx.user.update({ where: { id: u.id }, data: { balanceWei: restored } });
    await tx.payout.update({ where: { id: payout.id }, data: { status: "failed" } });
  }).catch((e) => console.error("withdraw refund failed:", u.id, "payout", payout.id, "amount", payout.amountWei, e.message));
  return res.status(502).json({ error: "withdrawal failed, your balance is intact — try again", reason: sent.reason });
});

// Reconciler: finalize withdrawals whose on-chain send couldn't be confirmed
// inline (pending payouts with a txHash). Confirmed -> sent; reverted (funds
// returned) -> restore the balance exactly once and mark failed. Also restores
// balance for a pending payout that never got a tx hash (send never broadcast).
let payoutTimer = null;
export function startPayoutReconciler() {
  if (payoutTimer) return;
  const tick = async () => {
    try {
      const olderThan = new Date(Date.now() - 60_000);
      const pend = await prisma.payout.findMany({ where: { status: "pending", createdAt: { lt: olderThan } }, take: 20, orderBy: { createdAt: "asc" } });
      for (const p of pend) {
        if (!p.txHash) {
          // never broadcast — restore balance once
          await restorePayout(p);
          continue;
        }
        const st = await txStatus(p.txHash);
        if (st === "success") {
          await prisma.payout.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "sent" } });
        } else if (st === "reverted") {
          await restorePayout(p);
        } // pending: leave for the next tick
      }
    } catch (e) {
      console.error("payout reconciler tick failed:", e.message);
    }
  };
  payoutTimer = setInterval(tick, 30_000);
  payoutTimer.unref?.();
}

// idempotently move a pending payout -> failed and add its amount back to the
// creator's current balance (the pending->failed CAS guarantees once-only).
async function restorePayout(p) {
  await prisma.$transaction(async (tx) => {
    const won = await tx.payout.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "failed" } });
    if (won.count !== 1) return; // already handled
    const cur = await tx.user.findUnique({ where: { id: p.creatorId }, select: { balanceWei: true } });
    const restored = (BigInt(cur?.balanceWei || "0") + BigInt(p.amountWei)).toString();
    await tx.user.update({ where: { id: p.creatorId }, data: { balanceWei: restored } });
  }).catch((e) => console.error("restorePayout failed:", p.id, e.message));
}

export default r;
