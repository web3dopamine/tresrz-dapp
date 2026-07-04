"use client";
import { useEffect, useMemo, useState } from "react";
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
type Mode = "custodial" | "wallet";
const ZERO = "0x0000000000000000000000000000000000000000";

export default function MintPage() {
  const { isConnected } = useAccount();
  const { token, signIn, loading: authLoading, error: authError } = useAuth();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [mode, setMode] = useState<Mode>("custodial");
  const [custodialEnabled, setCustodialEnabled] = useState<boolean | null>(null);
  useEffect(() => { api.custodialStatus().then((d) => setCustodialEnabled(d.enabled)).catch(() => setCustodialEnabled(false)); }, []);

  // shared form fields
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [maxSupply, setMaxSupply] = useState("10");
  const [price, setPrice] = useState("0.05");
  const [royalty, setRoyalty] = useState("5");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [returningToken, setReturningToken] = useState("");
  const [coverSeed, setCoverSeed] = useState(() => 100 + Math.floor(Math.abs(Math.sin(1) * 9999)));

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; chainTokenId: number | null } | null>(null);
  const [manageToken, setManageToken] = useState<string | null>(null);

  const busy = ["uploading", "pinning", "minting", "confirming", "persisting"].includes(status);
  const urlValid = /^https?:\/\/.+\..+/i.test(audioUrl.trim());
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const contractReady = MUSIC_CONTRACT && MUSIC_CONTRACT.toLowerCase() !== ZERO;

  const baseValid = useMemo(() => {
    const ms = Number(maxSupply), pr = Number(price), ry = Number(royalty);
    return title.trim() && genre.trim() && ms >= 1 && pr >= 0 && ry >= 0 && ry <= 10;
  }, [title, genre, maxSupply, price, royalty]);

  const custodialValid = baseValid && !!audioFile && emailValid;
  const walletValid = baseValid && (!!audioFile || urlValid);

  // ---- custodial (no wallet): platform mints on your behalf ----
  async function submitCustodial(e: React.FormEvent) {
    e.preventDefault();
    if (!custodialValid || busy) return;
    setError(""); setCreated(null); setManageToken(null);
    try {
      setStatus("minting");
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("genre", genre.trim().toUpperCase());
      fd.append("description", description.trim());
      fd.append("maxSupply", String(Math.floor(Number(maxSupply))));
      fd.append("priceEth", String(Number(price)));
      fd.append("royaltyPct", String(Number(royalty)));
      fd.append("coverSeed", String(coverSeed));
      fd.append("email", email.trim());
      if (handle.trim()) fd.append("handle", handle.trim());
      if (returningToken.trim()) fd.append("manageToken", returningToken.trim());
      fd.append("audio", audioFile!);
      if (imageFile) fd.append("image", imageFile);
      const res = await api.custodialMint(fd); // server: upload -> pin -> mint -> account
      setCreated({ id: res.trackId, chainTokenId: res.chainTokenId });
      setManageToken(res.manageToken);
      setStatus("done");
    } catch (err: any) {
      setError(err?.message || "Mint failed");
      setStatus("error");
    }
  }

  // ---- wallet (self-custody): you mint from your own wallet ----
  async function submitWallet(e: React.FormEvent) {
    e.preventDefault();
    if (!walletValid || busy) return;
    setError(""); setCreated(null);
    try {
      const priceWei = parseEther(String(price || "0"));
      const royaltyBps = BigInt(Math.round(Number(royalty) * 100));
      const supply = BigInt(Math.floor(Number(maxSupply)));

      setStatus("uploading");
      let audioPin: { url: string | null; uri: string | null; cid: string | null; mime?: string } = { url: audioUrl.trim() || null, uri: audioUrl.trim() || null, cid: null };
      if (audioFile) { const r = await api.uploadAudio(audioFile); audioPin = { url: r.url, uri: r.uri, cid: r.cid, mime: r.mime }; }
      let imagePin: { url: string | null; uri: string | null } | null = null;
      if (imageFile) { const r = await api.uploadImage(imageFile); imagePin = { url: r.url, uri: r.uri }; }

      setStatus("pinning");
      const meta = await api.pinMetadata({ title: title.trim(), description: description.trim() || undefined, image: imagePin?.uri || undefined, audio: audioPin.uri || audioUrl.trim(), genre: genre.trim().toUpperCase(), attributes: [{ trait_type: "Editions", value: Number(maxSupply) }] });
      const metadataUri = meta.uri || meta.url;
      if (!metadataUri) throw new Error("Metadata pin returned no URI");

      setStatus("minting");
      const hash = await writeContractAsync({ abi: musicAbi, address: MUSIC_CONTRACT, functionName: "mintTrack", args: [supply, priceWei, royaltyBps, metadataUri] });
      setStatus("confirming");
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      const events = parseEventLogs({ abi: musicAbi, eventName: "TrackMinted", logs: receipt.logs });
      const trackId = events[0]?.args?.trackId;
      if (trackId === undefined) throw new Error("Mint succeeded but TrackMinted event not found");

      setStatus("persisting");
      const track = await api.createTrack({ title: title.trim(), genre: genre.trim().toUpperCase(), maxSupply: Number(maxSupply), priceWei: priceWei.toString(), coverSeed, audioUrl: audioPin.url || audioUrl.trim() || null, audioCid: audioPin.cid, coverUrl: imagePin?.url || null, metadataUri, mime: audioPin.mime || null, chainTokenId: Number(trackId), txHash: hash });
      setCreated({ id: track.id, chainTokenId: track.chainTokenId });
      setStatus("done");
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || "Mint failed");
      setStatus("error");
    }
  }

  const priceEth = Number(price) || 0;
  const btnLabel = (
    status === "uploading" ? "UPLOADING TO IPFS…" :
    status === "pinning" ? "PINNING METADATA…" :
    status === "minting" ? (mode === "wallet" ? "CONFIRM IN WALLET…" : "MINTING FOR YOU…") :
    status === "confirming" ? "MINTING ON-CHAIN…" :
    status === "persisting" ? "SAVING METADATA…" :
    "MINT TRACK"
  );

  const fields = (
    <>
      <label className="mint-field"><span>TITLE</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="NEON PULSE" maxLength={60} /></label>
      <label className="mint-field"><span>GENRE</span><input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="SYNTHWAVE" maxLength={24} /></label>
      <label className="mint-field"><span>DESCRIPTION (OPTIONAL)</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A late-night synth journey…" maxLength={200} /></label>
      <div className="mint-row">
        <label className="mint-field"><span>MAX SUPPLY (EDITIONS)</span><input type="number" min={1} step={1} value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)} /></label>
        <label className="mint-field"><span>PRICE (ETH)</span><input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      </div>
      <label className="mint-field"><span>ROYALTY % (MAX 10)</span><input type="number" min={0} max={10} step="0.5" value={royalty} onChange={(e) => setRoyalty(e.target.value)} /></label>
      <label className="mint-field">
        <span>AUDIO FILE{mode === "custodial" ? "" : " (OR PASTE URL BELOW)"}</span>
        <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
        {audioFile && <small className="mint-hint">{audioFile.name}</small>}
      </label>
      <label className="mint-field">
        <span>COVER IMAGE (OPTIONAL — else generative art)</span>
        <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
        {imageFile && <small className="mint-hint">{imageFile.name}</small>}
      </label>
    </>
  );

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        <div className="sec-title">MINT A TRACK</div>
        <div className="sec-bar" />

        {/* mode selector */}
        <div className="mint-modes">
          <button type="button" className={`mint-mode${mode === "custodial" ? " active" : ""}`} onClick={() => { setMode("custodial"); setStatus("idle"); }} disabled={custodialEnabled === false}>
            <b>NO WALLET NEEDED</b>
            <span>We mint it for you. Add a payout wallet later to withdraw earnings.</span>
          </button>
          <button type="button" className={`mint-mode${mode === "wallet" ? " active" : ""}`} onClick={() => { setMode("wallet"); setStatus("idle"); }}>
            <b>USE MY WALLET</b>
            <span>Self-custody. Mint from your own wallet (needs a little gas).</span>
          </button>
        </div>

        {mode === "custodial" ? (
          custodialEnabled === false ? (
            <div className="mint-gate"><p>Wallet-free minting isn’t configured on this deployment. Switch to “Use my wallet”.</p></div>
          ) : (
            <div className="mint-grid">
              <form className="mint-form" onSubmit={submitCustodial}>
                {fields}
                <label className="mint-field"><span>YOUR EMAIL (to manage &amp; get paid)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />{email && !emailValid && <small className="mint-hint">Enter a valid email.</small>}</label>
                <label className="mint-field"><span>ARTIST NAME (OPTIONAL)</span><input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="BLOCKJ4NE" maxLength={40} /></label>
                <label className="mint-field"><span>RETURNING? PASTE YOUR MANAGE KEY (OPTIONAL — keeps all tracks &amp; earnings in one account)</span><input value={returningToken} onChange={(e) => setReturningToken(e.target.value)} placeholder="leave blank if this is your first track" spellCheck={false} /></label>

                {status === "error" && <div className="mint-err">{error}</div>}
                <button className="buy" type="submit" disabled={!custodialValid || busy}>{busy ? btnLabel : "MINT — NO WALLET"}</button>

                {status === "done" && created && manageToken && (
                  <div className="mint-ok mint-ok-box">
                    <b>✓ Minted as token #{created.chainTokenId}!</b>
                    <p>Save this manage key — it’s how you track earnings and withdraw. We can’t recover it for you.</p>
                    <code className="mint-token">{manageToken}</code>
                    <div className="mint-ok-actions">
                      <Link className="buy mint-mini" href={`/creator?token=${encodeURIComponent(manageToken)}`}>OPEN DASHBOARD →</Link>
                      <Link className="buy mint-mini mint-ghost" href={`/track/${created.id}`}>VIEW TRACK</Link>
                    </div>
                  </div>
                )}
              </form>
              {previewPane(coverSeed, genre, setCoverSeed, title, maxSupply, priceEth, royalty)}
            </div>
          )
        ) : !isConnected ? (
          <div className="mint-gate"><p>Connect your wallet to mint a track yourself.</p><ConnectButton showBalance={false} label="CONNECT WALLET" /></div>
        ) : !token ? (
          <div className="mint-gate">
            <p>Sign in with Ethereum to prove you own this wallet.</p>
            <button className="buy" disabled={authLoading} onClick={() => void signIn()}>{authLoading ? "SIGNING…" : "SIGN IN WITH ETHEREUM"}</button>
            {authError && <div className="mint-err">{authError}</div>}
          </div>
        ) : (
          <div className="mint-grid">
            <form className="mint-form" onSubmit={submitWallet}>
              {fields}
              <label className="mint-field"><span>OR PASTE AUDIO URL (FALLBACK)</span><input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="https://…/track.mp3" />{!audioFile && audioUrl.trim() && !urlValid && <small className="mint-hint">Enter a direct https link to an audio file.</small>}</label>
              {!contractReady && <div className="mint-err">No contract configured.</div>}
              {status === "error" && <div className="mint-err">{error}</div>}
              <button className="buy" type="submit" disabled={!walletValid || busy || !contractReady}>{btnLabel}</button>
              {status === "done" && created && <div className="mint-ok">✓ Minted as token #{created.chainTokenId}. <Link href={`/track/${created.id}`}>View track →</Link></div>}
            </form>
            {previewPane(coverSeed, genre, setCoverSeed, title, maxSupply, priceEth, royalty)}
          </div>
        )}
      </section>
    </div>
  );
}

function previewPane(coverSeed: number, genre: string, setCoverSeed: (n: number) => void, title: string, maxSupply: string, priceEth: number, royalty: string) {
  return (
    <div className="mint-preview">
      <div className="mint-cover"><CoverArt seed={coverSeed} /><div className="genre">{genre || "GENRE"}</div></div>
      <div className="mint-cover-actions">
        <span>cover seed #{coverSeed}</span>
        <button type="button" className="mint-reseed" onClick={() => setCoverSeed(Math.floor(1 + Math.random() * 9999))}>RANDOMIZE</button>
      </div>
      <h3 className="mint-pv-title">{title || "Untitled"}</h3>
      <div className="mint-pv-meta">
        <span>{Number(maxSupply) || 0} editions</span>
        <span>{priceEth.toLocaleString(undefined, { maximumFractionDigits: 18 })} ETH</span>
        <span>{Number(royalty) || 0}% royalty</span>
      </div>
    </div>
  );
}
