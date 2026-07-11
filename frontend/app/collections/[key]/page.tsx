"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import TrackCard from "@/components/TrackCard";
import { avatarUrl } from "@/lib/art";
import { api, type CollectionDetail, type Track } from "@/lib/api";
import { usd, useUsdRate } from "@/lib/usd";

const PAGE = 24;

export default function CollectionPage() {
  const { key } = useParams<{ key: string }>();
  const [col, setCol] = useState<CollectionDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [active, setActive] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState("");
  const rate = useUsdRate();
  const tRef = useRef<any>(null);
  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2200); }

  useEffect(() => {
    api.collection(key).then((c) => { setCol(c); setState("ready"); }).catch(() => setState("missing"));
  }, [key]);

  const load = useCallback(async (colId: string, rarity: string | null) => {
    setLoadingMore(true); setDone(false);
    const q = `?collection=${colId}&limit=${PAGE}${rarity ? `&rarity=${encodeURIComponent(rarity)}` : ""}`;
    const rows = await api.tracks(q).catch(() => []);
    setTracks(rows); setDone(rows.length < PAGE); setLoadingMore(false);
  }, []);

  useEffect(() => { if (col) load(col.id, active); }, [col, active, load]);

  async function loadMore() {
    if (!col || loadingMore || done) return;
    setLoadingMore(true);
    const q = `?collection=${col.id}&limit=${PAGE}&skip=${tracks.length}${active ? `&rarity=${encodeURIComponent(active)}` : ""}`;
    const rows = await api.tracks(q).catch(() => []);
    setTracks((p) => [...p, ...rows]); setDone(rows.length < PAGE); setLoadingMore(false);
  }

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        {state === "loading" && <div className="muted-note">Loading collection…</div>}
        {state === "missing" && <div className="muted-note">Collection not found. <Link href="/#collections" style={{ color: "var(--crimson-soft)" }}>← All collections</Link></div>}
        {state === "ready" && col && (
          <>
            <div className="artist-header">
              <img src={avatarUrl(col.owner.avatarSeed)} alt="" />
              <div className="artist-meta">
                <div className="coll-eyebrow">COLLECTION</div>
                <h1>{col.name}</h1>
                <div className="coll-by">by <Link href={`/artist/${col.owner.address}`}><b>{col.owner.handle}</b></Link></div>
                <div className="artist-counts">
                  <span><b>{col.itemCount.toLocaleString()}</b> items</span>
                  {col.floorWei && rate && usd(col.floorWei, rate) && <span>floor <b>{usd(col.floorWei, rate)}</b></span>}
                </div>
                {col.description && <p className="artist-bio">{col.description}</p>}
              </div>
            </div>

            <div className="sec-title" style={{ marginTop: 30 }}>ITEMS</div>
            <div className="sec-bar" />

            {col.rarities.length > 0 && (
              <div className="rarity-filter">
                <button className={`rf-chip${active === null ? " on" : ""}`} onClick={() => setActive(null)}>
                  ALL <span>{col.itemCount.toLocaleString()}</span>
                </button>
                {col.rarities.map((r) => (
                  <button key={r.rarity} className={`rf-chip${active === r.rarity ? " on" : ""}`} onClick={() => setActive(r.rarity)}>
                    {r.rarity} <span>{r.count.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}

            {tracks.length === 0 && !loadingMore ? (
              <div className="muted-note">No items{active ? ` in ${active}` : ""} yet.</div>
            ) : (
              <>
                <div className="artist-grid">{tracks.map((t) => <TrackCard key={t.id} t={t} toast={toast} />)}</div>
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
        .coll-eyebrow { font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .18em; color: var(--crimson, #f58426); font-weight: 700; margin-bottom: 4px; }
        .coll-by { font-size: 13px; color: var(--muted); margin: 2px 0 4px; }
        .coll-by b { color: var(--ink); }
      `}</style>
    </div>
  );
}
