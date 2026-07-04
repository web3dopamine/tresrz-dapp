"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import TrackCard from "@/components/TrackCard";
import ArtistCard from "@/components/ArtistCard";
import DropCard from "@/components/DropCard";
import CookieBanner from "@/components/CookieBanner";
import { CoverArt, avatarUrl } from "@/lib/art";
import { api, type Track, type Artist, type TrendingTrack, type TrendWindow } from "@/lib/api";
import { useBuyTrack } from "@/lib/useBuyTrack";
import { formatEther } from "viem";

// Fallback demo data so the UI renders even before the backend/seed is up
const DEMO_TRACKS: Track[] = [
  { id: "d1", chainTokenId: null, title: "NEON PULSE", genre: "SYNTHWAVE", coverSeed: 11, priceWei: "470000000000000000", maxSupply: 14, minted: 0, left: 14, hot: true, artist: { id: "a1", handle: "BLOCKJ4NE", address: "0x01", avatarSeed: 7 }, likes: 13, liked: false },
  { id: "d2", chainTokenId: null, title: "Remore", genre: "HOUSE", coverSeed: 64, priceWei: "1970000000000000000", maxSupply: 1, minted: 0, left: 1, hot: true, artist: { id: "a2", handle: "Charlie", address: "0x02", avatarSeed: 144 }, likes: 9, liked: false },
  { id: "d3", chainTokenId: null, title: "AWAKENING", genre: "AMBIENT", coverSeed: 117, priceWei: "3800000000000000000", maxSupply: 33, minted: 0, left: 33, hot: true, artist: { id: "a3", handle: "The_Account", address: "0x03", avatarSeed: 281 }, likes: 21, liked: false },
  { id: "d4", chainTokenId: null, title: "Two Spirals", genre: "TECHNO", coverSeed: 170, priceWei: "850000000000000000", maxSupply: 5, minted: 0, left: 5, hot: true, artist: { id: "a4", handle: "TwoSpiral", address: "0x04", avatarSeed: 418 }, likes: 6, liked: false },
  { id: "d5", chainTokenId: null, title: "Dub Skull", genre: "DUB", coverSeed: 223, priceWei: "9390000000000000000", maxSupply: 1, minted: 0, left: 1, hot: true, artist: { id: "a5", handle: "GordieDean", address: "0x05", avatarSeed: 555 }, likes: 7, liked: false },
];
const DEMO_LATEST: Track[] = ["After Hours/LO-FI", "Polychrome/JAZZ", "Latin Tech/TRAP", "Static Bloom/PHONK", "Midnight Run/DRILL"].map((s, i) => {
  const [title, genre] = s.split("/");
  return { id: `l${i}`, chainTokenId: null, title, genre, coverSeed: i * 53 + 300, priceWei: "300000000000000000", maxSupply: 10, minted: 0, left: 10, hot: false, artist: { id: `la${i}`, handle: ["MUSEO DIGITALE", "MUSEO DIGITALE", "MUSEO DIGITALE", "ANRIMMD_CLIPS", "NERVOUSCAT"][i], address: "0x0", avatarSeed: i * 90 + 5 }, likes: 0, liked: false };
});
const DEMO_ARTISTS: Artist[] = [
  ["BELLADONNA", 2, 13], ["The Same Persons", 2, 9], ["NERVOUSCAT", 14, 21], ["Renato Cantini", 2, 6], ["IDDQD", 2, 7],
  ["matlemad", 9, 14], ["Flower of Sound", 1, 5], ["Lego Flowers", 5, 10], ["Jaidem", 1, 8], ["Cappadonia", 1, 5],
].map(([h, n, l], i) => ({ id: `ar${i}`, handle: h as string, address: "0x0", avatarSeed: i * 137 + 3, nftCount: n as number, likes: l as number }));

function eth(wei: string, dp = 2): string {
  try { return Number(formatEther(BigInt(wei))).toFixed(dp); } catch { return "0"; }
}

