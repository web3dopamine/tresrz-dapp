"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import TrackCard from "@/components/TrackCard";
import { avatarUrl } from "@/lib/art";
import { api, type ArtistDetail, type Track } from "@/lib/api";

const PAGE = 24;

export default function ArtistPage() {
  const { address } = useParams<{ address: string }>();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [rarities, setRarities] = useState<{ rarity: string; count: number }[]>([]);
  const [active, setActive] = useState<string | null>(null); // null = ALL
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState("");
  const tRef = useRef<any>(null);
  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2200); }

  useEffect(() => {
    api.artist(address).then((a) => {
      setArtist(a); setState("ready");
      api.rarities(a.id).then(setRarities).catch(() => {});
    }).catch(() => setState("missing"));
  }, [address]);

  // (re)load first page whenever the active rarity filter changes
  const load = useCallback(async (artistId: string, rarity: string | null) => {
    setLoadingMore(true); setDone(false);
    const q = `?artist=${artistId}&limit=${PAGE}${rarity ? `&rarity=${encodeURIComponent(rarity)}` : ""}`;
    const rows = await api.tracks(q).catch(() => []);
    setTracks(rows); setDone(rows.length < PAGE); setLoadingMore(false);
  }, []);

  useEffect(() => { if (artist) load(artist.id, active); }, [artist, active, load]);

  async function loadMore() {
    if (!artist || loadingMore || done) return;
    setLoadingMore(true);
    const q = `?artist=${artist.id}&limit=${PAGE}&skip=${tracks.length}${active ? `&rarity=${encodeURIComponent(active)}` : ""}`;
    const rows = await api.tracks(q).catch(() => []);
    setTracks((prev) => [...prev, ...rows]);
    setDone(rows.length < PAGE);
    setLoadingMore(false);
  }

  const totalCount = rarities.reduce((s, r) => s + r.count, 0);

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
                  <span><b>{artist.nftCount.toLocaleString()}</b> tracks</span>
                  <span><b>{artist.totalLikes.toLocaleString()}</b> total likes</span>
                </div>
                <p className="artist-bio">{artist.bio || `${artist.handle} is an independent artist publishing limited-edition music on TRESRZ.`}</p>
              </div>
            </div>

            <div className="sec-title" style={{ marginTop: 30 }}>TRACKS</div>
            <div className="sec-bar" />

            {/* rarity filter chips */}
            {rarities.length > 0 && (
              <div className="rarity-filter">
                <button className={`rf-chip${active === null ? " on" : ""}`} onClick={() => setActive(null)}>
                  ALL <span>{totalCount.toLocaleString()}</span>
                </button>
                {rarities.map((r) => (
                  <button key={r.rarity} className={`rf-chip${active === r.rarity ? " on" : ""}`} onClick={() => setActive(r.rarity)}>
                    {r.rarity} <span>{r.count.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}

            {tracks.length === 0 && !loadingMore ? (
              <div className="muted-note">No tracks{active ? ` in ${active}` : ""} yet.</div>
            ) : (
              <>
                <div className="artist-grid">
                  {tracks.map((t) => <TrackCard key={t.id} t={t} toast={toast} />)}
                </div>
                <div className="rf-more">
                  {loadingMore ? <span className="muted-note">Loading…</span>
                    : !done ? <button className="buy rf-loadmore" onClick={loadMore}>LOAD MORE</button>
                    : tracks.length > 0 ? <span className="muted-note">— end of {active || "collection"} —</span> : null}
                </div>
              </>
            )}
          </>
        )}
      </section>
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>

      <style jsx>{`
        .rarity-filter { display: flex; flex-wrap: wrap; gap: 9px; margin: 4px 0 20px; }
        .rf-chip { background: transparent; border: 1.5px solid var(--card-line, rgba(0,0,0,.15)); color: var(--ink); font-family: var(--mono, monospace); font-size: 12px; font-weight: 700; letter-spacing: .04em; padding: 8px 13px; border-radius: 7px; cursor: pointer; transition: .15s; display: inline-flex; align-items: center; gap: 7px; }
        .rf-chip span { font-weight: 400; opacity: .6; font-size: 11px; }
        .rf-chip:hover { border-color: var(--crimson, #f58426); }
        .rf-chip.on { background: var(--crimson, #f58426); border-color: var(--crimson, #f58426); color: #fff; }
        .rf-chip.on span { opacity: .85; color: #fff; }
        .rf-more { display: flex; justify-content: center; margin: 26px 0 4px; }
        .rf-loadmore { width: auto; padding: 11px 30px; }
      `}</style>
    </div>
  );
}
