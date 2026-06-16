"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import Header from "@/components/Header";
import { CoverArt, avatarUrl } from "@/lib/art";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { api, type Track } from "@/lib/api";

export default function CollectionPage() {
  const { address, isConnected } = useAccount();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadedTracks, setLoadedTracks] = useState(false);

  useEffect(() => { api.tracks().then((d) => { setTracks(d); setLoadedTracks(true); }).catch(() => setLoadedTracks(true)); }, []);

  // how many tokenIds exist on-chain
  const { data: nextId } = useReadContract({ abi: musicAbi, address: MUSIC_CONTRACT, functionName: "nextTrackId" });
  const maxId = nextId ? Number(nextId) - 1 : 0;

  // batch balanceOf(address, tokenId) for every minted tokenId
  const balanceCalls = useMemo(() => {
    if (!address || maxId < 1) return [];
    return Array.from({ length: maxId }, (_, i) => ({
      abi: musicAbi, address: MUSIC_CONTRACT, functionName: "balanceOf" as const, args: [address, BigInt(i + 1)] as const,
    }));
  }, [address, maxId]);

  const { data: balances, isLoading: balLoading } = useReadContracts({
    contracts: balanceCalls,
    query: { enabled: balanceCalls.length > 0 },
  });

  // tokenId -> track metadata (from the API)
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
            {owned.map(({ tokenId, qty, track }) => (
              <Link key={tokenId} href={track ? `/track/${track.id}` : "#"} className="card" style={{ textDecoration: "none" }}>
                <div className="art" style={{ marginBottom: 11 }}>
                  <CoverArt seed={track?.coverSeed ?? tokenId} />
                  <div className="genre">{track?.genre || `TOKEN #${tokenId}`}</div>
                  <span className="owned-badge">×{qty}</span>
                </div>
                <h3>{track?.title || `Token #${tokenId}`}</h3>
                {track && (
                  <div className="by"><img src={avatarUrl(track.artist.avatarSeed)} alt="" /><span>by <b>{track.artist.handle}</b></span></div>
                )}
                <div className="price">owned: {qty} · token #{tokenId}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
