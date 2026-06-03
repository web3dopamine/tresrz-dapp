"use client";
import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { CoverArt, avatarUrl } from "@/lib/art";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { api, type Track } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function TrackCard({ t, toast }: { t: Track; toast: (m: string) => void }) {
  const [playing, setPlaying] = useState(false);
  const [left, setLeft] = useState(t.left);
  const [busy, setBusy] = useState(false);
  const { isConnected } = useAccount();
  const { token } = useAuth();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const priceEth = (() => { try { return formatEther(BigInt(t.priceWei)); } catch { return "0"; } })();

  async function buy() {
    if (!isConnected || !token) return toast("Connect your wallet first");
    if (t.chainTokenId == null) return toast("Track not yet on-chain");
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        abi: musicAbi, address: MUSIC_CONTRACT, functionName: "buy",
        args: [BigInt(t.chainTokenId), 1n], value: parseEther(priceEth),
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await api.recordSale({ trackId: t.id, qty: 1, priceWei: t.priceWei, txHash: hash });
      setLeft((l) => Math.max(0, l - 1));
      toast(`Bought ${t.title} ✓`);
    } catch (e: any) {
      toast(e?.shortMessage || "Purchase cancelled");
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className={`art${playing ? " playing" : ""}`} onClick={() => setPlaying((p) => !p)}>
        <CoverArt seed={t.coverSeed} />
        <div className="genre">{t.genre}</div>
        <div className="play"><div className="pbtn"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></div></div>
        <div className="wave">{Array.from({ length: 22 }).map((_, i) => <i key={i} style={{ animationDelay: `${i * 0.06}s` }} />)}</div>
      </div>
      <h3>{t.title}</h3>
      <div className="by"><img src={avatarUrl(t.artist.avatarSeed)} alt="" /><span>by <b>{t.artist.handle}</b></span></div>
      <div className="price">{Number(priceEth).toFixed(2)} ETH <em>{left} left</em></div>
      <button className="buy" disabled={busy || left === 0} onClick={buy}>{left === 0 ? "SOLD OUT" : busy ? "CONFIRMING…" : "BUY NOW"}</button>
    </div>
  );
}