export default function Home() {
  const [hot, setHot] = useState<Track[]>(DEMO_TRACKS);
  const [latest, setLatest] = useState<Track[]>(DEMO_LATEST);
  const [artists, setArtists] = useState<Artist[]>(DEMO_ARTISTS);
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [trendWindow, setTrendWindow] = useState<TrendWindow>("1d");
  const [trendRows, setTrendRows] = useState<TrendingTrack[] | null>(null);
  const tRef = useRef<any>(null);
  const featRef = useRef<HTMLDivElement | null>(null);
  const featPaused = useRef(false);
  const { buy, busy } = useBuyTrack();

  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2200); }

  useEffect(() => {
    api.tracks("?hot=true").then((d) => d.length && setHot(d)).catch(() => {});
    api.tracks("?limit=12").then((d) => d.length && setLatest(d)).catch(() => {});
    api.artists().then((d) => d.length && setArtists(d)).catch(() => {});
  }, []);

  useEffect(() => {
    api.trending(trendWindow).then(setTrendRows).catch(() => setTrendRows(null));
  }, [trendWindow]);

  // auto-advance the featured carousel: one card every 4s. The card set is
  // rendered twice (loop mode), so when the scroll position passes the first
  // copy we silently jump back one set-width — an endless belt. Targets are
  // always exact card boundaries so scroll-snap never fights the animation.
  // Paused while the user hovers/touches it; disabled for reduced-motion users.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      const el = featRef.current;
      if (!el || featPaused.current || document.hidden) return;
      const card = el.firstElementChild as HTMLElement | null;
      if (!card || el.children.length < 2) return;
      const gap = parseFloat(getComputedStyle(el).columnGap || "16") || 16;
      const step = card.offsetWidth + gap;
      const loop = el.dataset.loop === "true";
      if (loop) {
        const setW = step * (el.children.length / 2);
        // if we've scrolled past the first copy, snap back invisibly
        if (el.scrollLeft >= setW) el.scrollLeft -= setW;
        const target = (Math.round(el.scrollLeft / step) + 1) * step;
        el.scrollTo({ left: target, behavior: "smooth" });
      } else {
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - step / 2;
        if (atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
        else el.scrollTo({ left: (Math.round(el.scrollLeft / step) + 1) * step, behavior: "smooth" });
      }
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const q = search.toLowerCase();
  const matches = (t: Track) =>
    (t.title + t.artist.handle).toLowerCase().includes(q) && (!genre || t.genre === genre);
  const fHot = useMemo(() => hot.filter(matches), [hot, q, genre]);
  const fLatest = useMemo(() => latest.filter(matches), [latest, q, genre]);
  const fArtists = useMemo(() => artists.filter((a) => a.handle.toLowerCase().includes(q)), [artists, q]);
  const genres = useMemo(
    () => Array.from(new Set([...hot, ...latest].map((t) => t.genre))).sort(),
    [hot, latest],
  );

  // featured carousel = hot tracks; trending = server-ranked by window volume,
  // falling back to a client-side likes ranking while the API loads / demo mode
  const featured = fHot.slice(0, 8);
  const trending: (Track & { windowVolumeWei?: string; windowSales?: number })[] = useMemo(() => {
    if (trendRows) return trendRows.filter(matches);
    const seen = new Set<string>();
    return [...hot, ...latest]
      .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
      .filter(matches)
      .sort((a, b) => b.likes - a.likes || b.minted - a.minted)
      .slice(0, 10);
  }, [trendRows, hot, latest, q, genre]);

  async function onQuickBuy(t: Track) {
    const res = await buy(t);
    if (!res.ok) return toast(res.error);
    toast(res.warn ? `⚠ ${res.warn}` : `Bought ${t.title} ✓`);
    api.tracks("?hot=true").then((d) => d.length && setHot(d)).catch(() => {});
    api.trending(trendWindow).then(setTrendRows).catch(() => {});
  }

  return (
    <div className="wrap">
      <Header search={search} setSearch={setSearch} />

      {/* ---- featured carousel ---- */}
      <section className="me-block" id="hot">
        <div
          className="feat-row"
          ref={featRef}
          data-loop={featured.length >= 3}
          onMouseEnter={() => { featPaused.current = true; }}
          onMouseLeave={() => { featPaused.current = false; }}
          onTouchStart={() => { featPaused.current = true; }}
          onTouchEnd={() => { setTimeout(() => { featPaused.current = false; }, 5000); }}
        >
          {featured.length === 0 ? (
            <div className="muted-note">No tracks match your search/filter.</div>
          ) : (featured.length >= 3 ? [...featured, ...featured] : featured).map((t, i) => (
            <Link key={`${t.id}-${i >= featured.length ? "b" : "a"}`} href={`/track/${t.id}`} className="feat-card" aria-hidden={i >= featured.length || undefined}>
              <div className="feat-art"><CoverArt seed={t.coverSeed} /></div>
              <span className="feat-pill">★ FEATURED</span>
              <div className="feat-info">
                <h3>{t.title}</h3>
                <p>
                  <b>{eth(t.priceWei)} ETH</b>
                  <span>· {t.left} of {t.maxSupply} left</span>
                </p>
                <em>by {t.artist.handle}</em>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- genre pills ---- */}
      <div className="genre-filter" id="genres">
        <button className={`genre-chip${genre === null ? " active" : ""}`} onClick={() => setGenre(null)}>ALL</button>
        {genres.map((g) => (
          <button key={g} className={`genre-chip${genre === g ? " active" : ""}`} onClick={() => setGenre(genre === g ? null : g)}>
            {g}
          </button>
        ))}
      </div>

      {/* ---- trending table ---- */}
      <section className="me-block">
        <div className="sec-head">
          <div className="sec-title">TRENDING</div>
          <div className="tt-tabs" role="tablist" aria-label="Trending window">
            {(["1h", "1d", "7d", "all"] as TrendWindow[]).map((w) => (
              <button
                key={w}
                role="tab"
                aria-selected={trendWindow === w}
                className={`tt-tab${trendWindow === w ? " active" : ""}`}
                onClick={() => setTrendWindow(w)}
              >
                {w.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="trend-table">
          <div className="trend-tr trend-th">
            <span>#</span><span>TRACK</span><span className="tt-num">PRICE</span>
            <span className="tt-num tt-vol">VOL ({trendWindow.toUpperCase()})</span>
            <span className="tt-num tt-left">LEFT</span><span className="tt-num tt-likes">LIKES</span><span />
          </div>
          {trending.length === 0 ? (
            <div className="muted-note">No tracks match your search/filter.</div>
          ) : trending.map((t, i) => (
            <Link key={t.id} href={`/track/${t.id}`} className="trend-tr">
              <span className="tt-rank">{i + 1}</span>
              <span className="tt-track">
                <span className="tt-cover"><CoverArt seed={t.coverSeed} /></span>
                <span className="tt-name">
                  <b>{t.title}</b>
                  <small>{t.artist.handle} · {t.genre}</small>
                </span>
              </span>
              <span className="tt-num"><b>{eth(t.priceWei, 3)}</b> <small>ETH</small></span>
              <span className="tt-num tt-vol">
                {t.windowVolumeWei && t.windowVolumeWei !== "0"
                  ? <><b>{eth(t.windowVolumeWei, 4)}</b> <small>ETH · {t.windowSales} sale{(t.windowSales ?? 0) !== 1 ? "s" : ""}</small></>
                  : <small>—</small>}
              </span>
              <span className="tt-num tt-left">{t.left} / {t.maxSupply}</span>
              <span className="tt-num tt-likes">♥ {t.likes}</span>
              <span className="tt-buy">
                <button
                  className="buy tt-mini"
                  disabled={busy || t.left === 0}
                  onClick={(e) => { e.preventDefault(); onQuickBuy(t); }}
                >
                  {t.left === 0 ? "SOLD OUT" : busy ? "…" : "BUY"}
                </button>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- hot tracks carousel ---- */}
      <section className="me-block">
        <div className="sec-head">
          <div className="sec-title">HOT TRACKS</div>
          <span className="sec-more">scroll →</span>
        </div>
        {fHot.length === 0 ? <div className="muted-note">No hot tracks match your search/filter.</div> : (
          <div className="h-row">
            {fHot.map((t) => <TrackCard key={t.id} t={t} toast={toast} />)}
          </div>
        )}
      </section>

      {/* ---- latest drops carousel ---- */}
      <section className="me-block" id="latest">
        <div className="sec-head">
          <div className="sec-title">LATEST DROPS</div>
          <Link className="sec-more" href="/mint">Mint yours →</Link>
        </div>
        {fLatest.length === 0 ? <div className="muted-note">No drops match your search/filter.</div> : (
          <div className="h-row">
            {fLatest.map((t) => <DropCard key={t.id} t={t} />)}
          </div>
        )}
      </section>

      {/* ---- popular artists ---- */}
      <section className="me-block" id="popular">
        <div className="sec-head">
          <div className="sec-title">POPULAR ARTISTS</div>
        </div>
        <div className="h-row h-row-artists">
          {fArtists.map((a) => <ArtistCard key={a.id} a={a} />)}
        </div>
      </section>

      <footer>
        <div className="foot-top">
          <div className="foot-brand">
            <div className="logo"><div className="bars"><span /><span /><span /><span /></div><b>TRES<span>RZ</span></b></div>
            <p>The marketplace where music becomes property. Mint your masters, sell limited editions, and let fans truly own the sound.</p>
          </div>
          <div className="foot-col"><h5>MARKET</h5><a href="#hot">Explore</a><a href="#latest">Latest drops</a><a href="#popular">Top artists</a><a href="#genres">Genres</a></div>
          <div className="foot-col"><h5>CREATE</h5><Link href="/mint">Mint a track</Link><Link href="/about#royalties">Royalties</Link><Link href="/about#docs">How it works</Link><Link href="/collection">Your collection</Link></div>
          <div className="foot-col"><h5>COMPANY</h5><Link href="/about">About</Link><Link href="/about#contact">Contact</Link><Link href="/about#docs">Docs</Link></div>
        </div>
        <div className="foot-bottom"><span>© 2026 TRESRZ — All rights reserved</span><span>TERMS · PRIVACY · COOKIES</span></div>
      </footer>

      <CookieBanner />
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>
    </div>
  );
}
