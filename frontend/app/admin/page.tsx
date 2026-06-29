"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useReadContracts, useWriteContract, usePublicClient } from "wagmi";
import Header from "@/components/Header";
import { musicAbi, MUSIC_CONTRACT } from "@/lib/abi";
import { marketAbi, MARKET_CONTRACT } from "@/lib/marketAbi";
import { api, type AdminStats, type AdminTrack, type AdminUser } from "@/lib/api";

type Gate = "loading" | "denied" | "ok";

export default function AdminPage() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [gate, setGate] = useState<Gate>("loading");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [msg, setMsg] = useState("");
  const tRef = useRef<any>(null);
  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2600); }

  // fee config form state
  const [musicFee, setMusicFee] = useState("");
  const [musicRecipient, setMusicRecipient] = useState("");
  const [marketFee, setMarketFee] = useState("");
  const [marketRecipient, setMarketRecipient] = useState("");
  const [savingFee, setSavingFee] = useState(false);

  function refreshAll() {
    api.adminStats().then(setStats).catch(() => {});
    api.adminTracks().then(setTracks).catch(() => {});
    api.adminUsers().then(setUsers).catch(() => {});
  }

  useEffect(() => {
    api.me()
      .then((d) => {
        if (d.isAdmin) { setGate("ok"); refreshAll(); }
        else setGate("denied");
      })
      .catch(() => setGate("denied"));
  }, []);

  // read fee/recipient/owner from BOTH contracts
  const configCalls = useMemo(() => [
    { abi: musicAbi, address: MUSIC_CONTRACT, functionName: "platformFeeBps" as const },
    { abi: musicAbi, address: MUSIC_CONTRACT, functionName: "feeRecipient" as const },
    { abi: musicAbi, address: MUSIC_CONTRACT, functionName: "owner" as const },
    { abi: marketAbi, address: MARKET_CONTRACT, functionName: "platformFeeBps" as const },
    { abi: marketAbi, address: MARKET_CONTRACT, functionName: "feeRecipient" as const },
    { abi: marketAbi, address: MARKET_CONTRACT, functionName: "owner" as const },
  ], []);

  const { data: cfg, refetch: refetchCfg } = useReadContracts({
    contracts: configCalls,
    query: { enabled: gate === "ok" },
  });

  const read = (i: number) => (cfg && cfg[i]?.status === "success" ? cfg[i].result : undefined);
  const musicFeeNow = read(0); const musicRecipNow = read(1) as string | undefined; const musicOwner = read(2) as string | undefined;
  const marketFeeNow = read(3); const marketRecipNow = read(4) as string | undefined; const marketOwner = read(5) as string | undefined;

  async function writeConfig(which: "music" | "market", fn: "setPlatformFee" | "setFeeRecipient", arg: any) {
    setSavingFee(true);
    try {
      const hash =
        which === "music"
          ? await writeContractAsync({ abi: musicAbi, address: MUSIC_CONTRACT, functionName: fn, args: [arg] })
          : await writeContractAsync({ abi: marketAbi, address: MARKET_CONTRACT, functionName: fn, args: [arg] });
      await publicClient?.waitForTransactionReceipt({ hash });
      toast("Saved on-chain ✓");
      refetchCfg();
    } catch (e: any) {
      toast(e?.shortMessage || e?.message || "Transaction failed");
    } finally {
      setSavingFee(false);
    }
  }

  async function toggleFeature(t: AdminTrack) {
    try { await api.adminFeature(t.id, !t.hot); toast("Updated ✓"); api.adminTracks().then(setTracks).catch(() => {}); }
    catch (e: any) { toast(e?.message || "Failed"); }
  }
  async function toggleFlagTrack(t: AdminTrack) {
    try { await api.adminFlagTrack(t.id, !t.flagged); toast("Updated ✓"); api.adminTracks().then(setTracks).catch(() => {}); }
    catch (e: any) { toast(e?.message || "Failed"); }
  }
  async function toggleFlagUser(u: AdminUser) {
    try { await api.adminFlagUser(u.id, !u.flagged); toast("Updated ✓"); api.adminUsers().then(setUsers).catch(() => {}); }
    catch (e: any) { toast(e?.message || "Failed"); }
  }

  if (gate === "loading") {
    return (
      <div className="wrap"><Header />
        <section className="block"><div className="muted-note">Checking admin access…</div></section>
      </div>
    );
  }
  if (gate === "denied") {
    return (
      <div className="wrap"><Header />
        <section className="block">
          <div className="sec-title">ADMIN</div><div className="sec-bar" />
          <div className="mint-gate"><p>Admins only. This account does not have admin access.</p></div>
        </section>
      </div>
    );
  }

  const isMusicOwner = !!address && !!musicOwner && address.toLowerCase() === musicOwner.toLowerCase();
  const isMarketOwner = !!address && !!marketOwner && address.toLowerCase() === marketOwner.toLowerCase();

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        <div className="sec-title">ADMIN DASHBOARD</div>
        <div className="sec-bar" />

        {/* stats */}
        {stats && (
          <div className="ad-stats">
            <div className="ad-card"><span>USERS</span><b>{stats.users}</b></div>
            <div className="ad-card"><span>TRACKS</span><b>{stats.tracks}</b></div>
            <div className="ad-card"><span>SALES</span><b>{stats.sales}</b></div>
            <div className="ad-card"><span>FEATURED</span><b>{stats.featured}</b></div>
            <div className="ad-card"><span>FLAGGED TRACKS</span><b>{stats.flaggedTracks}</b></div>
            <div className="ad-card"><span>FLAGGED USERS</span><b>{stats.flaggedUsers}</b></div>
          </div>
        )}

        {/* fee & royalty config */}
        <div className="sec-title" style={{ marginTop: 30 }}>FEE &amp; ROYALTY CONFIG</div>
        <div className="sec-bar" />
        <p className="ad-note">The connected wallet must be the contract owner to save changes.</p>
        <div className="ad-cfg-grid">
          <div className="ad-panel">
            <h4>MUSIC CONTRACT</h4>
            <div className="ad-kv">owner <code>{musicOwner ?? "—"}</code>{isMusicOwner && <em className="ad-you">you</em>}</div>
            <div className="ad-kv">current fee <b>{musicFeeNow != null ? `${Number(musicFeeNow)} bps` : "—"}</b></div>
            <div className="ad-kv">recipient <code>{musicRecipNow ?? "—"}</code></div>
            <div className="ad-row">
              <input type="number" min={0} placeholder="new fee (bps)" value={musicFee} onChange={(e) => setMusicFee(e.target.value)} />
              <button className="buy ad-mini" disabled={!isMusicOwner || savingFee || musicFee === ""} onClick={() => writeConfig("music", "setPlatformFee", Number(musicFee))}>SAVE FEE</button>
            </div>
            <div className="ad-row">
              <input placeholder="new recipient 0x…" value={musicRecipient} onChange={(e) => setMusicRecipient(e.target.value)} />
              <button className="buy ad-mini" disabled={!isMusicOwner || savingFee || !/^0x[a-fA-F0-9]{40}$/.test(musicRecipient)} onClick={() => writeConfig("music", "setFeeRecipient", musicRecipient as `0x${string}`)}>SAVE</button>
            </div>
          </div>

          <div className="ad-panel">
            <h4>MARKETPLACE CONTRACT</h4>
            <div className="ad-kv">owner <code>{marketOwner ?? "—"}</code>{isMarketOwner && <em className="ad-you">you</em>}</div>
            <div className="ad-kv">current fee <b>{marketFeeNow != null ? `${Number(marketFeeNow)} bps` : "—"}</b></div>
            <div className="ad-kv">recipient <code>{marketRecipNow ?? "—"}</code></div>
            <div className="ad-row">
              <input type="number" min={0} placeholder="new fee (bps)" value={marketFee} onChange={(e) => setMarketFee(e.target.value)} />
              <button className="buy ad-mini" disabled={!isMarketOwner || savingFee || marketFee === ""} onClick={() => writeConfig("market", "setPlatformFee", Number(marketFee))}>SAVE FEE</button>
            </div>
            <div className="ad-row">
              <input placeholder="new recipient 0x…" value={marketRecipient} onChange={(e) => setMarketRecipient(e.target.value)} />
              <button className="buy ad-mini" disabled={!isMarketOwner || savingFee || !/^0x[a-fA-F0-9]{40}$/.test(marketRecipient)} onClick={() => writeConfig("market", "setFeeRecipient", marketRecipient as `0x${string}`)}>SAVE</button>
            </div>
          </div>
        </div>

        {/* featured + moderation: tracks */}
        <div className="sec-title" style={{ marginTop: 30 }}>TRACKS · FEATURE &amp; MODERATION</div>
        <div className="sec-bar" />
        <div className="ad-table">
          <div className="ad-tr ad-th"><span>TITLE</span><span>ARTIST</span><span>FEATURED</span><span>FLAGGED</span></div>
          {tracks.length === 0 ? <div className="muted-note">No tracks.</div> : tracks.map((t) => (
            <div className="ad-tr" key={t.id}>
              <span>{t.title}</span>
              <span className="ad-dim">{t.artist?.handle ?? "—"}</span>
              <span><button className={`ad-toggle${t.hot ? " on" : ""}`} onClick={() => toggleFeature(t)}>{t.hot ? "FEATURED" : "FEATURE"}</button></span>
              <span><button className={`ad-toggle${t.flagged ? " danger" : ""}`} onClick={() => toggleFlagTrack(t)}>{t.flagged ? "FLAGGED" : "FLAG"}</button></span>
            </div>
          ))}
        </div>

        {/* moderation: users */}
        <div className="sec-title" style={{ marginTop: 30 }}>USERS · MODERATION</div>
        <div className="sec-bar" />
        <div className="ad-table">
          <div className="ad-tr ad-th"><span>HANDLE</span><span>ADDRESS</span><span>TRACKS</span><span>FLAGGED</span></div>
          {users.length === 0 ? <div className="muted-note">No users.</div> : users.map((u) => (
            <div className="ad-tr" key={u.id}>
              <span>{u.handle || "—"}</span>
              <span className="ad-dim">{u.address.slice(0, 8)}…{u.address.slice(-4)}</span>
              <span className="ad-dim">{u._count?.tracks ?? 0}</span>
              <span><button className={`ad-toggle${u.flagged ? " danger" : ""}`} onClick={() => toggleFlagUser(u)}>{u.flagged ? "FLAGGED" : "FLAG"}</button></span>
            </div>
          ))}
        </div>
      </section>
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>

      <style jsx>{`
        .ad-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
        .ad-card { background: linear-gradient(180deg, #0a1c30, #06121f); border: 1px solid var(--card-line, rgba(245,132,38,.25)); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 6px; }
        .ad-card span { font-family: var(--mono, monospace); font-size: 10px; letter-spacing: .08em; color: var(--muted, #bec0c2); }
        .ad-card b { font-size: 26px; }
        .ad-note { font-family: var(--mono, monospace); font-size: 12px; color: var(--muted, #bec0c2); margin: 8px 0 14px; }
        .ad-cfg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
        .ad-panel { background: linear-gradient(180deg, #0a1c30, #06121f); border: 1px solid var(--card-line, rgba(245,132,38,.25)); border-radius: 12px; padding: 18px; }
        .ad-panel h4 { margin: 0 0 12px; font-family: var(--mono, monospace); font-size: 12px; letter-spacing: .08em; }
        .ad-kv { font-family: var(--mono, monospace); font-size: 12px; color: var(--muted, #bec0c2); margin-bottom: 6px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .ad-kv code { color: var(--ink, #fff); word-break: break-all; }
        .ad-kv b { color: var(--ink, #fff); }
        .ad-you { color: var(--crimson-soft, #ffa052); font-style: normal; font-size: 10px; }
        .ad-row { display: flex; gap: 8px; margin-top: 10px; }
        .ad-row input { flex: 1; background: transparent; border: 1.5px solid rgba(245,132,38,.45); color: var(--ink, #fff); font-family: var(--mono, monospace); font-size: 12px; padding: 9px 10px; border-radius: 3px; outline: none; }
        .ad-row input:focus { border-color: var(--crimson, #f58426); box-shadow: var(--glow); }
        .ad-mini { width: auto; padding: 9px 14px; font-size: 11px; }
        .ad-table { display: flex; flex-direction: column; gap: 6px; }
        .ad-tr { display: grid; grid-template-columns: 2fr 1.5fr 1fr 1fr; gap: 10px; align-items: center; padding: 10px 12px; background: linear-gradient(180deg, #0a1c30, #06121f); border: 1px solid var(--card-line, rgba(245,132,38,.18)); border-radius: 6px; font-size: 13px; }
        .ad-th { background: transparent; border: none; font-family: var(--mono, monospace); font-size: 10px; letter-spacing: .08em; color: var(--muted, #bec0c2); padding-bottom: 0; }
        .ad-dim { color: var(--muted, #bec0c2); font-family: var(--mono, monospace); font-size: 12px; }
        .ad-toggle { font-family: var(--mono, monospace); font-size: 10px; font-weight: 700; letter-spacing: .05em; padding: 6px 12px; border-radius: 3px; cursor: pointer; background: transparent; border: 1.5px solid rgba(245,132,38,.4); color: var(--muted, #bec0c2); transition: .2s; }
        .ad-toggle.on { border-color: var(--crimson, #f58426); color: #fff; box-shadow: var(--glow); }
        .ad-toggle.danger { border-color: #f58426; color: #ffa052; background: rgba(245,132,38,.12); }
      `}</style>
    </div>
  );
}
