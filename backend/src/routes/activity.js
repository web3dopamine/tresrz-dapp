import { Router } from "express";
import { parseEventLogs, parseAbiItem } from "viem";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { publicClient, chainConfigured } from "../chain.js";

// Item activity feed (OpenSea-style). Events are recorded per-transaction and
// verified against the tx receipt (works on the public RPC, unlike range logs).
const r = Router();
const ZERO = "0x0000000000000000000000000000000000000000";
const transferAbi = parseAbiItem("event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)");
const purchasedAbi = parseAbiItem("event TrackPurchased(uint256 indexed trackId, address indexed buyer, uint64 qty, uint256 paid)");

// GET /api/activity/:trackId  -> feed, newest first, with a synthesized mint event
r.get("/:trackId", async (req, res) => {
  const t = await prisma.track.findUnique({ where: { id: req.params.trackId }, include: { artist: true } });
  if (!t) return res.status(404).json({ error: "not found" });
  const acts = await prisma.activity.findMany({ where: { trackId: t.id }, orderBy: { at: "desc" } });
  const feed = acts.map((a) => ({ kind: a.kind, from: a.fromAddr, to: a.toAddr, priceWei: a.priceWei, qty: a.qty, txHash: a.txHash, at: a.at }));
  // always show the mint/published event (derived from the track itself)
  if (!acts.some((a) => a.kind === "mint")) {
    feed.push({ kind: "mint", from: null, to: t.artist?.address || null, priceWei: null, qty: t.maxSupply, txHash: t.mintTx || t.txHash || null, at: t.createdAt });
  }
  res.json(feed);
});

// POST /api/activity  -> record a purchase/transfer/sale, verified against the receipt
r.post("/", requireAuth, async (req, res) => {
  const { trackId, kind, txHash } = req.body || {};
  if (!trackId || !["purchase", "transfer", "sale"].includes(kind)) return res.status(400).json({ error: "trackId + valid kind required" });
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) return res.status(400).json({ error: "valid txHash required" });
  const t = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true, chainTokenId: true } });
  if (!t || t.chainTokenId == null) return res.status(400).json({ error: "track not on-chain" });
  const dup = await prisma.activity.findFirst({ where: { trackId, txHash, kind } });
  if (dup) return res.json({ ok: true, deduped: true });
  if (!chainConfigured) return res.status(503).json({ error: "chain not configured" });

  let fromAddr = null, toAddr = null, priceWei = null, qty = 1;
  try {
    const rc = await publicClient.getTransactionReceipt({ hash: txHash });
    if (rc.status !== "success") return res.status(400).json({ error: "tx reverted" });
    const transfers = parseEventLogs({ abi: [transferAbi], logs: rc.logs }).filter((e) => Number(e.args.id) === t.chainTokenId);
    if (!transfers.length) return res.status(400).json({ error: "no transfer of this token in that tx" });
    const ev = transfers[0];
    fromAddr = ev.args.from === ZERO ? null : ev.args.from;
    toAddr = ev.args.to;
    qty = Number(ev.args.value);
    const purch = parseEventLogs({ abi: [purchasedAbi], logs: rc.logs }).find((e) => Number(e.args.trackId) === t.chainTokenId);
    if (purch) priceWei = purch.args.paid.toString();
  } catch (e) {
    return res.status(400).json({ error: "could not verify tx", detail: String(e.message || e) });
  }
  const a = await prisma.activity.create({ data: { trackId, kind, fromAddr, toAddr, priceWei, qty, txHash } });
  res.status(201).json({ ok: true, id: a.id });
});

export default r;
