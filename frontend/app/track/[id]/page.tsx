"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatEther } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import Header from "@/components/Header";
import WaveformPlayer from "@/components/WaveformPlayer";
import { CoverArt, avatarUrl } from "@/lib/art";
import { api, type Track, type SaleHistory } from "@/lib/api";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { marketAbi, MARKET_CONTRACT } from "@/lib/marketAbi";
import { useAuth } from "@/lib/auth";

// Block explorer for the active chain (used for on-chain provenance links).
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN || 31337);
const EXPLORER =
  CHAIN_ID === 11155111 ? "https://sepolia.etherscan.io"
  : CHAIN_ID === 1 ? "https://etherscan.io"
  : "https://explorer.libertychain.org";
const EXPLORER_NAME = CHAIN_ID === 11155111 ? "Sepolia Etherscan" : CHAIN_ID === 1 ? "Etherscan" : "the explorer";
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
import { useBuyTrack } from "@/lib/useBuyTrack";
import {
  useAcceptOffer,
  useBuyListing,
  useCancelListing,
  useCancelOffer,
  useListTrack,
  useMakeOffer,
  useTransfer,
  useUpdateListing,
} from "@/lib/useMarket";

type Listing = { id: number; seller: string; tokenId: number; qty: number; unit: bigint };
type Offer = { id: number; buyer: string; tokenId: number; qty: number; unit: bigint };

