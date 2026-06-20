"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import Header from "@/components/Header";
import { CoverArt, avatarUrl } from "@/lib/art";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { api, type Track } from "@/lib/api";
import { useTransfer } from "@/lib/useMarket";

export default function CollectionPage() {
  const { address, isConnected } = useAccount();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadedTracks, setLoadedTracks] = useState(false);
  const [msg, setMsg] = useState("");
  const tRef = useRef<any>(null);
  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2400); }

  // inline transfer state, keyed by tokenId
  const [xfer, setXfer] = useState<{ tokenId: number; to: string; qty: string } | null>(null);
  const { transfer, busy: transferring } = useTransfer();

  useEffect(() => { api.tracks().then((d) => { setTracks(d); setLoadedTracks(true); }).catch(() => setLoadedTracks(true)); }, []);

  const { data: nextId } = useReadContract({ abi: musicAbi, address: MUSIC_CONTRACT, functionName: "nextTrackId" });
  const maxId = nextId ? Number(nextId) - 1 : 0;

  const balanceCalls = useMemo(() => {
    if (!address || maxId < 1) return [];
    return Array.from({ length: maxId }, (_, i) => ({
      abi: musicAbi, address: MUSIC_CONTRACT, functionName: "balanceOf" as const, args: [address, BigInt(i + 1)] as const,
    }));
  }, [address, maxId]);

  const { data: balances, isLoading: balLoading, refetch: refetchBalances } = useReadContracts({
    contracts: balanceCalls,
    query: { enabled: balanceCalls.length > 0 },
  });

  const byToken = useMemo(() => {
    const m = new Map<number, Track>();
    tracks.forEach((t) => { if (t.chainTokenId != null) m.set(t.chainTokenId, t); });
    return m;
  }, [tracks]);

  const owned = useMemo(() => {
    if (!balances) return [] as { tokenId: number; qty: number; track?: Track }[];
    return balances
      .map((b, i) => ({ tokenId: i + 1, qty: b.status === "success" ? Number(b.result as bigint) : 0 }))
      .filter((x) => x.qty > 0)
      .map((x) => ({ ...x, track: byToken.get(x.tokenId) }));
  }, [balances, byToken]);

  async function doTransfer() {
    if (!xfer) return;
    const res = await transfer(xfer.tokenId, xfer.to.trim(), Number(xfer.qty) || 1);
    if (!res.ok) return toast(res.error);
    toast("Transferred ✓");
    setXfer(null);
    refetchBalances();
  }

  const loading = !loadedTracks || (balanceCalls.length > 0 && balLoading);

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        <div className="sec-title">MY COLLECTION</div>
        <div className="sec-bar" />

        {!isConnected ? (
          <div className="mint-gate">
            <p>Connect your wallet to see the editions you own.</p>
            <ConnectButton showBalance={false} label="CONNECT WALLET" />
          </div>
        ) : loading ? (
          <div className="muted-note">Reading your on-chain balances…</div>
        ) : owned.length === 0 ? (
          <div className="muted-note">You don’t own any editions yet. <Link href="/" style={{ color: "var(--crimson-soft)" }}>Browse tracks →</Link></div>
        ) : (
          <div className="artist-grid">
            {owned.map(({ tokenId, qty, track }) => {
              const open = xfer?.tokenId === tokenId;
              return (
                <div key={tokenId} className="card">
                  <Link href={track ? `/track/${track.id}` : "#"} className="art" style={{ marginBottom: 11, textDecoration: "none", display: "block" }}>
                    <CoverArt seed={track?.coverSeed ?? tokenId} />
                    <div className="genre">{track?.genre || `TOKEN #${tokenId}`}</div>
                    <span className="owned-badge">×{qty}</span>
                  </Link>
                  <h3>
                    <Link href={track ? `/track/${track.id}` : "#"} style={{ color: "inherit", textDecoration: "none" }}>
                      {track?.title || `Token #${tokenId}`}
                    </Link>
                  </h3>
                  {track && (
                    <div className="by"><img src={avatarUrl(track.artist.avatarSeed)} alt="" /><span>by <b>{track.artist.handle}</b></span></div>
                  )}
                  <div className="price">owned: {qty} · token #{tokenId}</div>

                  <div className="col-actions">
                    {track && (
                      <Link href={`/track/${track.id}`} className="buy col-mini">LIST FOR SALE</Link>
                    )}
                    <button className="buy col-mini col-ghost" onClick={() => setXfer(open ? null : { tokenId, to: "", qty: "1" })}>
                      {open ? "CANCEL" : "TRANSFER"}
                    </button>
                  </div>

                  {open && xfer && (
                    <div className="col-xfer">
                      <input value={xfer.to} onChange={(e) => setXfer({ ...xfer, to: e.target.value })} placeholder="0x recipient…" />
                      <div className="col-xfer-row">
                        <input type="number" min={1} max={qty} step={1} value={xfer.qty} onChange={(e) => setXfer({ ...xfer, qty: e.target.value })} placeholder="qty" />
                        <button className="buy col-mini" disabled={transferring} onClick={doTransfer}>{transferring ? "SENDING…" : "SEND"}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>

      <style jsx>{`
        .col-actions { display: flex; gap: 8px; margin-top: 10px; }
        .col-mini { width: auto; flex: 1; padding: 8px 10px; font-size: 11px; text-align: center; text-decoration: none; }
        .col-ghost { background: transparent; border: 1.5px solid rgba(255,31,75,.45); color: var(--ink, #fff); }
        .col-xfer { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
        .col-xfer input { background: transparent; border: 1.5px solid rgba(255,31,75,.45); color: var(--ink, #fff); font-family: var(--mono, monospace); font-size: 12px; padding: 8px 10px; border-radius: 3px; outline: none; width: 100%; }
        .col-xfer input:focus { border-color: var(--crimson, #ff1f4b); box-shadow: var(--glow); }
        .col-xfer-row { display: flex; gap: 8px; }
        .col-xfer-row input { flex: 1; }
      `}</style>
    </div>
  );
}
