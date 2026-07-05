"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { CoverArt } from "@/lib/art";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useUsdRate, fmtEth } from "@/lib/usd";

type Status = "idle" | "minting" | "done" | "error";

export default function MintPage() {
  const { token, openAuth } = useAuth();
  const rate = useUsdRate();
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [artist, setArtist] = useState("");
  const [maxSupply, setMaxSupply] = useState("10");
  const [price, setPrice] = useState("25"); // USD
  const [royalty, setRoyalty] = useState("5");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [coverSeed, setCoverSeed] = useState(() => 100 + Math.floor(Math.abs(Math.sin(1) * 9999)));

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; chainTokenId: number | null } | null>(null);

  const busy = status === "minting";
  const valid = useMemo(() => {
    const ms = Number(maxSupply), pr = Number(price), ry = Number(royalty);
    return title.trim() && genre.trim() && !!audioFile && ms >= 1 && pr >= 0 && ry >= 0 && ry <= 10;
  }, [title, genre, audioFile, maxSupply, price, royalty]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setError(""); setCreated(null); setStatus("minting");
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("genre", genre.trim().toUpperCase());
      fd.append("description", description.trim());
      fd.append("maxSupply", String(Math.floor(Number(maxSupply))));
      fd.append("priceUsd", String(Number(price)));
      fd.append("royaltyPct", String(Number(royalty)));
      fd.append("coverSeed", String(coverSeed));
      if (artist.trim()) fd.append("handle", artist.trim());
      fd.append("audio", audioFile!);
      if (imageFile) fd.append("image", imageFile);
      const res = await api.custodialMint(fd);
      setCreated({ id: res.trackId, chainTokenId: res.chainTokenId });
      setStatus("done");
    } catch (err: any) {
      setError(err?.message || "Mint failed");
      setStatus("error");
    }
  }

  const priceUsd = Number(price) || 0;
  const priceEthEquiv = rate ? priceUsd / rate : 0;

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        <div className="sec-title">MINT A TRACK</div>
        <div className="sec-bar" />

        {!token ? (
          <div className="mint-gate">
            <p>Log in to mint a track. It only takes a moment — email or Google, no wallet needed.</p>
            <button className="buy" style={{ width: "auto", padding: "12px 22px" }} onClick={openAuth}>SIGN UP / LOG IN</button>
          </div>
        ) : (
        <>
        <p className="mint-lead">Fill in your track and hit mint — no wallet or crypto needed. It goes live on the marketplace and fans can buy editions with a card or crypto.</p>

        <div className="mint-grid">
          <form className="mint-form" onSubmit={onSubmit}>
            <label className="mint-field"><span>TITLE</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="NEON PULSE" maxLength={60} /></label>
            <label className="mint-field"><span>ARTIST NAME</span><input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="BLOCKJ4NE" maxLength={40} /></label>
            <label className="mint-field"><span>GENRE</span><input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="SYNTHWAVE" maxLength={24} /></label>
            <label className="mint-field"><span>DESCRIPTION (OPTIONAL)</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A late-night synth journey…" maxLength={200} /></label>
            <div className="mint-row">
              <label className="mint-field"><span>MAX SUPPLY (EDITIONS)</span><input type="number" min={1} step={1} value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)} /></label>
              <label className="mint-field">
                <span>PRICE (USD)</span>
                <input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
                {rate && priceUsd > 0 && <small className="mint-hint">≈ {fmtEth(BigInt(Math.round(priceEthEquiv * 1e18)).toString())} ETH on-chain</small>}
              </label>
            </div>
            <label className="mint-field"><span>ROYALTY % (MAX 10)</span><input type="number" min={0} max={10} step="0.5" value={royalty} onChange={(e) => setRoyalty(e.target.value)} /></label>
            <label className="mint-field">
              <span>AUDIO FILE</span>
              <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
              {audioFile && <small className="mint-hint">{audioFile.name}</small>}
            </label>
            <label className="mint-field">
              <span>COVER IMAGE (OPTIONAL — else generative art)</span>
              <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
              {imageFile && <small className="mint-hint">{imageFile.name}</small>}
            </label>

            {status === "error" && <div className="mint-err">{error}</div>}
            <button className="buy" type="submit" disabled={!valid || busy}>
              {busy ? "MINTING…" : "MINT TRACK"}
            </button>

            {status === "done" && created && (
              <div className="mint-ok">
                ✓ Minted as token #{created.chainTokenId}. <Link href={`/track/${created.id}`}>View track →</Link>
              </div>
            )}
          </form>

          <div className="mint-preview">
            <div className="mint-cover"><CoverArt seed={coverSeed} /><div className="genre">{genre || "GENRE"}</div></div>
            <div className="mint-cover-actions">
              <span>cover seed #{coverSeed}</span>
              <button type="button" className="mint-reseed" onClick={() => setCoverSeed(Math.floor(1 + Math.random() * 9999))}>RANDOMIZE</button>
            </div>
            <h3 className="mint-pv-title">{title || "Untitled"}</h3>
            {artist && <div className="mint-hint" style={{ marginBottom: 6 }}>by {artist}</div>}
            <div className="mint-pv-meta">
              <span>{Number(maxSupply) || 0} editions</span>
              <span>${priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              <span>{Number(royalty) || 0}% royalty</span>
            </div>
          </div>
        </div>
        </>
        )}
      </section>
    </div>
  );
}
