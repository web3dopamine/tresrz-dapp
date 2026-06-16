"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import { CoverArt, avatarUrl } from "@/lib/art";
import { api, type Track } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBuyTrack } from "@/lib/useBuyTrack";

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const { buy, busy } = useBuyTrack();

  const [track, setTrack] = useState<Track | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [msg, setMsg] = useState("");
  const [liking, setLiking] = useState(false);
  const tRef = useRef<any>(null);

  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2200); }

  function load() {
    api.track(id).then((t) => { setTrack(t); setState("ready"); }).catch(() => setState("missing"));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function onBuy() {
    if (!track) return;
    const res = await buy(track);
    if (!res.ok) return toast(res.error);
    toast(`Bought ${track.title} ✓`);
    api.track(id).then((t) => setTrack(t)).catch(() => {}); // reconcile editions-left
  }

  async function onLike() {
    if (!track) return;
    if (!token) return toast("Sign in to like");
    setLiking(true);
    // optimistic
    const prev = { liked: track.liked, likes: track.likes };
    setTrack({ ...track, liked: !track.liked, likes: track.likes + (track.liked ? -1 : 1) });
    try {
      const res = await api.toggleLike(track.id); // { liked, count }
      setTrack((t) => (t ? { ...t, liked: res.liked, likes: res.count } : t));
    } catch {
      setTrack((t) => (t ? { ...t, ...prev } : t)); // revert on failure
      toast("Could not update like");
    } finally { setLiking(false); }
  }

  const priceEth = track ? Number(BigInt(track.priceWei)) / 1e18 : 0;

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        {state === "loading" && <div className="muted-note">Loading track…</div>}
        {state === "missing" && (
          <div className="muted-note">Track not found. <Link href="/" style={{ color: "var(--crimson-soft)" }}>← Back home</Link></div>
        )}
        {state === "ready" && track && (
          <div className="detail-grid">
            <div className="detail-cover">
              <CoverArt seed={track.coverSeed} />
              <div className="genre">{track.genre}</div>
            </div>

            <div className="detail-info">
              <h1 className="detail-title">{track.title}</h1>
              <Link href={`/artist/${track.artist.address}`} className="detail-artist">
                <img src={avatarUrl(track.artist.avatarSeed)} alt="" />
                <span>by <b>{track.artist.handle}</b></span>
              </Link>

              <div className="detail-stats">
                <div><span>PRICE</span><b>{priceEth.toFixed(3)} ETH</b></div>
                <div><span>EDITIONS LEFT</span><b>{track.left} / {track.maxSupply}</b></div>
                <div><span>TOKEN ID</span><b>{track.chainTokenId ?? "—"}</b></div>
                <div><span>LIKES</span><b>{track.likes}</b></div>
              </div>

              {track.audioUrl ? (
                <audio className="detail-audio" controls preload="none" src={track.audioUrl} />
              ) : (
                <div className="detail-noaudio">No audio attached to this track.</div>
              )}

              <div className="detail-actions">
                <button className="buy" disabled={busy || track.left === 0} onClick={onBuy}>
                  {track.left === 0 ? "SOLD OUT" : busy ? "CONFIRMING…" : `BUY 1 EDITION · ${priceEth.toFixed(3)} ETH`}
                </button>
                <button className={`heart detail-heart${track.liked ? " liked" : ""}`} disabled={liking} onClick={onLike} aria-label="like">
                  <svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-8.5C1 9 3 5.5 6.5 5.5c2 0 3.5 1.3 5.5 3 2-1.7 3.5-3 5.5-3C21 5.5 23 9 21.5 12.5 19 16.5 12 21 12 21z" /></svg>
                  <small>{track.likes}</small>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>
    </div>
  );
}
