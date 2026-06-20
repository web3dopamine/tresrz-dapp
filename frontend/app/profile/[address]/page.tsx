"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useReadContract, useReadContracts } from "wagmi";
import Header from "@/components/Header";
import TrackCard from "@/components/TrackCard";
import { avatarUrl } from "@/lib/art";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { api, type ArtistDetail, type Track } from "@/lib/api";

type Tab = "created" | "owned";

export default function ProfilePage() {
  const { address } = useParams<{ address: string }>();
  const [profile, setProfile] = useState<ArtistDetail | null>(null);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [tab, setTab] = useState<Tab>("created");
  const [msg, setMsg] = useState("");
  const tRef = useRef<any>(null);
  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2400); }

  useEffect(() => {
    api.artist(address).then(setProfile).catch(() => setProfile(null));
    api.tracks().then(setAllTracks).catch(() => setAllTracks([]));
  }, [address]);

  // on-chain tracks we know about, to read balances for "Owned"
  const onChain = useMemo(() => allTracks.filter((t) => t.chainTokenId != null), [allTracks]);

  const balanceCalls = useMemo(() => {
    if (!address || onChain.length === 0) return [];
    return onChain.map((t) => ({
      abi: musicAbi, address: MUSIC_CONTRACT, functionName: "balanceOf" as const,
      args: [address as `0x${string}`, BigInt(t.chainTokenId as number)] as const,
    }));
  }, [address, onChain]);

  const { data: balances } = useReadContracts({
    contracts: balanceCalls,
    query: { enabled: balanceCalls.length > 0 },
  });

  const owned = useMemo(() => {
    if (!balances) return [] as { track: Track; qty: number }[];
    return onChain
      .map((track, i) => ({ track, qty: balances[i]?.status === "success" ? Number(balances[i].result as bigint) : 0 }))
      .filter((x) => x.qty > 0);
  }, [balances, onChain]);

  const created = profile?.tracks ?? [];
  const seed = profile?.avatarSeed ?? 1;
  const handle = profile?.handle || `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        <div className="artist-header">
          <img src={avatarUrl(seed)} alt="" />
          <div className="artist-meta">
            <h1>{handle}</h1>
            <div className="artist-addr">{address}</div>
            <div className="artist-counts">
              <span><b>{created.length}</b> created</span>
              <span><b>{owned.length}</b> owned</span>
            </div>
          </div>
        </div>

        <div className="pf-tabs" style={{ marginTop: 26 }}>
          <button className={tab === "created" ? "on" : ""} onClick={() => setTab("created")}>CREATED</button>
          <button className={tab === "owned" ? "on" : ""} onClick={() => setTab("owned")}>OWNED</button>
        </div>
        <div className="sec-bar" />

        {tab === "created" ? (
          created.length === 0 ? (
            <div className="muted-note">No created tracks yet.</div>
          ) : (
            <div className="artist-grid">
              {created.map((t) => <TrackCard key={t.id} t={t} toast={toast} />)}
            </div>
          )
        ) : owned.length === 0 ? (
          <div className="muted-note">No on-chain editions owned.</div>
        ) : (
          <div className="artist-grid">
            {owned.map(({ track, qty }) => (
              <div key={track.id} style={{ position: "relative" }}>
                <span className="owned-badge" style={{ zIndex: 2 }}>×{qty}</span>
                <TrackCard t={track} toast={toast} />
              </div>
            ))}
          </div>
        )}
      </section>
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>

      <style jsx>{`
        .pf-tabs { display: flex; gap: 6px; }
        .pf-tabs button { font-family: var(--mono, monospace); font-size: 12px; font-weight: 700; letter-spacing: .08em; color: var(--muted, #9a8fb0); background: transparent; border: 1.5px solid var(--card-line, rgba(255,31,75,.25)); border-radius: 3px; padding: 8px 18px; cursor: pointer; transition: .2s; }
        .pf-tabs button.on { color: #fff; border-color: var(--crimson, #ff1f4b); box-shadow: var(--glow); }
      `}</style>
    </div>
  );
}
