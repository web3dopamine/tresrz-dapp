"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseEther, parseEventLogs } from "viem";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import Header from "@/components/Header";
import { CoverArt } from "@/lib/art";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Status = "idle" | "uploading" | "pinning" | "minting" | "confirming" | "persisting" | "done" | "error";

const ZERO = "0x0000000000000000000000000000000000000000";

export default function MintPage() {
  const { isConnected } = useAccount();
  const { token, signIn, loading: authLoading, error: authError } = useAuth();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [maxSupply, setMaxSupply] = useState("10");
  const [price, setPrice] = useState("0.05");
  const [royalty, setRoyalty] = useState("5");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState(""); // optional fallback pasted URL
  const [coverSeed, setCoverSeed] = useState(() => 100 + Math.floor(Math.abs(Math.sin(1) * 9999)));

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; chainTokenId: number | null } | null>(null);

  const busy = status === "uploading" || status === "pinning" || status === "minting" || status === "confirming" || status === "persisting";

  // Audio is required: either a file (primary) or a pasted https URL (fallback).
  const urlValid = /^https?:\/\/.+\..+/i.test(audioUrl.trim());
  const hasAudio = !!audioFile || urlValid;

  const valid = useMemo(() => {
    const ms = Number(maxSupply), pr = Number(price), ry = Number(royalty);
    return (
      title.trim().length > 0 &&
      genre.trim().length > 0 &&
      hasAudio &&
      Number.isFinite(ms) && ms >= 1 &&
      Number.isFinite(pr) && pr >= 0 &&
      Number.isFinite(ry) && ry >= 0 && ry <= 10
    );
  }, [title, genre, hasAudio, maxSupply, price, royalty]);

  const contractReady = MUSIC_CONTRACT && MUSIC_CONTRACT.toLowerCase() !== ZERO;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setError("");
    setCreated(null);
    try {
      const priceWei = parseEther(String(price || "0"));
      const royaltyBps = BigInt(Math.round(Number(royalty) * 100)); // % -> bps
      const supply = BigInt(Math.floor(Number(maxSupply)));

      // 1) upload audio (+ optional image) to IPFS
      setStatus("uploading");
      let audioPin: { url: string | null; uri: string | null; cid: string | null; mime?: string } = {
        url: audioUrl.trim() || null, uri: audioUrl.trim() || null, cid: null,
      };
      if (audioFile) {
        const r = await api.uploadAudio(audioFile);
        audioPin = { url: r.url, uri: r.uri, cid: r.cid, mime: r.mime };
      }
      let imagePin: { url: string | null; uri: string | null } | null = null;
      if (imageFile) {
        const r = await api.uploadImage(imageFile);
        imagePin = { url: r.url, uri: r.uri };
      }

      // 2) pin metadata JSON
      setStatus("pinning");
      const meta = await api.pinMetadata({
        title: title.trim(),
        description: description.trim() || undefined,
        image: imagePin?.uri || undefined,
        audio: audioPin.uri || audioUrl.trim(),
        genre: genre.trim().toUpperCase(),
        attributes: [{ trait_type: "Editions", value: Number(maxSupply) }],
      });
      const metadataUri = meta.uri || meta.url;
      if (!metadataUri) throw new Error("Metadata pin returned no URI");

      // 3) on-chain mint with the pinned metadata URI
      setStatus("minting");
      const hash = await writeContractAsync({
        abi: musicAbi,
        address: MUSIC_CONTRACT,
        functionName: "mintTrack",
        args: [supply, priceWei, royaltyBps, metadataUri],
      });

      // 4) wait for receipt, read trackId from the TrackMinted event
      setStatus("confirming");
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      const events = parseEventLogs({ abi: musicAbi, eventName: "TrackMinted", logs: receipt.logs });
      const trackId = events[0]?.args?.trackId;
      if (trackId === undefined) throw new Error("Mint succeeded but TrackMinted event not found");

      // 5) persist metadata so it shows on the home page
      setStatus("persisting");
      const track = await api.createTrack({
        title: title.trim(),
        genre: genre.trim().toUpperCase(),
        maxSupply: Number(maxSupply),
        priceWei: priceWei.toString(),
        coverSeed,
        audioUrl: audioPin.url || audioUrl.trim() || null,
        audioCid: audioPin.cid,
        coverUrl: imagePin?.url || null,
        metadataUri,
        mime: audioPin.mime || null,
        chainTokenId: Number(trackId),
        txHash: hash,
      });

      setCreated({ id: track.id, chainTokenId: track.chainTokenId });
      setStatus("done");
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || "Mint failed");
      setStatus("error");
    }
  }

  const priceEth = Number(price) || 0;

  return (
    <div className="wrap">
      <Header />

      <section className="block">
        <div className="sec-title">MINT A TRACK</div>
        <div className="sec-bar" />

        {!isConnected ? (
          <div className="mint-gate">
            <p>Connect your wallet to mint a track.</p>
            <ConnectButton showBalance={false} label="CONNECT WALLET" />
          </div>
        ) : !token ? (
          <div className="mint-gate">
            <p>Sign in with Ethereum to prove you own this wallet.</p>
            <button className="buy" disabled={authLoading} onClick={() => { void signIn(); }}>
              {authLoading ? "SIGNING…" : "SIGN IN WITH ETHEREUM"}
            </button>
            {authError && <div className="mint-err">{authError}</div>}
          </div>
        ) : (
          <div className="mint-grid">
            <form className="mint-form" onSubmit={onSubmit}>
              <label className="mint-field">
                <span>TITLE</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="NEON PULSE" maxLength={60} />
              </label>
              <label className="mint-field">
                <span>GENRE</span>
                <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="SYNTHWAVE" maxLength={24} />
              </label>
              <label className="mint-field">
                <span>DESCRIPTION (OPTIONAL)</span>
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A late-night synth journey…" maxLength={200} />
              </label>
              <div className="mint-row">
                <label className="mint-field">
                  <span>MAX SUPPLY (EDITIONS)</span>
                  <input type="number" min={1} step={1} value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)} />
                </label>
                <label className="mint-field">
                  <span>PRICE (ETH)</span>
                  <input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
                </label>
              </div>
              <label className="mint-field">
                <span>ROYALTY % (MAX 10)</span>
                <input type="number" min={0} max={10} step="0.5" value={royalty} onChange={(e) => setRoyalty(e.target.value)} />
              </label>

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

              <label className="mint-field">
                <span>OR PASTE AUDIO URL (FALLBACK)</span>
                <input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="https://…/track.mp3" />
                {!audioFile && audioUrl.trim().length > 0 && !urlValid && (
                  <small className="mint-hint">Enter a direct https link to an audio file.</small>
                )}
                {!hasAudio && <small className="mint-hint">Upload a file or paste a URL — audio is required.</small>}
              </label>

              {!contractReady && <div className="mint-err">No contract configured. Set NEXT_PUBLIC_MUSIC_CONTRACT.</div>}
              {status === "error" && <div className="mint-err">{error}</div>}

              <button className="buy" type="submit" disabled={!valid || busy || !contractReady}>
                {status === "uploading" && "UPLOADING TO IPFS…"}
                {status === "pinning" && "PINNING METADATA…"}
                {status === "minting" && "CONFIRM IN WALLET…"}
                {status === "confirming" && "MINTING ON-CHAIN…"}
                {status === "persisting" && "SAVING METADATA…"}
                {(status === "idle" || status === "error" || status === "done") && "MINT TRACK"}
              </button>

              {status === "done" && created && (
                <div className="mint-ok">
                  ✓ Minted as token #{created.chainTokenId}.{" "}
                  <Link href={`/track/${created.id}`}>View track →</Link>
                </div>
              )}
            </form>

            <div className="mint-preview">
              <div className="mint-cover">
                <CoverArt seed={coverSeed} />
                <div className="genre">{genre || "GENRE"}</div>
              </div>
              <div className="mint-cover-actions">
                <span>cover seed #{coverSeed}</span>
                <button type="button" className="mint-reseed" onClick={() => setCoverSeed(Math.floor(1 + Math.random() * 9999))}>
                  RANDOMIZE
                </button>
              </div>
              <h3 className="mint-pv-title">{title || "Untitled"}</h3>
              <div className="mint-pv-meta">
                <span>{Number(maxSupply) || 0} editions</span>
                <span>{priceEth.toLocaleString(undefined, { maximumFractionDigits: 18 })} ETH</span>
                <span>{Number(royalty) || 0}% royalty</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