function ethStr(wei: bigint | string, dp = 3): string {
  try {
    return Number(formatEther(typeof wei === "bigint" ? wei : BigInt(wei))).toFixed(dp);
  } catch {
    return "0";
  }
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 160, h = 36, pad = 3;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
      <path d={d} fill="none" stroke="var(--crimson, #f58426)" strokeWidth={1.5} />
    </svg>
  );
}

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const { address } = useAccount();
  const { buy, busy } = useBuyTrack();

  const { buy: buyListing, busy: buyingListing } = useBuyListing();
  const { list, busy: listing } = useListTrack();
  const { makeOffer, busy: offering } = useMakeOffer();
  const { transfer, busy: transferring } = useTransfer();
  const { accept: acceptOffer, busy: accepting } = useAcceptOffer();
  const { cancel: cancelOffer, busy: cancellingOffer } = useCancelOffer();
  const { cancel: cancelListing, busy: cancellingListing } = useCancelListing();
  const { update: updateListing, busy: updatingListing } = useUpdateListing();

  const [track, setTrack] = useState<Track | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [history, setHistory] = useState<SaleHistory[]>([]);
  const [msg, setMsg] = useState("");
  const [liking, setLiking] = useState(false);
  const tRef = useRef<any>(null);

  // forms
  const [offerQty, setOfferQty] = useState("1");
  const [offerPrice, setOfferPrice] = useState("0.1");
  const [listQty, setListQty] = useState("1");
  const [listPrice, setListPrice] = useState("0.1");
  const [xferTo, setXferTo] = useState("");
  const [xferQty, setXferQty] = useState("1");
  // inline edit of one of your own listings: null = closed
  const [editListing, setEditListing] = useState<{ id: number; qty: string; price: string } | null>(null);

  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2400); }

  function load() {
    api.track(id).then((t) => { setTrack(t); setState("ready"); }).catch(() => setState("missing"));
    api.history(id).then(setHistory).catch(() => setHistory([]));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const chainTokenId = track?.chainTokenId ?? null;

  // ---- on-chain reads: listings scan + owned balance ----
  const { data: nextListingId } = useReadContract({
    abi: marketAbi, address: MARKET_CONTRACT, functionName: "nextListingId",
    query: { enabled: chainTokenId != null },
  });
  const maxListingId = nextListingId ? Number(nextListingId) - 1 : 0;

  const listingCalls = useMemo(() => {
    if (chainTokenId == null || maxListingId < 1) return [];
    return Array.from({ length: maxListingId }, (_, i) => ({
      abi: marketAbi, address: MARKET_CONTRACT, functionName: "listings" as const, args: [BigInt(i + 1)] as const,
    }));
  }, [chainTokenId, maxListingId]);

  const { data: listingData, refetch: refetchListings } = useReadContracts({
    contracts: listingCalls,
    query: { enabled: listingCalls.length > 0 },
  });

  const listings: Listing[] = useMemo(() => {
    if (!listingData || chainTokenId == null) return [];
    const out: Listing[] = [];
    listingData.forEach((r, i) => {
      if (r.status !== "success" || !r.result) return;
      const [seller, tokenId, qty, unit, active] = r.result as readonly [string, bigint, bigint, bigint, boolean];
      if (active && Number(tokenId) === chainTokenId && Number(qty) > 0) {
        out.push({ id: i + 1, seller, tokenId: Number(tokenId), qty: Number(qty), unit });
      }
    });
    return out;
  }, [listingData, chainTokenId]);

  // ---- on-chain reads: open offers scan (same pattern as listings) ----
  const { data: nextOfferId } = useReadContract({
    abi: marketAbi, address: MARKET_CONTRACT, functionName: "nextOfferId",
    query: { enabled: chainTokenId != null },
  });
  const maxOfferId = nextOfferId ? Number(nextOfferId) - 1 : 0;

  const offerCalls = useMemo(() => {
    if (chainTokenId == null || maxOfferId < 1) return [];
    return Array.from({ length: maxOfferId }, (_, i) => ({
      abi: marketAbi, address: MARKET_CONTRACT, functionName: "offers" as const, args: [BigInt(i + 1)] as const,
    }));
  }, [chainTokenId, maxOfferId]);

  const { data: offerData, refetch: refetchOffers } = useReadContracts({
    contracts: offerCalls,
    query: { enabled: offerCalls.length > 0 },
  });

  const offers: Offer[] = useMemo(() => {
    if (!offerData || chainTokenId == null) return [];
    const out: Offer[] = [];
    offerData.forEach((r, i) => {
      if (r.status !== "success" || !r.result) return;
      const [buyer, tokenId, qty, unit, , active] = r.result as readonly [string, bigint, bigint, bigint, bigint, boolean];
      if (active && Number(tokenId) === chainTokenId && Number(qty) > 0) {
        out.push({ id: i + 1, buyer, tokenId: Number(tokenId), qty: Number(qty), unit });
      }
    });
    return out;
  }, [offerData, chainTokenId]);

  const { data: ownedBal, refetch: refetchBalance } = useReadContract({
    abi: musicAbi, address: MUSIC_CONTRACT, functionName: "balanceOf",
    args: address && chainTokenId != null ? [address, BigInt(chainTokenId)] : undefined,
    query: { enabled: !!address && chainTokenId != null },
  });
  const ownedQty = ownedBal != null ? Number(ownedBal as bigint) : 0;

  // ---- on-chain provenance: live track record + royalty ----
  const { data: onchainTrack } = useReadContract({
    abi: musicAbi, address: MUSIC_CONTRACT, functionName: "tracks",
    args: chainTokenId != null ? [BigInt(chainTokenId)] : undefined,
    query: { enabled: chainTokenId != null },
  });
  const { data: royaltyData } = useReadContract({
    abi: musicAbi, address: MUSIC_CONTRACT, functionName: "royaltyInfo",
    args: chainTokenId != null ? [BigInt(chainTokenId), 10000n] : undefined,
    query: { enabled: chainTokenId != null },
  });
  const chainInfo = useMemo(() => {
    if (!onchainTrack) return null;
    const [artist, , maxSupply, minted, , active] = onchainTrack as readonly [string, bigint, bigint, bigint, string, boolean];
    const royaltyPct = royaltyData ? Number((royaltyData as readonly [string, bigint])[1]) / 100 : null;
    return { artist, maxSupply: Number(maxSupply), minted: Number(minted), active, royaltyPct };
  }, [onchainTrack, royaltyData]);

  function refreshChain() {
    refetchListings();
    refetchOffers();
    refetchBalance();
    load();
  }

  async function onBuy() {
    if (!track) return;
    const res = await buy(track);
    if (!res.ok) return toast(res.error);
    toast(res.warn ? `⚠ ${res.warn}` : `Bought ${track.title} ✓`);
    api.track(id).then((t) => setTrack(t)).catch(() => {});
  }

  async function onBuyListing(l: Listing) {
    if (!track) return;
    const res = await buyListing(l.id, l.qty, l.unit, track.id);
    if (!res.ok) return toast(res.error);
    toast(res.warn ? `⚠ ${res.warn}` : "Purchased from marketplace ✓");
    refreshChain();
  }

  async function onAcceptOffer(o: Offer) {
    if (!track) return;
    const res = await acceptOffer(o.id, track.id, o.qty);
    if (!res.ok) return toast(res.error);
    toast(res.warn ? `⚠ ${res.warn}` : `Offer accepted — ${ethStr(o.unit * BigInt(o.qty))} ETH received ✓`);
    refreshChain();
  }

  async function onCancelOffer(o: Offer) {
    const res = await cancelOffer(o.id);
    if (!res.ok) return toast(res.error);
    toast("Offer cancelled — escrow refunded ✓");
    refreshChain();
  }

  async function onCancelListing(listingId: number) {
    const res = await cancelListing(listingId);
    if (!res.ok) return toast(res.error);
    setEditListing(null);
    toast("Listing cancelled ✓");
    refreshChain();
  }

  async function onUpdateListing() {
    if (!editListing) return;
    const res = await updateListing(editListing.id, Number(editListing.qty) || 1, editListing.price);
    if (!res.ok) return toast(res.error);
    setEditListing(null);
    toast("Listing updated ✓");
    refreshChain();
  }

  async function onMakeOffer() {
    if (chainTokenId == null) return toast("Track not yet on-chain");
    const res = await makeOffer(chainTokenId, Number(offerQty) || 1, offerPrice);
    if (!res.ok) return toast(res.error);
    toast("Offer submitted ✓");
    refreshChain();
  }

  async function onList() {
    if (chainTokenId == null) return toast("Track not yet on-chain");
    const res = await list(chainTokenId, Number(listQty) || 1, listPrice);
    if (!res.ok) return toast(res.error);
    toast("Listed for sale ✓");
    refreshChain();
  }

  async function onTransfer() {
    if (chainTokenId == null) return toast("Track not yet on-chain");
    const res = await transfer(chainTokenId, xferTo.trim(), Number(xferQty) || 1);
    if (!res.ok) return toast(res.error);
    toast("Transferred ✓");
    setXferTo("");
    refreshChain();
  }

  async function onLike() {
    if (!track) return;
    if (!token) return toast("Sign in to like");
    setLiking(true);
    const prev = { liked: track.liked, likes: track.likes };
    setTrack({ ...track, liked: !track.liked, likes: track.likes + (track.liked ? -1 : 1) });
    try {
      const res = await api.toggleLike(track.id);
      setTrack((t) => (t ? { ...t, liked: res.liked, likes: res.count } : t));
    } catch {
      setTrack((t) => (t ? { ...t, ...prev } : t));
      toast("Could not update like");
    } finally { setLiking(false); }
  }

  const priceEth = track ? Number(BigInt(track.priceWei)) / 1e18 : 0;
  const sparkPoints = useMemo(
    () => history.map((h) => Number(ethStr(h.unitWei, 6))).filter((n) => Number.isFinite(n)),
    [history],
  );

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        {state === "loading" && <div className="muted-note">Loading track…</div>}
        {state === "missing" && (
          <div className="muted-note">Track not found. <Link href="/" style={{ color: "var(--crimson-soft)" }}>← Back home</Link></div>
        )}
        {state === "ready" && track && (
          <>
            <div className="detail-grid">
              <div className="detail-cover">
                <CoverArt seed={track.coverSeed} />
                <div className="genre">{track.genre}</div>
              </div>

              <div className="detail-info">
                <h1 className="detail-title">{track.title}</h1>
                <Link href={`/artist/${track.artist.address}`} className="detail-artist">
                  <img src={avatarUrl(track.artist.avatarSeed)} alt="" />
                  <span>by <b>{track.artist.handle}</b></span>
                </Link>

                <div className="detail-stats">
                  <div><span>PRICE</span><b>{priceEth.toFixed(3)} ETH</b></div>
                  <div><span>EDITIONS LEFT</span><b>{track.left} / {track.maxSupply}</b></div>
                  <div><span>TOKEN ID</span><b>{track.chainTokenId ?? "—"}</b></div>
                  <div><span>YOU OWN</span><b>{ownedQty}</b></div>
                </div>

                <WaveformPlayer track={track} />

                <div className="detail-actions">
                  <button className="buy" disabled={busy || track.left === 0} onClick={onBuy}>
                    {track.left === 0 ? "SOLD OUT" : busy ? "CONFIRMING…" : `BUY 1 EDITION · ${priceEth.toFixed(3)} ETH`}
                  </button>
                  <button className={`heart detail-heart${track.liked ? " liked" : ""}`} disabled={liking} onClick={onLike} aria-label="like">
                    <svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-8.5C1 9 3 5.5 6.5 5.5c2 0 3.5 1.3 5.5 3 2-1.7 3.5-3 5.5-3C21 5.5 23 9 21.5 12.5 19 16.5 12 21 12 21z" /></svg>
                    <small>{track.likes}</small>
                  </button>
                </div>
              </div>
            </div>

            {/* ---- On-chain provenance ---- */}
            <div className="sec-title" style={{ marginTop: 34 }}>ON-CHAIN</div>
            <div className="sec-bar" />
            {chainTokenId == null ? (
              <div className="muted-note">This track isn’t on-chain yet.</div>
            ) : (
              <div className="tk-panel">
                <ul className="tk-onchain">
                  <li><span>Contract</span><a href={`${EXPLORER}/address/${MUSIC_CONTRACT}`} target="_blank" rel="noreferrer">{shortAddr(MUSIC_CONTRACT)} ↗</a></li>
                  <li><span>Token ID</span><a href={`${EXPLORER}/token/${MUSIC_CONTRACT}?a=${chainTokenId}`} target="_blank" rel="noreferrer">#{chainTokenId} ↗</a></li>
                  {chainInfo && <li><span>Editions minted</span><b>{chainInfo.minted} / {chainInfo.maxSupply}</b></li>}
                  {chainInfo && <li><span>Creator</span><Link href={`/artist/${chainInfo.artist}`}>{shortAddr(chainInfo.artist)}</Link></li>}
                  {chainInfo?.royaltyPct != null && <li><span>Royalty</span><b>{chainInfo.royaltyPct}%</b></li>}
                  {track.createdAt && <li><span>Minted</span><b>{new Date(track.createdAt).toLocaleString()}</b></li>}
                  {track.txHash && <li><span>Mint tx</span><a href={`${EXPLORER}/tx/${track.txHash}`} target="_blank" rel="noreferrer">{track.txHash.slice(0, 10)}… ↗</a></li>}
                  {chainInfo && <li><span>Status</span><b>{chainInfo.active ? "Active" : "Inactive"}</b></li>}
                </ul>
                <a className="tk-explorer-link" href={`${EXPLORER}/token/${MUSIC_CONTRACT}?a=${chainTokenId}`} target="_blank" rel="noreferrer">
                  View mint &amp; full transfer history on {EXPLORER_NAME} ↗
                </a>
              </div>
            )}

            {/* ---- Price history ---- */}
            <div className="sec-title" style={{ marginTop: 34 }}>PRICE HISTORY</div>
            <div className="sec-bar" />
            {history.length === 0 ? (
              <div className="muted-note">No sales recorded yet.</div>
            ) : (
              <div className="tk-panel">
                {sparkPoints.length >= 2 && (
                  <div className="tk-spark"><Sparkline points={sparkPoints} /><span>unit price trend (ETH)</span></div>
                )}
                <ul className="tk-history">
                  {history.map((h, i) => (
                    <li key={i}>
                      <span className={`tk-kind tk-${h.kind === "secondary" ? "sec" : "pri"}`}>{h.kind}</span>
                      <span className="tk-qty">×{h.qty}</span>
                      <span className="tk-price">{ethStr(h.unitWei)} ETH</span>
                      <span className="tk-date">{new Date(h.at).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ---- Secondary market ---- */}
            <div className="sec-title" style={{ marginTop: 34 }}>SECONDARY MARKET</div>
            <div className="sec-bar" />
            {chainTokenId == null ? (
              <div className="muted-note">This track isn’t on-chain yet, so it can’t be traded.</div>
            ) : (
              <div className="tk-panel">
                {listings.length === 0 ? (
                  <div className="muted-note">No active listings for this token.</div>
                ) : (
                  <ul className="tk-listings">
                    {listings.map((l) => {
                      const mine = address && l.seller.toLowerCase() === address.toLowerCase();
                      return (
                        <li key={l.id} className={editListing?.id === l.id ? "tk-editing" : undefined}>
                          <div className="tk-listing-row">
                            <span><b>{l.qty}</b> edition{l.qty > 1 ? "s" : ""} @ <b>{ethStr(l.unit)} ETH</b></span>
                            <span className="tk-seller">seller {l.seller.slice(0, 6)}…{l.seller.slice(-4)}</span>
                            {mine ? (
                              <span className="tk-own-actions">
                                <span className="tk-yours">your listing</span>
                                <button
                                  className="buy tk-mini tk-ghost"
                                  disabled={updatingListing || cancellingListing}
                                  onClick={() =>
                                    setEditListing(
                                      editListing?.id === l.id
                                        ? null
                                        : { id: l.id, qty: String(l.qty), price: formatEther(l.unit) },
                                    )
                                  }
                                >
                                  {editListing?.id === l.id ? "CLOSE" : "EDIT"}
                                </button>
                                <button className="buy tk-mini tk-danger" disabled={cancellingListing} onClick={() => onCancelListing(l.id)}>
                                  {cancellingListing ? "…" : "CANCEL"}
                                </button>
                              </span>
                            ) : (
                              <button className="buy tk-mini" disabled={buyingListing} onClick={() => onBuyListing(l)}>
                                {buyingListing ? "…" : "BUY"}
                              </button>
                            )}
                          </div>
                          {mine && editListing?.id === l.id && (
                            <div className="tk-row tk-edit-row">
                              <input
                                type="number" min={1} step={1} value={editListing.qty}
                                onChange={(e) => setEditListing({ ...editListing, qty: e.target.value })}
                                placeholder="qty"
                              />
                              <input
                                type="number" min={0} step="0.001" value={editListing.price}
                                onChange={(e) => setEditListing({ ...editListing, price: e.target.value })}
                                placeholder="ETH / unit"
                              />
                              <button className="buy tk-mini" disabled={updatingListing} onClick={onUpdateListing}>
                                {updatingListing ? "…" : "SAVE"}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* ---- open offers: buyers can cancel theirs, holders can accept ---- */}
                <div className="tk-form">
                  <h4>OPEN OFFERS</h4>
                  {offers.length === 0 ? (
                    <div className="muted-note">No open offers for this token.</div>
                  ) : (
                    <ul className="tk-listings">
                      {offers.map((o) => {
                        const mine = address && o.buyer.toLowerCase() === address.toLowerCase();
                        return (
                          <li key={o.id}>
                            <div className="tk-listing-row">
                              <span><b>{o.qty}</b> edition{o.qty > 1 ? "s" : ""} @ <b>{ethStr(o.unit)} ETH</b> <small className="tk-seller">({ethStr(o.unit * BigInt(o.qty))} ETH total, escrowed)</small></span>
                              <span className="tk-seller">from {o.buyer.slice(0, 6)}…{o.buyer.slice(-4)}</span>
                              {mine ? (
                                <span className="tk-own-actions">
                                  <span className="tk-yours">your offer</span>
                                  <button className="buy tk-mini tk-danger" disabled={cancellingOffer} onClick={() => onCancelOffer(o)}>
                                    {cancellingOffer ? "…" : "CANCEL"}
                                  </button>
                                </span>
                              ) : ownedQty >= o.qty ? (
                                <button className="buy tk-mini" disabled={accepting} onClick={() => onAcceptOffer(o)}>
                                  {accepting ? "…" : "ACCEPT"}
                                </button>
                              ) : (
                                <span className="tk-yours" title={`You need ${o.qty} edition${o.qty > 1 ? "s" : ""} to accept`}>
                                  need {o.qty} to accept
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="tk-form">
                  <h4>MAKE AN OFFER</h4>
                  <div className="tk-row">
                    <input type="number" min={1} step={1} value={offerQty} onChange={(e) => setOfferQty(e.target.value)} placeholder="qty" />
                    <input type="number" min={0} step="0.001" value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} placeholder="ETH / unit" />
                    <button className="buy tk-mini" disabled={offering} onClick={onMakeOffer}>{offering ? "…" : "OFFER"}</button>
                  </div>
                </div>

                {ownedQty > 0 && (
                  <>
                    <div className="tk-form">
                      <h4>LIST FOR SALE · you own {ownedQty}</h4>
                      <div className="tk-row">
                        <input type="number" min={1} max={ownedQty} step={1} value={listQty} onChange={(e) => setListQty(e.target.value)} placeholder="qty" />
                        <input type="number" min={0} step="0.001" value={listPrice} onChange={(e) => setListPrice(e.target.value)} placeholder="ETH / unit" />
                        <button className="buy tk-mini" disabled={listing} onClick={onList}>{listing ? "…" : "LIST"}</button>
                      </div>
                    </div>
                    <div className="tk-form">
                      <h4>TRANSFER</h4>
                      <div className="tk-row">
                        <input value={xferTo} onChange={(e) => setXferTo(e.target.value)} placeholder="0x recipient…" style={{ flex: 2 }} />
                        <input type="number" min={1} max={ownedQty} step={1} value={xferQty} onChange={(e) => setXferQty(e.target.value)} placeholder="qty" />
                        <button className="buy tk-mini" disabled={transferring} onClick={onTransfer}>{transferring ? "…" : "SEND"}</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </section>
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>

      <style jsx>{`
        .tk-panel { background: var(--card-grad); border: 1px solid var(--card-line, rgba(245,132,38,.25)); border-radius: 12px; padding: 18px; margin-top: 6px; }
        .tk-spark { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
        .tk-spark span { font-family: var(--mono, monospace); font-size: 11px; color: var(--muted, #bec0c2); }
        .tk-history, .tk-listings { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .tk-history li, .tk-listings li { font-family: var(--mono, monospace); font-size: 13px; padding: 8px 10px; border: 1px solid var(--card-line, rgba(245,132,38,.18)); border-radius: 6px; }
        .tk-history li { display: flex; align-items: center; gap: 12px; }
        .tk-listing-row { display: flex; align-items: center; gap: 12px; }
        .tk-own-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
        .tk-own-actions .tk-yours { margin-left: 0; }
        .tk-ghost { background: transparent; }
        .tk-danger { background: transparent; border-color: rgba(255,80,80,.5); color: #ff7070; }
        .tk-danger:hover:not(:disabled) { border-color: #ff5050; background: rgba(255,80,80,.12); }
        .tk-edit-row { margin-top: 8px; }
        .tk-kind { text-transform: uppercase; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 20px; letter-spacing: .05em; }
        .tk-pri { background: rgba(0,107,182,.25); color: #7fc4ff; }
        .tk-sec { background: rgba(245,132,38,.22); color: #ffa052; }
        .tk-qty { color: var(--muted, #bec0c2); }
        .tk-price { font-weight: 700; }
        .tk-date { margin-left: auto; color: var(--muted, #bec0c2); }
        .tk-seller { color: var(--muted, #bec0c2); font-size: 11px; }
        .tk-yours { margin-left: auto; color: var(--crimson-soft, #ffa052); font-size: 11px; }
        .tk-listings li > span:first-child { flex: 1; }
        .tk-listings .tk-mini { margin-left: auto; }
        .tk-form { margin-top: 16px; }
        .tk-form h4 { font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .08em; color: var(--muted, #bec0c2); margin: 0 0 8px; text-transform: uppercase; }
        .tk-row { display: flex; gap: 8px; align-items: stretch; }
        .tk-row input { flex: 1; background: transparent; border: 1.5px solid rgba(245,132,38,.45); color: var(--ink, #fff); font-family: var(--mono, monospace); font-size: 13px; padding: 9px 10px; border-radius: 3px; outline: none; }
        .tk-row input:focus { border-color: var(--crimson, #f58426); box-shadow: var(--glow); }
        .tk-mini { width: auto; padding: 9px 16px; font-size: 12px; }
        .tk-onchain { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0; }
        .tk-onchain li { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-family: var(--mono, monospace); font-size: 13px; padding: 9px 2px; border-bottom: 1px solid var(--card-line, rgba(245,132,38,.12)); }
        .tk-onchain li:last-child { border-bottom: none; }
        .tk-onchain li > span:first-child { color: var(--muted, #bec0c2); text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }
        .tk-onchain a, .tk-onchain b { color: var(--ink, #fff); font-weight: 700; text-decoration: none; }
        .tk-onchain a:hover { color: var(--crimson-soft, #ffa052); }
        .tk-explorer-link { display: inline-block; margin-top: 14px; font-family: var(--mono, monospace); font-size: 12px; color: var(--crimson-soft, #ffa052); text-decoration: none; border: 1px solid rgba(245,132,38,.35); border-radius: 6px; padding: 9px 12px; transition: .2s; }
        .tk-explorer-link:hover { background: rgba(245,132,38,.12); border-color: var(--crimson, #f58426); }
      `}</style>
    </div>
  );
}
