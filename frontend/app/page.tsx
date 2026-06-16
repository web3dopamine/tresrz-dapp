"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import TrackCard from "@/components/TrackCard";
import ArtistCard from "@/components/ArtistCard";
import DropCard from "@/components/DropCard";
import CookieBanner from "@/components/CookieBanner";
import { api, type Track, type Artist } from "@/lib/api";

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

export default function Home() {
  const [hot, setHot] = useState<Track[]>(DEMO_TRACKS);
  const [latest, setLatest] = useState<Track[]>(DEMO_LATEST);
  const [artists, setArtists] = useState<Artist[]>(DEMO_ARTISTS);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const tRef = useRef<any>(null);

  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2200); }

  useEffect(() => {
    api.tracks("?hot=true").then((d) => d.length && setHot(d)).catch(() => {});
    api.tracks("?limit=5").then((d) => d.length && setLatest(d)).catch(() => {});
    api.artists().then((d) => d.length && setArtists(d)).catch(() => {});
  }, []);

  const q = search.toLowerCase();
  const fHot = useMemo(() => hot.filter((t) => (t.title + t.artist.handle).toLowerCase().includes(q)), [hot, q]);
  const fLatest = useMemo(() => latest.filter((t) => (t.title + t.artist.handle).toLowerCase().includes(q)), [latest, q]);
  const fArtists = useMemo(() => artists.filter((a) => a.handle.toLowerCase().includes(q)), [artists, q]);

  return (
    <div className="wrap">
      <Header search={search} setSearch={setSearch} />

      <div className="hero">
        <h1>EXPLORE</h1>
        <p>Own the sound · Mint · Collect · Stream</p>
        <div className="hero-rule" />
      </div>

      <section className="block" id="hot">
        <div className="hot-row">
          <div className="hot-label"><span>HOT TRACKS</span></div>
          <div className="hot-cards">
            {fHot.map((t) => <TrackCard key={t.id} t={t} toast={toast} />)}
          </div>
        </div>
      </section>

      <section className="block" id="popular">
        <div className="sec-title">POPULAR ARTISTS</div>
        <div className="sec-bar" />
        <div className="pop-grid">{fArtists.map((a) => <ArtistCard key={a.id} a={a} />)}</div>
      </section>

      <section className="block" id="latest">
        <div className="sec-title">LATEST DROPS</div>
        <div className="sec-bar" />
        <div className="latest-grid">{fLatest.map((t) => <DropCard key={t.id} t={t} />)}</div>
      </section>

      <footer>
        <div className="foot-top">
          <div className="foot-brand">
            <div className="logo"><div className="bars"><span /><span /><span /><span /></div><b>TRES<span>RZ</span></b></div>
            <p>The marketplace where music becomes property. Mint your masters, sell limited editions, and let fans truly own the sound.</p>
          </div>
          <div className="foot-col"><h5>MARKET</h5><a href="#hot">Explore</a><a href="#latest">Latest drops</a><a href="#popular">Top artists</a><a href="#hot">Genres</a></div>
          <div className="foot-col"><h5>CREATE</h5><Link href="/mint">Mint a track</Link><a href="#popular">Royalties</a><a href="#popular">Certifications</a><a href="#hot">Docs</a></div>
          <div className="foot-col"><h5>COMPANY</h5><a href="#">About</a><a href="#">Blog</a><a href="#">Careers</a><a href="#">Contact</a></div>
        </div>
        <div className="foot-bottom"><span>© 2026 TRESRZ — All rights reserved</span><span>TERMS · PRIVACY · COOKIES</span></div>
      </footer>

      <CookieBanner />
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>
    </div>
  );
}
