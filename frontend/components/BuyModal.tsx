"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CoverArt } from "@/lib/art";
import { api, type Track } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBuyTrack } from "@/lib/useBuyTrack";
import { useUsdRate, usd } from "@/lib/usd";

/**
 * Payment-method chooser. BUY buttons open this instead of demanding a wallet:
 *  - 💳 card (Stripe, USD): NO wallet needed. Connected users get automatic
 *    delivery to their wallet; guests just pay and claim afterwards.
 *  - Ξ crypto (on-chain): connect → sign in → buy, all inside the modal.
 * Rendered through a portal to <body> — cards live inside transformed
 * containers (marquee, hover lift) which would otherwise trap the fixed
 * overlay and break its positioning.
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
  const [fiatEnabled, setFiatEnabled] = useState<boolean | null>(null);
  const [customAddr, setCustomAddr] = useState(false);
  const [deliverTo, setDeliverTo] = useState("");
  const [cardBusy, setCardBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) api.fiatStatus().then((d) => setFiatEnabled(d.enabled)).catch(() => setFiatEnabled(false));
  }, [open]);

  // lock page scroll while the modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // reset transient state each time the modal opens
  useEffect(() => {
    if (open) { setCustomAddr(false); setDeliverTo(""); setCardBusy(false); }
  }, [open]);

  if (!mounted || !open || !track) return null;

  const priceUsd = usd(track.priceWei, rate);
  const onChain = track.chainTokenId != null;
  const customOk = /^0x[a-fA-F0-9]{40}$/.test(deliverTo.trim());
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  async function payCard() {
    setCardBusy(true);
    try {
      const deliveryAddress = customAddr
        ? deliverTo.trim()
        : (isConnected && address ? address : undefined); // guests: pay now, claim after
      const { url } = await api.fiatCheckout({ trackId: track!.id, qty: 1, deliveryAddress });
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

  const cardDisabled = cardBusy || (customAddr && !customOk);

  return createPortal(
    <div className="bm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Choose payment method">
      <div className="bm-panel" onClick={(e) => e.stopPropagation()}>
        <button className="bm-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="bm-head">
          <div className="bm-cover"><CoverArt seed={track.coverSeed} /></div>
          <div className="bm-meta">
            <b>{track.title}</b>
            <span>by {track.artist.handle} · {track.left} of {track.maxSupply} left</span>
            <em>{priceUsd ?? "…"}</em>
          </div>
        </div>

        {!onChain ? (
          <div className="muted-note">This track isn’t on-chain yet, so it can’t be purchased.</div>
        ) : track.left === 0 ? (
          <div className="muted-note">Sold out — check the track page for listings and offers.</div>
        ) : (
          <>
            {fiatEnabled !== false && (
              <div className="bm-opt">
                <h4>💳 PAY WITH CARD <i>USD</i></h4>
                {fiatEnabled === null ? (
                  <p>Checking card availability…</p>
                ) : (
                  <>
                    <p>
                      {isConnected && !customAddr
                        ? <>Checkout with Stripe. Your editions are delivered on-chain to your wallet <b className="bm-addr">{shortAddr}</b> (~1 min after payment).</>
                        : customAddr
                          ? <>Editions will be delivered to the address below.</>
                          : <>Checkout with Stripe — <b>no wallet needed</b>. Pay now, then claim your editions to any wallet afterwards (we hold them safely until you do).</>}
                    </p>
                    {customAddr && (
                      <input
                        value={deliverTo}
                        onChange={(e) => setDeliverTo(e.target.value)}
                        placeholder="0x wallet address to receive the editions"
                        spellCheck={false}
                        autoFocus
                      />
                    )}
                    <button className="buy" disabled={cardDisabled} onClick={payCard}>
                      {cardBusy ? "OPENING CHECKOUT…" : `PAY ${priceUsd ?? "WITH CARD"}`}
                    </button>
                    <button className="bm-link" onClick={() => setCustomAddr((v) => !v)}>
                      {customAddr ? "← back" : "deliver to a specific wallet address instead"}
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="bm-opt">
              <h4>Ξ PAY WITH CRYPTO <i>on-chain</i></h4>
              <p>Buy directly from your wallet ({priceUsd ?? "…"}, plus a small network fee).</p>
              {!isConnected ? (
                <button className="buy" onClick={() => openConnectModal?.()}>CONNECT WALLET</button>
              ) : !token ? (
                <button className="buy" disabled={loading} onClick={() => void signIn()}>
                  {loading ? "SIGNING…" : "SIGN IN WITH WALLET"}
                </button>
              ) : (
                <button className="buy" disabled={busy} onClick={payCrypto}>
                  {busy ? "CONFIRMING…" : `BUY NOW · ${priceUsd ?? "…"}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
