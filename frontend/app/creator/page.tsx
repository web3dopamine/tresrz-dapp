"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatEther } from "viem";
import Header from "@/components/Header";
import { CoverArt } from "@/lib/art";
import { api } from "@/lib/api";
import { useUsdRate, usd, fmtEth } from "@/lib/usd";

function CreatorDashboard() {
  const params = useSearchParams();
  const rate = useUsdRate();
  const [token, setToken] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.creatorMe>> | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [err, setErr] = useState("");
  const [payoutAddr, setPayoutAddr] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const t = params.get("token");
    if (t) { setToken(t); load(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(t: string) {
    setState("loading"); setErr("");
    try { setData(await api.creatorMe(t)); setState("ready"); }
    catch (e: any) { setErr(e?.message || "Could not load"); setState("error"); }
  }

  async function withdraw() {
    if (!/^0x[a-fA-F0-9]{40}$/.test(payoutAddr.trim())) { setMsg("Enter a valid 0x wallet address"); return; }
    setWithdrawing(true); setMsg("");
    try {
      const res = await api.creatorWithdraw({ token, address: payoutAddr.trim() });
      setMsg(`✓ Sent ${fmtEth(res.amountWei)} ETH to your wallet`);
      load(token);
    } catch (e: any) { setMsg(e?.message || "Withdrawal failed"); }
    finally { setWithdrawing(false); }
  }

  const balUsd = useMemo(() => usd(data?.balanceWei ?? null, rate), [data, rate]);
  const hasBalance = data && BigInt(data.balanceWei || "0") > 0n;

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        <div className="sec-title">CREATOR DASHBOARD</div>
        <div className="sec-bar" />

        {state === "idle" && (
          <div className="cr-gate">
            <p>Paste your manage key to view earnings and withdraw.</p>
            <div className="cr-tokenrow">
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="your manage key" spellCheck={false} />
              <button className="buy" onClick={() => token && load(token)}>OPEN</button>
            </div>
          </div>
        )}
        {state === "loading" && <div className="muted-note">Loading your dashboard…</div>}
        {state === "error" && (
          <div className="cr-gate">
            <div className="mint-err">{err}</div>
            <div className="cr-tokenrow" style={{ marginTop: 14 }}>
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="your manage key" spellCheck={false} />
              <button className="buy" onClick={() => token && load(token)}>RETRY</button>
            </div>
          </div>
        )}

        {state === "ready" && data && (
          <>
            <div className="cr-top">
              <div className="cr-earn">
                <span>WITHDRAWABLE EARNINGS</span>
                <b>{balUsd ?? `${fmtEth(data.balanceWei)} ETH`}</b>
                {balUsd && <em>{fmtEth(data.balanceWei)} ETH</em>}
              </div>
              <div className="cr-withdraw">
                <input value={payoutAddr} onChange={(e) => setPayoutAddr(e.target.value)} placeholder="0x wallet to receive payout" spellCheck={false} />
                <button className="buy" disabled={withdrawing || !hasBalance} onClick={withdraw}>
                  {withdrawing ? "SENDING…" : hasBalance ? "WITHDRAW" : "NO EARNINGS YET"}
                </button>
              </div>
            </div>
            {msg && <div className="cr-msg">{msg}</div>}

            <div className="sec-title" style={{ fontSize: 15, marginTop: 26 }}>YOUR TRACKS</div>
            <div className="sec-bar" />
            {data.tracks.length === 0 ? <div className="muted-note">No tracks yet.</div> : (
              <div className="cr-tracks">
                {data.tracks.map((t) => (
                  <Link key={t.id} href={`/track/${t.id}`} className="cr-track">
                    <span className="cr-cover"><CoverArt seed={t.coverSeed} /></span>
                    <span className="cr-tmeta">
                      <b>{t.title}</b>
                      <small>{t.genre} · token #{t.chainTokenId ?? "—"}{t.flagged ? " · flagged" : ""}</small>
                    </span>
                    <span className="cr-tstats">
                      <span>{usd(t.priceWei, rate) ?? `${fmtEth(t.priceWei)} ETH`}</span>
                      <small>{t.minted}/{t.maxSupply} sold · ♥ {t.likes}</small>
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <p className="cr-hint">Earnings accrue automatically as your editions sell (card or crypto). Withdraw any time to a wallet you control.</p>
          </>
        )}
      </section>

      <style jsx>{`
        .cr-gate { display: flex; flex-direction: column; gap: 12px; max-width: 520px; }
        .cr-gate p { color: var(--muted); font-size: 13px; }
        .cr-tokenrow { display: flex; gap: 10px; }
        .cr-tokenrow input, .cr-withdraw input { flex: 1; background: transparent; border: 1.5px solid var(--card-line); color: var(--ink); font-family: var(--mono); font-size: 13px; padding: 11px 12px; border-radius: 4px; outline: none; }
        .cr-tokenrow input:focus, .cr-withdraw input:focus { border-color: var(--crimson); box-shadow: var(--glow); }
        .cr-tokenrow .buy, .cr-withdraw .buy { width: auto; padding: 11px 18px; margin: 0; }
        .cr-top { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; align-items: stretch; }
        .cr-earn { background: var(--card-grad); border: 1px solid var(--card-line); border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 5px; }
        .cr-earn span { font-family: var(--mono); font-size: 10px; letter-spacing: 1.2px; color: var(--muted); }
        .cr-earn b { font-family: var(--display); font-size: 34px; color: var(--ink); line-height: 1; }
        .cr-earn em { font-style: normal; font-family: var(--mono); font-size: 12px; color: var(--muted); }
        .cr-withdraw { background: var(--card-grad); border: 1px solid var(--card-line); border-radius: 12px; padding: 18px 20px; display: flex; gap: 10px; align-items: center; }
        .cr-msg { margin-top: 12px; font-family: var(--mono); font-size: 12px; color: var(--crimson-soft); }
        .cr-tracks { display: flex; flex-direction: column; gap: 8px; }
        .cr-track { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--card-line); border-radius: 10px; text-decoration: none; transition: .15s; }
        .cr-track:hover { border-color: var(--crimson); }
        .cr-cover { width: 46px; height: 46px; border-radius: 8px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--card-line); }
        .cr-cover :global(svg), .cr-cover > :global(*) { width: 100%; height: 100%; }
        .cr-tmeta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
        .cr-tmeta b { color: var(--ink); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cr-tmeta small { color: var(--muted); font-size: 11px; }
        .cr-tstats { display: flex; flex-direction: column; align-items: flex-end; text-align: right; }
        .cr-tstats span { font-family: var(--mono); font-size: 13px; color: var(--ink); }
        .cr-tstats small { color: var(--muted); font-size: 11px; white-space: nowrap; }
        .cr-hint { margin-top: 16px; font-size: 11px; color: var(--muted); opacity: .85; }
        [data-theme="light"] .cr-earn, [data-theme="light"] .cr-withdraw { border: 2px solid var(--navy); box-shadow: 4px 4px 0 var(--navy); }
        [data-theme="light"] .cr-track { border: 2px solid var(--navy); }
        [data-theme="light"] .cr-tokenrow input, [data-theme="light"] .cr-withdraw input { border: 2px solid var(--navy); }
        @media (max-width: 720px) { .cr-top { grid-template-columns: 1fr; } .cr-withdraw { flex-wrap: wrap; } .cr-withdraw input { flex: 1 1 100%; } }
      `}</style>
    </div>
  );
}

export default function CreatorPage() {
  return <Suspense fallback={<div className="wrap"><Header /><section className="block"><div className="muted-note">Loading…</div></section></div>}><CreatorDashboard /></Suspense>;
}
