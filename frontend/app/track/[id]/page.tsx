"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatEther } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import Header from "@/components/Header";
import WaveformPlayer from "@/components/WaveformPlayer";
import BuyModal from "@/components/BuyModal";
import ClaimModal from "@/components/ClaimModal";
import { CoverArt, avatarUrl } from "@/lib/art";
import { api, type Track, type SaleHistory } from "@/lib/api";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { marketAbi, MARKET_CONTRACT } from "@/lib/marketAbi";
import { useAuth } from "@/lib/auth";
import { useUsdRate, usd } from "@/lib/usd";

// Block explorer for the active chain (used for on-chain provenance links).
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN || 31337);
const EXPLORER =
  CHAIN_ID === 11155111 ? "https://sepolia.etherscan.io"
  : CHAIN_ID === 1 ? "https://etherscan.io"
  : "https://explorer.libertychain.org";
const EXPLORER_NAME = CHAIN_ID === 11155111 ? "Sepolia Etherscan" : CHAIN_ID === 1 ? "Etherscan" : "the explorer";
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
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
    const v = Number(formatEther(typeof wei === "bigint" ? wei : BigInt(wei)));
    if (v > 0 && v < 0.01) return String(parseFloat(v.toPrecision(2))); // never round dust to "0.000"
    return String(parseFloat(v.toFixed(dp)));
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
  const [offerPrice, setOfferPrice] = useState("25"); // USD
  const [listQty, setListQty] = useState("1");
  const [listPrice, setListPrice] = useState("25"); // USD
  const [xferTo, setXferTo] = useState("");
  const [xferQty, setXferQty] = useState("1");
  // inline edit of one of your own listings: null = closed
  const [editListing, setEditListing] = useState<{ id: number; qty: string; price: string } | null>(null);
  // opensea-style layout state: right-column tab + inline make-offer form
  const [tab, setTab] = useState<"details" | "orders" | "activity">("details");
  const [showOffer, setShowOffer] = useState(false);
  // USD pricing + buy modal (card / crypto chooser)
  const rate = useUsdRate();
  const [buyOpen, setBuyOpen] = useState(false);
  // Stripe success redirect -> claim/status modal driven by the session id
  const [claimSession, setClaimSession] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const fiat = p.get("fiat");
    if (!fiat) return;
    const sid = p.get("session_id");
    window.history.replaceState({}, "", window.location.pathname);
    if (fiat === "success" && sid) {
      setClaimSession(sid); // modal handles processing/held/delivered states
    } else if (fiat === "cancelled") {
      toast("Card checkout cancelled");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2400); }

  function load() {
    api.track(id).then((t) => { setTrack(t); setState("ready"); }).catch(() => setState("missing"));
    api.history(id).then(setHistory).catch(() => setHistory([]));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // while a track is still publishing (IPFS + on-chain, in the background), poll until it's live
  const minting = (track?.mintStatus === "minting" || track?.mintStatus === "publishing") && track?.chainTokenId == null;
  useEffect(() => {
    if (!minting) return;
    const iv = setInterval(() => { api.track(id).then((t) => setTrack(t)).catch(() => {}); }, 6000);
    return () => clearInterval(iv);
  }, [minting, id]);

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
    toast(res.warn ? `⚠ ${res.warn}` : `Offer accepted — ${usd(o.unit * BigInt(o.qty), rate) ?? "payment"} received ✓`);
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

  // Prices are entered in USD; the on-chain market is ETH-denominated, so convert
  // at the live rate right before the tx. ETH never surfaces in the UI.
  function usdInputToEth(usdStr: string): string | null {
    if (!rate) return null;
    const u = Number(usdStr);
    if (!Number.isFinite(u) || u < 0) return null;
    return (u / rate).toString();
  }

  async function onUpdateListing() {
    if (!editListing) return;
    const ethStr = usdInputToEth(editListing.price);
    if (ethStr == null) return toast("Price unavailable for a moment — try again");
    const res = await updateListing(editListing.id, Number(editListing.qty) || 1, ethStr);
    if (!res.ok) return toast(res.error);
    setEditListing(null);
    toast("Listing updated ✓");
    refreshChain();
  }

  async function onMakeOffer() {
    if (chainTokenId == null) return toast("Track not yet on-chain");
    const ethStr = usdInputToEth(offerPrice);
    if (ethStr == null) return toast("Price unavailable for a moment — try again");
    const res = await makeOffer(chainTokenId, Number(offerQty) || 1, ethStr);
    if (!res.ok) return toast(res.error);
    toast("Offer submitted ✓");
    refreshChain();
  }

  async function onList() {
    if (chainTokenId == null) return toast("Track not yet on-chain");
    const ethStr = usdInputToEth(listPrice);
    if (ethStr == null) return toast("Price unavailable for a moment — try again");
    const res = await list(chainTokenId, Number(listQty) || 1, ethStr);
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
  // opensea-style stat strip: best open offer + most recent sale price
  const topOffer = useMemo(
    () => offers.reduce<bigint | null>((m, o) => (m === null || o.unit > m ? o.unit : m), null),
    [offers],
  );
  const lastSale = history.length ? history[history.length - 1].unitWei : null;
  const ordersCount = listings.length + offers.length;

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        {state === "loading" && <div className="muted-note">Loading track…</div>}
        {state === "missing" && (
          <div className="muted-note">Track not found. <Link href="/" style={{ color: "var(--crimson-soft)" }}>← Back home</Link></div>
        )}
        {state === "ready" && track && (
          <div className="os-grid">
            {/* ---- left: sticky media (cover + player) ---- */}
            <div className="os-media">
              <div className="detail-cover">
                <CoverArt seed={track.coverSeed} url={track.coverUrl} />
                <div className="genre">{track.genre}</div>
              </div>
              <WaveformPlayer track={track} />
            </div>

            {/* ---- right: info column ---- */}
            <div className="os-info">
              <h1 className="detail-title">{track.title}</h1>
              <div className="os-byline">
                <Link href={`/artist/${track.artist.address}`} className="detail-artist">
                  <img src={avatarUrl(track.artist.avatarSeed)} alt="" />
                  <span>by <b>{track.artist.handle}</b></span>
                </Link>
                {ownedQty > 0 && <span className="os-owned">YOU OWN {ownedQty}</span>}
              </div>
              <div className="os-chips">
                <span>ERC-1155</span>
                <span>{CHAIN_ID === 11155111 ? "SEPOLIA" : CHAIN_ID === 1 ? "ETHEREUM" : "LIBERTY"}</span>
                <span>TOKEN #{track.chainTokenId ?? "—"}</span>
                <span>{track.genre}</span>
              </div>

              {/* stat strip: top offer / last sale / left / royalty */}
              <div className="os-statbar">
                <div><span>TOP OFFER</span><b>{topOffer !== null ? (usd(topOffer, rate) ?? "…") : "—"}</b></div>
                <div><span>LAST SALE</span><b>{lastSale ? (usd(lastSale, rate) ?? "…") : "—"}</b></div>
                <div><span>EDITIONS LEFT</span><b>{track.left} / {track.maxSupply}</b></div>
                <div><span>ROYALTY</span><b>{chainInfo?.royaltyPct != null ? `${chainInfo.royaltyPct}%` : "—"}</b></div>
              </div>

              {/* buy panel */}
              <div className="os-buybox">
                {minting && <div className="os-minting">⏳ Finalizing on-chain — this track becomes buyable in a few seconds…</div>}
                <span className="os-buy-label">BUY FOR</span>
                <div className="os-price">{usd(track.priceWei, rate) ?? "…"}</div>
                <div className="os-buy-actions">
                  <button className="buy os-buynow" disabled={track.left === 0 || minting} onClick={() => setBuyOpen(true)}>
                    {minting ? "FINALIZING…" : track.left === 0 ? "SOLD OUT" : "BUY NOW"}
                  </button>
                  <button
                    className="os-makeoffer"
                    disabled={chainTokenId == null}
                    onClick={() => setShowOffer((v) => !v)}
                  >
                    {showOffer ? "CLOSE" : "MAKE OFFER"}
                  </button>
                  <button className={`heart detail-heart${track.liked ? " liked" : ""}`} disabled={liking} onClick={onLike} aria-label="like">
                    <svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-8.5C1 9 3 5.5 6.5 5.5c2 0 3.5 1.3 5.5 3 2-1.7 3.5-3 5.5-3C21 5.5 23 9 21.5 12.5 19 16.5 12 21 12 21z" /></svg>
                    <small>{track.likes}</small>
                  </button>
                </div>
                {showOffer && (
                  <div className="tk-row os-offer-row">
                    <input type="number" min={1} step={1} value={offerQty} onChange={(e) => setOfferQty(e.target.value)} placeholder="qty" />
                    <input type="number" min={0} step="0.01" value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} placeholder="USD / unit" />
                    <button className="buy tk-mini" disabled={offering} onClick={onMakeOffer}>{offering ? "…" : "SUBMIT OFFER"}</button>
                  </div>
                )}
              </div>

              {/* tabs: details / orders / activity */}
              <div className="os-tabs" role="tablist">
                <button role="tab" aria-selected={tab === "details"} className={`os-tab${tab === "details" ? " active" : ""}`} onClick={() => setTab("details")}>DETAILS</button>
                <button role="tab" aria-selected={tab === "orders"} className={`os-tab${tab === "orders" ? " active" : ""}`} onClick={() => setTab("orders")}>ORDERS{ordersCount > 0 ? ` (${ordersCount})` : ""}</button>
                <button role="tab" aria-selected={tab === "activity"} className={`os-tab${tab === "activity" ? " active" : ""}`} onClick={() => setTab("activity")}>ACTIVITY{history.length > 0 ? ` (${history.length})` : ""}</button>
              </div>

              {/* ---- DETAILS tab: traits grid + on-chain list ---- */}
              {tab === "details" && (
                <>
                  {/* metadata traits (OpenSea-style, with collection rarity) */}
                  {track.attributes && track.attributes.length > 0 && (
                    <>
                      <div className="os-sub">TRAITS</div>
                      <div className="os-attrs">
                        {track.attributes.map((a, i) => (
                          <div key={i} className="os-attr">
                            <span className="os-attr-type">{a.trait_type}</span>
                            <b className="os-attr-val" title={String(a.value)}>{String(a.value)}</b>
                            {(a.pct != null || a.frequency) && (
                              <span className="os-attr-rare">{a.pct != null ? `${a.pct}% have this` : a.frequency}</span>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="os-sub" style={{ marginTop: 18 }}>DETAILS</div>
                    </>
                  )}
                  <div className="os-traits">
                    <div className="os-trait"><span>GENRE</span><b>{track.genre}</b></div>
                    <div className="os-trait"><span>EDITION SIZE</span><b>{track.maxSupply}</b></div>
                    <div className="os-trait"><span>MINTED</span><b>{track.minted}</b></div>
                    <div className="os-trait"><span>ROYALTY</span><b>{chainInfo?.royaltyPct != null ? `${chainInfo.royaltyPct}%` : "—"}</b></div>
                    <div className="os-trait"><span>FULL AUDIO</span><b>{track.hasFullAudio ? "TOKEN-GATED" : "—"}</b></div>
                    <div className="os-trait"><span>STATUS</span><b>{chainInfo ? (chainInfo.active ? "ACTIVE" : "INACTIVE") : "—"}</b></div>
                  </div>
                  {chainTokenId == null ? (
                    <div className="muted-note">This track isn’t on-chain yet.</div>
                  ) : (
                    <div className="tk-panel os-panel">
                      <ul className="tk-onchain">
                        <li><span>Contract</span><a href={`${EXPLORER}/address/${MUSIC_CONTRACT}`} target="_blank" rel="noreferrer">{shortAddr(MUSIC_CONTRACT)} ↗</a></li>
                        <li><span>Token ID</span><a href={`${EXPLORER}/token/${MUSIC_CONTRACT}?a=${chainTokenId}`} target="_blank" rel="noreferrer">#{chainTokenId} ↗</a></li>
                        <li><span>Token standard</span><b>ERC-1155</b></li>
                        {chainInfo && <li><span>Creator</span><Link href={`/artist/${chainInfo.artist}`}>{shortAddr(chainInfo.artist)}</Link></li>}
                        {track.createdAt && <li><span>Published</span><b>{new Date(track.createdAt).toLocaleString()}</b></li>}
                        {track.txHash && <li><span>Publish tx</span><a href={`${EXPLORER}/tx/${track.txHash}`} target="_blank" rel="noreferrer">{track.txHash.slice(0, 10)}… ↗</a></li>}
                      </ul>
                      <a className="tk-explorer-link" href={`${EXPLORER}/token/${MUSIC_CONTRACT}?a=${chainTokenId}`} target="_blank" rel="noreferrer">
                        View publish &amp; full transfer history on {EXPLORER_NAME} ↗
                      </a>
                    </div>
                  )}
                </>
              )}

              {/* ---- ACTIVITY tab: price history ---- */}
              {tab === "activity" && (
                history.length === 0 ? (
                  <div className="muted-note">No sales recorded yet.</div>
                ) : (
                  <div className="tk-panel os-panel">
                    {sparkPoints.length >= 2 && (
                      <div className="tk-spark"><Sparkline points={sparkPoints} /><span>unit price trend</span></div>
                    )}
                    <ul className="tk-history">
                      {history.map((h, i) => (
                        <li key={i}>
                          <span className={`tk-kind tk-${h.kind.includes("primary") ? "pri" : "sec"}`}>{h.kind.replace("secondary_", "").replace("fiat_primary", "card")}</span>
                          <span className="tk-qty">×{h.qty}</span>
                          <span className="tk-price">{usd(h.unitWei, rate) ?? "…"}</span>
                          <span className="tk-date">{new Date(h.at).toLocaleDateString()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}

              {/* ---- ORDERS tab: listings + offers + owner forms ---- */}
              {tab === "orders" && (chainTokenId == null ? (
                <div className="muted-note">This track isn’t on-chain yet, so it can’t be traded.</div>
              ) : (
                <div className="tk-panel os-panel">
                  <h4 className="os-sub">LISTINGS</h4>
                {listings.length === 0 ? (
                  <div className="muted-note">No active listings for this token.</div>
                ) : (
                  <ul className="tk-listings">
                    {listings.map((l) => {
                      const mine = address && l.seller.toLowerCase() === address.toLowerCase();
                      return (
                        <li key={l.id} className={editListing?.id === l.id ? "tk-editing" : undefined}>
                          <div className="tk-listing-row">
                            <span><b>{l.qty}</b> edition{l.qty > 1 ? "s" : ""} @ <b>{usd(l.unit, rate) ?? "…"}</b></span>
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
                                        : { id: l.id, qty: String(l.qty), price: rate ? (Number(formatEther(l.unit)) * rate).toFixed(2) : "" },
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
                                type="number" min={0} step="0.01" value={editListing.price}
                                onChange={(e) => setEditListing({ ...editListing, price: e.target.value })}
                                placeholder="USD / unit"
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
                              <span><b>{o.qty}</b> edition{o.qty > 1 ? "s" : ""} @ <b>{usd(o.unit, rate) ?? "…"}</b> <small className="tk-seller">({usd(o.unit * BigInt(o.qty), rate) ?? "…"} total, escrowed)</small></span>
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

                {ownedQty > 0 && (
                  <>
                    <div className="tk-form">
                      <h4>LIST FOR SALE · you own {ownedQty}</h4>
                      <div className="tk-row">
                        <input type="number" min={1} max={ownedQty} step={1} value={listQty} onChange={(e) => setListQty(e.target.value)} placeholder="qty" />
                        <input type="number" min={0} step="0.01" value={listPrice} onChange={(e) => setListPrice(e.target.value)} placeholder="USD / unit" />
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
              ))}
            </div>
          </div>
        )}
      </section>
      <BuyModal
        track={track}
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        toast={toast}
        onBought={() => { refreshChain(); }}
      />
      {claimSession && (
        <ClaimModal
          sessionId={claimSession}
          onClose={() => { setClaimSession(null); refreshChain(); }}
          toast={toast}
          onClaimed={() => { refreshChain(); }}
        />
      )}
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>

      <style jsx>{`
        /* ---- opensea-style two-column item layout ---- */
        .os-grid { display: grid; grid-template-columns: minmax(320px, 460px) 1fr; gap: 36px; align-items: start; }
        .os-media { position: sticky; top: 86px; display: flex; flex-direction: column; }
        .os-info { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        .os-byline { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .os-owned { font-family: var(--mono, monospace); font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--crimson-soft, #ffa052); border: 1px solid var(--card-line); border-radius: 14px; padding: 4px 10px; }
        .os-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .os-chips span { font-family: var(--mono, monospace); font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--muted, #bec0c2); background: var(--panel-bg); border: 1px solid var(--card-line); border-radius: 4px; padding: 5px 9px; }
        .os-statbar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; background: var(--card-grad); border: 1px solid var(--card-line); border-radius: 12px; padding: 14px 4px; }
        .os-statbar > div { display: flex; flex-direction: column; gap: 4px; padding: 0 14px; border-right: 1px solid var(--line-soft); min-width: 0; }
        .os-statbar > div:last-child { border-right: none; }
        .os-statbar span { font-family: var(--mono, monospace); font-size: 9px; letter-spacing: 1.2px; color: var(--muted, #bec0c2); white-space: nowrap; }
        .os-statbar b { font-size: 14px; color: var(--ink, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .os-buybox { background: var(--card-grad); border: 1px solid var(--card-line); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
        .os-buy-label { font-family: var(--mono, monospace); font-size: 10px; letter-spacing: 1.5px; color: var(--muted, #bec0c2); }
        .os-price { font-family: var(--display, sans-serif); font-size: 40px; line-height: 1; color: var(--ink, #fff); letter-spacing: 1px; }
        .os-price small { font-family: var(--mono, monospace); font-size: 15px; color: var(--muted, #bec0c2); letter-spacing: 0; }
        .os-buy-actions { display: flex; align-items: stretch; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
        .os-buynow { flex: 2 1 160px; padding: 14px 20px; font-size: 13px; margin-top: 0; }
        .os-makeoffer { flex: 1 1 120px; font-family: var(--mono, monospace); font-weight: 700; font-size: 12px; letter-spacing: 1.5px; color: var(--ink, #fff); background: transparent; border: 1.5px solid var(--card-line); border-radius: 4px; padding: 14px 16px; cursor: pointer; transition: .2s; }
        .os-makeoffer:hover:not(:disabled) { border-color: var(--crimson, #f58426); box-shadow: var(--glow); }
        .os-makeoffer:disabled { opacity: .5; cursor: not-allowed; }
        .os-card { border-color: var(--crimson, #f58426); color: var(--crimson-soft, #ffa052); }
        .os-minting { font-family: var(--mono, monospace); font-size: 11.5px; color: var(--crimson-soft, #ffa052); background: rgba(245,132,38,.1); border: 1px solid var(--card-line); border-radius: 8px; padding: 9px 11px; margin-bottom: 10px; }
        .os-offer-row { margin-top: 6px; }
        .os-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-top: 6px; }
        .os-tab { font-family: var(--mono, monospace); font-weight: 700; font-size: 12px; letter-spacing: 1.5px; color: var(--muted, #bec0c2); background: none; border: none; border-bottom: 2.5px solid transparent; padding: 11px 14px; cursor: pointer; transition: .2s; }
        .os-tab:hover { color: var(--ink, #fff); }
        .os-tab.active { color: var(--ink, #fff); border-bottom-color: var(--crimson, #f58426); }
        .os-traits { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
        .os-trait { background: var(--panel-bg); border: 1px solid var(--card-line); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
        .os-trait span { font-family: var(--mono, monospace); font-size: 9px; letter-spacing: 1.2px; color: var(--crimson-soft, #ffa052); }
        .os-trait b { font-size: 13px; color: var(--ink, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .os-panel { margin-top: 0; }
        .os-sub { font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .08em; color: var(--muted, #bec0c2); margin: 0 0 8px; text-transform: uppercase; }
        .os-attrs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 4px; }
        .os-attr { background: rgba(245,132,38,.07); border: 1px solid var(--card-line); border-radius: 10px; padding: 11px 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; text-align: center; align-items: center; }
        .os-attr-type { font-family: var(--mono, monospace); font-size: 9px; letter-spacing: 1px; color: var(--crimson-soft, #ffa052); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .os-attr-val { font-size: 13px; color: var(--ink, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .os-attr-rare { font-family: var(--mono, monospace); font-size: 10px; color: var(--muted, #bec0c2); }
        @media (max-width: 900px) {
          .os-grid { grid-template-columns: 1fr; gap: 22px; }
          .os-media { position: static; }
          .os-statbar { grid-template-columns: repeat(2, 1fr); row-gap: 14px; }
          .os-statbar > div:nth-child(2) { border-right: none; }
          .os-price { font-size: 32px; }
        }
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
        @media (max-width: 640px) {
          .tk-panel { padding: 14px; }
          .tk-listing-row { flex-wrap: wrap; row-gap: 8px; }
          .tk-listing-row > span:first-child { flex: 1 1 100%; }
          .tk-own-actions { margin-left: 0; width: 100%; justify-content: flex-end; }
          .tk-listings .tk-mini { margin-left: auto; }
          .tk-row { flex-wrap: wrap; }
          .tk-row input { flex: 1 1 40%; min-width: 110px; }
          .tk-row .tk-mini { flex: 1 1 100%; }
          .tk-onchain li { flex-wrap: wrap; row-gap: 2px; }
          .tk-onchain a, .tk-onchain b { word-break: break-all; text-align: right; }
          .tk-history li { flex-wrap: wrap; row-gap: 4px; }
          .tk-spark { flex-wrap: wrap; }
        }
      `}</style>
    </div>
  );
}
