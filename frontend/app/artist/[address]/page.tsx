"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import TrackCard from "@/components/TrackCard";
import { avatarUrl } from "@/lib/art";
import { api, type ArtistDetail } from "@/lib/api";

export default function ArtistPage() {
  const { address } = useParams<{ address: string }>();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [msg, setMsg] = useState("");
  const tRef = useRef<any>(null);
  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2200); }

  useEffect(() => {
    api.artist(address).then((a) => { setArtist(a); setState("ready"); }).catch(() => setState("missing"));
  }, [address]);

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        {state === "loading" && <div className="muted-note">Loading artist…</div>}
        {state === "missing" && (
          <div className="muted-note">Artist not found. <Link href="/" style={{ color: "var(--crimson-soft)" }}>← Back home</Link></div>
        )}
        {state === "ready" && artist && (
          <>
            <div className="artist-header">
              <img src={avatarUrl(artist.avatarSeed)} alt="" />
              <div className="artist-meta">
                <h1>{artist.handle}</h1>
                <div className="artist-addr">{artist.address}</div>
                <div className="artist-counts">
                  <span><b>{artist.nftCount}</b> tracks</span>
                  <span><b>{artist.totalLikes}</b> total likes</span>
                </div>
                {artist.bio && <p className="artist-bio">{artist.bio}</p>}
              </div>
            </div>

            <div className="sec-title" style={{ marginTop: 30 }}>TRACKS</div>
            <div className="sec-bar" />
            {artist.tracks.length === 0 ? (
              <div className="muted-note">This artist hasn’t minted any tracks yet.</div>
            ) : (
              <div className="artist-grid">
                {artist.tracks.map((t) => <TrackCard key={t.id} t={t} toast={toast} />)}
              </div>
            )}
          </>
        )}
      </section>
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>
    </div>
  );
}
