"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import TrackCard from "@/components/TrackCard";
import ArtistCard from "@/components/ArtistCard";
import DropCard from "@/components/DropCard";
import CookieBanner from "@/components/CookieBanner";
import BuyModal from "@/components/BuyModal";
import { CoverArt, avatarUrl } from "@/lib/art";
import { api, type Track, type Artist, type Collection, type TrendingTrack, type TrendWindow } from "@/lib/api";
import { useUsdRate, usd } from "@/lib/usd";

// Gray shimmer placeholder — shown while a section's data is still loading, so
// the page renders its real structure immediately (no demo/fake content).
const Skeleton = ({ className = "", style }: { className?: string; style?: React.CSSProperties }) => (
  <div className={`skl ${className}`} style={style} />
);

export default function Home() {
  // null = still loading (show skeletons); array = loaded real data (maybe empty)
  const [hot, setHot] = useState<Track[] | null>(null);
  const [latest, setLatest] = useState<Track[] | null>(null);
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [trendWindow, setTrendWindow] = useState<TrendWindow>("1d");
  const [trendRows, setTrendRows] = useState<TrendingTrack[] | null>(null);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const tRef = useRef<any>(null);
  const rate = useUsdRate();
  const [buyTrack, setBuyTrack] = useState<Track | null>(null);

  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2200); }

  useEffect(() => {
    // Set whatever the API returns (even an empty list) — never fall back to fake
    // data. Empty just means "no items yet", which the sections handle gracefully.
    api.tracks("?hot=true").then(setHot).catch(() => setHot([]));
    api.tracks("?limit=12").then(setLatest).catch(() => setLatest([]));
    api.artists().then(setArtists).catch(() => setArtists([]));
    api.collections(12).then(setCollections).catch(() => setCollections([]));
  }, []);

  useEffect(() => {
    api.trending(trendWindow).then(setTrendRows).catch(() => setTrendRows(null));
  }, [trendWindow]);


  const q = search.toLowerCase();
  const matches = (t: Track) =>
    (t.title + t.artist.handle).toLowerCase().includes(q) && (!genre || t.genre === genre);

  const hotArr = hot ?? [];
  const latestArr = latest ?? [];
  // Featured/Hot show hot-flagged tracks when there are any; otherwise they fall
  // back to the latest real tracks so the sections always show REAL NFTs (never
  // demo data, never empty when the marketplace has items).
  const showcase = hotArr.length ? hotArr : latestArr;

  // loading flags drive the gray skeleton templates
  const showcaseLoading = hot === null && latest === null;
  const latestLoading = latest === null;
  const artistsLoading = artists === null;
  const collectionsLoading = collections === null;

  const fShow = useMemo(() => showcase.filter(matches), [showcase, q, genre]);
  const fLatest = useMemo(() => latestArr.filter(matches), [latestArr, q, genre]);
  const fArtists = useMemo(() => (artists ?? []).filter((a) => a.handle.toLowerCase().includes(q)), [artists, q]);
  const genres = useMemo(
    () => Array.from(new Set([...hotArr, ...latestArr].map((t) => t.genre))).sort(),
    [hotArr, latestArr],
  );

  const featured = fShow.slice(0, 8);
  const trendingLoading = trendRows === null && showcaseLoading;
  const trending: (Track & { windowVolumeWei?: string; windowSales?: number })[] = useMemo(() => {
    if (trendRows) return trendRows.filter(matches);
    const seen = new Set<string>();
    return [...hotArr, ...latestArr]
      .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
      .filter(matches)
      .sort((a, b) => b.likes - a.likes || b.minted - a.minted)
      .slice(0, 10);
  }, [trendRows, hotArr, latestArr, q, genre]);

  function onBought() {
    api.tracks("?hot=true").then(setHot).catch(() => {});
    api.trending(trendWindow).then(setTrendRows).catch(() => {});
  }

  return (
    <div className="wrap">
      <Header search={search} setSearch={setSearch} />

      {/* ---- featured carousel ---- */}
      {/* ---- featured: manual carousel, hover reveals details ---- */}
      <section className="me-block" id="hot">
        <div className="feat-row">
          {showcaseLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="skl-feat" />)
          ) : featured.length === 0 ? (
            <div className="muted-note">No tracks match your search/filter.</div>
          ) : featured.map((t) => (
            <Link key={t.id} href={`/track/${t.id}`} className="feat-card">
              <div className="feat-art"><CoverArt seed={t.coverSeed} url={t.coverUrl} video={t.mime?.startsWith("video") ? `/api/media/${t.id}/preview` : undefined} /></div>
              <span className="feat-pill">★ FEATURED</span>
              <div className="feat-info">
                <h3>{t.title}</h3>
                <p>
                  <b>{usd(t.priceWei, rate) ?? "…"}</b>
                  <span>· {t.left} of {t.maxSupply} left</span>
                </p>
                <em>by {t.artist.handle}</em>
                <div className="feat-more">
                  <span>{t.genre}</span>
                  <span>♥ {t.likes}</span>
                  <span>{t.minted} minted</span>
                  <i className="feat-cta">VIEW TRACK →</i>
                </div>
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

      {/* ---- collections (OpenSea-style) ---- */}
      {(collectionsLoading || (collections && collections.length > 0)) && (
        <section className="me-block" id="collections">
          <div className="sec-head">
            <div className="sec-title">COLLECTIONS</div>
            <Link className="sec-more" href="/collections/new">+ create collection</Link>
          </div>
          <div className="coll-grid">
            {collectionsLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="skl-coll" />)
            ) : (collections ?? []).map((c) => {
              const cells = [...c.covers];
              while (cells.length < 4) cells.push({ coverSeed: c.owner.avatarSeed + cells.length * 7, coverUrl: null });
              return (
                <Link key={c.id} href={`/collections/${c.slug}`} className="coll-card">
                  <div className="coll-covers">
                    {cells.slice(0, 4).map((cv, i) => (
                      <div key={i} className="coll-cell">
                        <CoverArt seed={cv.coverSeed} url={cv.coverUrl} />
                      </div>
                    ))}
                  </div>
                  <div className="coll-info">
                    <img className="coll-av" src={avatarUrl(c.owner.avatarSeed)} alt="" />
                    <div className="coll-meta">
                      <b>{c.name}</b>
                      <div className="coll-stats">
                        <span>{c.itemCount.toLocaleString()} items</span>
                        {c.floorWei && rate && usd(c.floorWei, rate) && <span>floor {usd(c.floorWei, rate)}</span>}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

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
          {trendingLoading ? (
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="skl-row" />)
          ) : trending.length === 0 ? (
            <div className="muted-note">No tracks match your search/filter.</div>
          ) : trending.map((t, i) => (
            <Link key={t.id} href={`/track/${t.id}`} className="trend-tr">
              <span className="tt-rank">{i + 1}</span>
              <span className="tt-track">
                <span className="tt-cover"><CoverArt seed={t.coverSeed} url={t.coverUrl} /></span>
                <span className="tt-name">
                  <b>{t.title}{(t as any).isNew && <span className="tt-new">NEW</span>}</b>
                  <small>{t.artist.handle} · {t.genre}</small>
                </span>
              </span>
              <span className="tt-num">
                <b>{usd(t.priceWei, rate) ?? "…"}</b>
              </span>
              <span className="tt-num tt-vol">
                {t.windowVolumeWei && t.windowVolumeWei !== "0"
                  ? <><b>{usd(t.windowVolumeWei, rate) ?? "…"}</b> <small>{t.windowSales} sale{(t.windowSales ?? 0) !== 1 ? "s" : ""}</small></>
                  : <small>—</small>}
              </span>
              <span className="tt-num tt-left">{t.left} / {t.maxSupply}</span>
              <span className="tt-num tt-likes">♥ {t.likes}</span>
              <span className="tt-buy">
                <button
                  className="buy tt-mini"
                  disabled={t.left === 0}
                  onClick={(e) => { e.preventDefault(); setBuyTrack(t); }}
                >
                  {t.left === 0 ? "SOLD OUT" : "BUY"}
                </button>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- suggested carousel ---- */}
      <section className="me-block" id="latest">
        <div className="sec-head">
          <div className="sec-title">SUGGESTED</div>
          <Link className="sec-more" href="/mint">Mint yours →</Link>
        </div>
        {latestLoading ? (
          <div className="h-row">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="skl-drop" />)}</div>
        ) : fLatest.length === 0 ? <div className="muted-note">No tracks match your search/filter.</div> : (
          <div className="h-row">
            {fLatest.map((t) => <DropCard key={t.id} t={t} />)}
          </div>
        )}
      </section>

      {/* ---- hot tracks: continuously drifting marquee (moved to bottom) ---- */}
      <section className="me-block">
        <div className="sec-head">
          <div className="sec-title">HOT TRACKS</div>
          <span className="sec-more">hover to pause</span>
        </div>
        {showcaseLoading ? (
          <div className="h-row">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="skl-drop" />)}</div>
        ) : fShow.length === 0 ? (
          <div className="muted-note">No hot tracks match your search/filter.</div>
        ) : fShow.length >= 3 ? (
          <div className="marquee">
            <div className="marquee-track" style={{ ["--mq-dur" as any]: `${fShow.length * 8}s` }}>
              <div className="mq-set">
                {fShow.map((t) => <div className="mq-item" key={t.id}><TrackCard t={t} toast={toast} /></div>)}
              </div>
              <div className="mq-set" aria-hidden>
                {fShow.map((t) => <div className="mq-item" key={`${t.id}-b`}><TrackCard t={t} toast={toast} /></div>)}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-row">
            {fShow.map((t) => <TrackCard key={t.id} t={t} toast={toast} />)}
          </div>
        )}
      </section>

      {/* ---- popular artists ---- */}
      <section className="me-block" id="popular">
        <div className="sec-head">
          <div className="sec-title">POPULAR ARTISTS</div>
        </div>
        <div className="h-row h-row-artists">
          {artistsLoading
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="skl-artist" />)
            : fArtists.map((a) => <ArtistCard key={a.id} a={a} />)}
        </div>
      </section>

      <style jsx>{`
        .skl { position: relative; overflow: hidden; background: var(--card-line, rgba(255,255,255,.06)); border: 1px solid var(--line-soft, rgba(255,255,255,.05)); border-radius: 14px; }
        .skl::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,.10), transparent); animation: skl-shimmer 1.3s infinite; }
        :global([data-theme="light"]) .skl::after { background: linear-gradient(90deg, transparent, rgba(0,0,0,.06), transparent); }
        @keyframes skl-shimmer { 100% { transform: translateX(100%); } }
        .skl-feat { height: 400px; border-radius: 18px; }
        .skl-coll { height: 300px; }
        .skl-row { height: 58px; border-radius: 10px; }
        .skl-drop { height: 290px; }
        .skl-artist { height: 210px; border-radius: 16px; }
        @media (max-width: 700px) { .skl-feat { height: 330px; } }
      `}</style>

      <CookieBanner />
      <BuyModal track={buyTrack} open={!!buyTrack} onClose={() => setBuyTrack(null)} toast={toast} onBought={onBought} />
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>
    </div>
  );
}
