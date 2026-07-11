"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CoverArt, avatarUrl } from "@/lib/art";
import { api, type Track } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useUsdRate, usd } from "@/lib/usd";
import BuyModal from "@/components/BuyModal";

export default function TrackCard({ t, toast }: { t: Track; toast: (m: string) => void }) {
  const router = useRouter();
  const { token } = useAuth();
  const [buyOpen, setBuyOpen] = useState(false);

  const [left, setLeft] = useState(t.left);
  const [liked, setLiked] = useState(t.liked);
  const [likes, setLikes] = useState(t.likes);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const priceEth = (() => { try { return Number(BigInt(t.priceWei)) / 1e18; } catch { return 0; } })();
  const rate = useUsdRate();
  const priceUsd = usd(t.priceWei, rate);

  function togglePlay(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!t.audioUrl) return toast("No audio for this track");
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) { el.play().then(() => setPlaying(true)).catch(() => toast("Could not play audio")); }
    else { el.pause(); setPlaying(false); }
  }

  function onBought() {
    setLeft((l) => Math.max(0, l - 1)); // optimistic
    api.track(t.id).then((fresh) => setLeft(fresh.left)).catch(() => {}); // reconcile
  }

  async function onLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!token) return toast("Sign in to like");
    const prev = { liked, likes };
    setLiked(!liked); setLikes((v) => v + (liked ? -1 : 1)); // optimistic
    try {
      const res = await api.toggleLike(t.id); // { liked, count } from server
      setLiked(res.liked); setLikes(res.count); // reconcile
    } catch {
      setLiked(prev.liked); setLikes(prev.likes); // revert
      toast("Could not update like");
    }
  }

  const isVideo = !!t.mime?.startsWith("video");

  return (
    <div className="card">
      <div
        className={`art${playing ? " playing" : ""}`}
        onClick={() => router.push(`/track/${t.id}`)}
        style={{ cursor: "pointer" }}
        // video NFTs: play the animation on hover (driven from the container so the
        // overlays below don't swallow the hover). muted preview; sound on the item page.
        onMouseEnter={isVideo ? (e) => { const v = e.currentTarget.querySelector("video"); v?.play().catch(() => {}); } : undefined}
        onMouseLeave={isVideo ? (e) => { const v = e.currentTarget.querySelector("video"); if (v) { v.pause(); v.currentTime = 0; } } : undefined}
      >
        <CoverArt seed={t.coverSeed} url={t.coverUrl} video={isVideo ? t.audioUrl : undefined} />
        <div className="genre">{t.genre}</div>
        {!isVideo && (
          <>
            <div className="play" onClick={togglePlay}>
              <div className="pbtn">
                {playing
                  ? <svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                  : <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
              </div>
            </div>
            <div className="wave">{Array.from({ length: 22 }).map((_, i) => <i key={i} style={{ animationDelay: `${i * 0.06}s` }} />)}</div>
            {t.audioUrl && <audio ref={audioRef} src={t.audioUrl} preload="none" onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />}
          </>
        )}
      </div>
      <h3><Link href={`/track/${t.id}`} style={{ color: "inherit", textDecoration: "none" }}>{t.title}</Link></h3>
      <Link href={`/artist/${t.artist.address}`} className="by" style={{ textDecoration: "none" }}>
        <img src={avatarUrl(t.artist.avatarSeed)} alt="" /><span>by <b>{t.artist.handle}</b></span>
      </Link>
      <div className="price">
        {priceUsd ?? "…"} <em>{left} left</em>
        <button className={`heart card-heart${liked ? " liked" : ""}`} onClick={onLike} aria-label="like">
          <svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-8.5C1 9 3 5.5 6.5 5.5c2 0 3.5 1.3 5.5 3 2-1.7 3.5-3 5.5-3C21 5.5 23 9 21.5 12.5 19 16.5 12 21 12 21z" /></svg>
          <small>{likes}</small>
        </button>
      </div>
      <button className="buy" disabled={left === 0} onClick={() => setBuyOpen(true)}>{left === 0 ? "SOLD OUT" : "BUY NOW"}</button>
      <BuyModal track={{ ...t, left }} open={buyOpen} onClose={() => setBuyOpen(false)} toast={toast} onBought={onBought} />
    </div>
  );
}
