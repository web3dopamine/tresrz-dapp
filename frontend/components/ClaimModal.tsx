"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { api } from "@/lib/api";

type OrderInfo = Awaited<ReturnType<typeof api.fiatOrder>>;

/**
 * Shown after a guest card payment (success redirect carries session_id).
 * The editions are held by the platform — the buyer claims them to their
 * connected wallet or to a pasted address. Portaled to <body>.
 */
export default function ClaimModal({
  sessionId, onClose, toast, onClaimed,
}: {
  sessionId: string;
  onClose: () => void;
  toast: (m: string) => void;
  onClaimed?: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [addr, setAddr] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // poll while the webhook is still processing the payment
  useEffect(() => {
    let alive = true;
    let timer: any;
    const load = async () => {
      try {
        const o = await api.fiatOrder(sessionId);
        if (!alive) return;
        setOrder(o);
        // keep polling until the order is claimable (held) or finished
        if (o.status === "processing") timer = setTimeout(load, 4000);
      } catch {
        if (alive) timer = setTimeout(load, 7000);
      }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [sessionId]);

  useEffect(() => {
    if (address && !addr) setAddr(address);
  }, [address, addr]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!mounted) return null;

  const addrOk = /^0x[a-fA-F0-9]{40}$/.test(addr.trim());

  async function claim() {
    if (!addrOk) return toast("Enter a valid 0x wallet address");
    setClaiming(true);
    try {
      const res = await api.fiatClaim({ sessionId, address: addr.trim() });
      setDone(res.deliveredTo);
      toast("🎉 Editions delivered to your wallet");
      onClaimed?.();
    } catch (e: any) {
      toast(e?.message || "Claim failed — try again");
    } finally {
      setClaiming(false);
    }
  }

  const body = (() => {
    if (order?.status === "refunded") {
      return (
        <>
          <h3 className="cm-title">Order refunded</h3>
          <p className="cm-text">This edition sold out before we could fulfill your order, so your card was refunded in full. No editions were delivered.</p>
          <button className="buy" onClick={onClose}>CLOSE</button>
        </>
      );
    }
    // processing OR delivering (both surface as "processing") -> spinner, keep polling
    if (!order || order.status === "processing") {
      return (
        <>
          <h3 className="cm-title">💳 Payment received</h3>
          <p className="cm-text">Finalizing your purchase on-chain — this usually takes under a minute…</p>
          <div className="cm-spinner" aria-hidden />
        </>
      );
    }
    if (done || order.status === "delivered") {
      const to = done || order.deliveredTo || "";
      return (
        <>
          <h3 className="cm-title">🎉 You own it!</h3>
          <p className="cm-text">
            {order.qty ?? 1} edition{(order.qty ?? 1) > 1 ? "s" : ""} of <b>{order.track?.title}</b> delivered to{" "}
            <b className="bm-addr">{to.slice(0, 6)}…{to.slice(-4)}</b>. Full-track streaming is unlocked for that wallet.
          </p>
          <button className="buy" onClick={onClose}>DONE</button>
        </>
      );
    }
    // held -> claim UI
    return (
      <>
        <h3 className="cm-title">💳 Payment complete — claim your music</h3>
        <p className="cm-text">
          Your {order.qty ?? 1} edition{(order.qty ?? 1) > 1 ? "s" : ""} of <b>{order.track?.title}</b> {(order.qty ?? 1) > 1 ? "are" : "is"} secured and held for you.
          Choose the wallet that should own {(order.qty ?? 1) > 1 ? "them" : "it"}:
        </p>
        {!isConnected && (
          <button className="buy cm-alt" onClick={() => openConnectModal?.()}>CONNECT A WALLET</button>
        )}
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x wallet address"
          spellCheck={false}
        />
        <button className="buy" disabled={claiming || !addrOk} onClick={claim}>
          {claiming ? "DELIVERING ON-CHAIN…" : "CLAIM MY EDITIONS"}
        </button>
        <p className="cm-hint">No rush — this page’s link keeps working, and we hold the editions until you claim them.</p>
      </>
    );
  })();

  return createPortal(
    <div className="bm-overlay" onClick={() => (done || order?.status === "delivered") && onClose()}>
      <div className="bm-panel cm-panel" onClick={(e) => e.stopPropagation()}>
        <button className="bm-close" onClick={onClose} aria-label="Close">✕</button>
        {body}
      </div>
    </div>,
    document.body,
  );
}
