"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CoverArt } from "@/lib/art";
import { api, type Track } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBuyTrack } from "@/lib/useBuyTrack";
import { useUsdRate, usd } from "@/lib/usd";

/**
 * Payment-method chooser. BUY buttons open this instead of demanding a wallet:
 *  - 💳 card (Stripe, USD): no wallet connection needed — just a delivery address
 *  - Ξ crypto (on-chain): connect → sign in → buy, all inside the modal
 */
export default function BuyModal({
  track, open, onClose, toast, onBought,
}: {
  track: Track | null;
  open: boolean;
  onClose: () => void;
  toast: (m: string) => void;
  onBought?: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { token, signIn, loading } = useAuth();
  const { buy, busy } = useBuyTrack();
  const rate = useUsdRate();
  const [fiatEnabled, setFiatEnabled] = useState(false);
  const [deliverTo, setDeliverTo] = useState("");
  const [cardBusy, setCardBusy] = useState(false);

  useEffect(() => {
    if (open) api.fiatStatus().then((d) => setFiatEnabled(d.enabled)).catch(() => {});
  }, [open]);
  useEffect(() => {
    if (address) setDeliverTo((v) => (v ? v : address));
  }, [address]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !track) return null;

  const priceEth = (() => { try { return Number(BigInt(track.priceWei)) / 1e18; } catch { return 0; } })();
  const priceUsd = usd(track.priceWei, rate);
  const addrOk = /^0x[a-fA-F0-9]{40}$/.test(deliverTo.trim());
  const onChain = track.chainTokenId != null;

  async function payCard() {
    if (!addrOk) return toast("Enter the 0x wallet address that should receive the editions");
    setCardBusy(true);
    try {
      const { url } = await api.fiatCheckout({ trackId: track!.id, qty: 1, deliveryAddress: deliverTo.trim() });
      window.location.href = url;
    } catch (e: any) {
      toast(e?.message || "Could not start card checkout");
      setCardBusy(false);
    }
  }

  async function payCrypto() {
    const res = await buy(track!);
    if (!res.ok) return toast(res.error);
    toast(res.warn ? `⚠ ${res.warn}` : `Bought ${track!.title} ✓`);
    onClose();
    onBought?.();
  }

  return (
    <div className="bm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Choose payment method">
      <div className="bm-panel" onClick={(e) => e.stopPropagation()}>
        <button className="bm-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="bm-head">
          <div className="bm-cover"><CoverArt seed={track.coverSeed} /></div>
          <div className="bm-meta">
            <b>{track.title}</b>
            <span>by {track.artist.handle} · {track.left} of {track.maxSupply} left</span>
            <em>{priceUsd ?? `${priceEth.toFixed(3)} ETH`}{priceUsd && <small> · {priceEth.toFixed(3)} ETH</small>}</em>
          </div>
        </div>

        {!onChain ? (
          <div className="muted-note">This track isn’t on-chain yet, so it can’t be purchased.</div>
        ) : track.left === 0 ? (
          <div className="muted-note">Sold out — check the track page for listings and offers.</div>
        ) : (
          <>
            {fiatEnabled && (
              <div className="bm-opt">
                <h4>💳 PAY WITH CARD <i>USD</i></h4>
                <p>Checkout with Stripe — no crypto or wallet app needed. Your editions are delivered on-chain to the address below (~1 min after payment).</p>
                <input
                  value={deliverTo}
                  onChange={(e) => setDeliverTo(e.target.value)}
                  placeholder="0x delivery wallet address"
                  spellCheck={false}
                />
                <button className="buy" disabled={cardBusy || !addrOk} onClick={payCard}>
                  {cardBusy ? "OPENING CHECKOUT…" : `PAY ${priceUsd ?? "WITH CARD"}`}
                </button>
              </div>
            )}

            <div className="bm-opt">
              <h4>Ξ PAY WITH CRYPTO <i>ETH</i></h4>
              <p>Buy directly on-chain from your wallet ({priceEth.toFixed(3)} ETH + gas).</p>
              {!isConnected ? (
                <button className="buy" onClick={() => openConnectModal?.()}>CONNECT WALLET</button>
              ) : !token ? (
                <button className="buy" disabled={loading} onClick={() => void signIn()}>
                  {loading ? "SIGNING…" : "SIGN IN WITH WALLET"}
                </button>
              ) : (
                <button className="buy" disabled={busy} onClick={payCrypto}>
                  {busy ? "CONFIRMING…" : `BUY NOW · ${priceEth.toFixed(3)} ETH`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
