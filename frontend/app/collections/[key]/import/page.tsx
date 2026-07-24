"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import { api, type CollectionDetail, type BulkJob } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * Self-serve BULK upload for a collection owner. Two input styles:
 *  - URL: a metadata base URL (folder of N.json files, OpenSea/IPFS-drop style)
 *  - CSV: a spreadsheet of rows (name, price, image, media, rarity, genre)
 * Both kick off a background job on the backend; this page polls it and shows a
 * live progress bar. Items appear in the collection immediately (buy stays gated
 * until they're minted on-chain — a separate step).
 */
export default function BulkImportPage() {
  const { key } = useParams<{ key: string }>();
  const { me, token, openAuth } = useAuth();
  const [col, setCol] = useState<CollectionDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [mode, setMode] = useState<"url" | "csv">("url");

  // URL form
  const [baseUrl, setBaseUrl] = useState("");
  const [start, setStart] = useState("1");
  const [end, setEnd] = useState("100");
  const [ext, setExt] = useState(".json");
  // CSV form
  const [file, setFile] = useState<File | null>(null);
  // shared
  const [defaultPrice, setDefaultPrice] = useState("15");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [job, setJob] = useState<BulkJob | null>(null);
  const poll = useRef<any>(null);

  useEffect(() => {
    api.collection(key).then((c) => { setCol(c); setState("ready"); }).catch(() => setState("missing"));
  }, [key]);
  useEffect(() => () => clearInterval(poll.current), []);

  const isOwner = !!me && !!col && col.owner.id === me.id;

  function track(jobId: string) {
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const j = await api.bulkJob(jobId);
        setJob(j);
        if (j.status !== "running") { clearInterval(poll.current); setBusy(false); }
      } catch { clearInterval(poll.current); setBusy(false); }
    }, 1000);
  }

  async function startUrl() {
    if (!col) return;
    setErr(""); setBusy(true); setJob(null);
    try {
      const { jobId } = await api.bulkImportUrl({
        collectionId: col.id, baseUrl: baseUrl.trim(), start: Number(start), end: Number(end),
        ext: ext.trim() || ".json", defaultPriceUsd: Number(defaultPrice) || 15,
      });
      track(jobId);
    } catch (e: any) { setErr(e?.message || "Could not start import"); setBusy(false); }
  }

  async function startCsv() {
    if (!col || !file) return;
    setErr(""); setBusy(true); setJob(null);
    try {
      const { jobId } = await api.bulkImportCsv(col.id, file, Number(defaultPrice) || 15);
      track(jobId);
    } catch (e: any) { setErr(e?.message || "Could not start import"); setBusy(false); }
  }

  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        {state === "loading" && <div className="muted-note">Loading…</div>}
        {state === "missing" && <div className="muted-note">Collection not found. <Link href="/#collections" style={{ color: "var(--crimson-soft)" }}>← All collections</Link></div>}
        {state === "ready" && col && (
          <>
            <div className="sec-title">BULK UPLOAD → {col.name}</div>
            <div className="sec-bar" />

            {!token ? (
              <div className="mint-gate"><p>Log in to bulk-upload into this collection.</p>
                <button className="buy" style={{ width: "auto", padding: "12px 22px" }} onClick={openAuth}>SIGN UP / LOG IN</button></div>
            ) : !isOwner ? (
              <div className="muted-note">Only the collection owner can bulk-upload here. <Link href={`/collections/${col.slug}`} style={{ color: "var(--crimson-soft)" }}>← Back to collection</Link></div>
            ) : (
              <div className="bi">
                <p className="mint-lead">Add many items at once. They appear in <b>{col.name}</b> right away; on-chain minting is a separate step, so this never spends gas.</p>

                <div className="bi-tabs">
                  <button className={`bi-tab${mode === "url" ? " on" : ""}`} onClick={() => setMode("url")}>FROM A URL</button>
                  <button className={`bi-tab${mode === "csv" ? " on" : ""}`} onClick={() => setMode("csv")}>FROM A CSV</button>
                </div>

                {mode === "url" ? (
                  <div className="bi-form">
                    <label className="mint-field"><span>METADATA BASE URL</span>
                      <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gateway/ipfs/<cid>" spellCheck={false} /></label>
                    <p className="bi-hint">We fetch <code>{"<base>/<n>" + (ext || ".json")}</code> for each number in the range. Each JSON should have <code>name</code>, <code>image</code>, <code>animation_url</code>, and optional <code>attributes</code> (with a <code>Rarity</code> trait for auto-pricing).</p>
                    <div className="bi-row3">
                      <label className="mint-field"><span>START #</span><input value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" /></label>
                      <label className="mint-field"><span>END #</span><input value={end} onChange={(e) => setEnd(e.target.value)} inputMode="numeric" /></label>
                      <label className="mint-field"><span>FILE EXT</span><input value={ext} onChange={(e) => setExt(e.target.value)} /></label>
                    </div>
                    <label className="mint-field"><span>DEFAULT PRICE (USD) — used when an item has no known rarity/price</span>
                      <input value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} inputMode="decimal" /></label>
                    {err && <div className="mint-err">{err}</div>}
                    <button className="buy" disabled={busy || !baseUrl.trim()} onClick={startUrl}>{busy ? "IMPORTING…" : "START IMPORT"}</button>
                  </div>
                ) : (
                  <div className="bi-form">
                    <p className="bi-hint">CSV with a header row. Recognized columns (any order): <code>name</code>, <code>price</code> (USD), <code>image</code>, <code>media</code>, <code>rarity</code>, <code>genre</code>. Only <code>name</code> is required.</p>
                    <label className="mint-field"><span>CSV FILE</span>
                      <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
                    <label className="mint-field"><span>DEFAULT PRICE (USD) — used for rows without a price</span>
                      <input value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} inputMode="decimal" /></label>
                    {err && <div className="mint-err">{err}</div>}
                    <button className="buy" disabled={busy || !file} onClick={startCsv}>{busy ? "IMPORTING…" : "START IMPORT"}</button>
                  </div>
                )}

                {job && (
                  <div className="bi-prog">
                    <div className="bi-bar"><div className="bi-fill" style={{ width: `${pct}%` }} /></div>
                    <div className="bi-stats">
                      <span>{job.done} / {job.total} ({pct}%)</span>
                      <span className="bi-ok">✓ {job.created} created</span>
                      {job.skipped > 0 && <span>↷ {job.skipped} skipped</span>}
                      {job.failed > 0 && <span className="bi-fail">✕ {job.failed} failed</span>}
                      <span className={`bi-status ${job.status}`}>{job.status === "running" ? "importing…" : job.status === "done" ? "complete" : "error"}</span>
                    </div>
                    {job.status !== "running" && (
                      <div className="bi-done">
                        <Link className="buy" style={{ display: "inline-block", width: "auto", padding: "10px 22px", textDecoration: "none" }} href={`/collections/${col.slug}`}>VIEW COLLECTION →</Link>
                        {job.errors.length > 0 && <details className="bi-errs"><summary>{job.errors.length} error sample(s)</summary><ul>{job.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <style jsx>{`
        .bi { max-width: 640px; }
        .bi-tabs { display: flex; gap: 8px; margin: 18px 0 16px; }
        .bi-tab { font-family: var(--mono, monospace); font-size: 12px; font-weight: 700; letter-spacing: .05em; padding: 9px 16px; border-radius: 8px; border: 1.5px solid var(--card-line, rgba(255,255,255,.14)); background: transparent; color: var(--ink); cursor: pointer; }
        .bi-tab.on { background: var(--crimson, #f58426); border-color: var(--crimson, #f58426); color: #fff; }
        .bi-form { display: flex; flex-direction: column; gap: 14px; }
        .bi-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
        .bi-hint { font-size: 12.5px; color: var(--muted); line-height: 1.5; }
        .bi-hint code { background: var(--input-bg, rgba(255,255,255,.06)); padding: 1px 5px; border-radius: 4px; font-size: 11.5px; }
        .bi-prog { margin-top: 26px; padding: 18px; border: 1.5px solid var(--card-line, rgba(255,255,255,.12)); border-radius: 12px; }
        .bi-bar { height: 10px; border-radius: 6px; background: var(--input-bg, rgba(255,255,255,.08)); overflow: hidden; }
        .bi-fill { height: 100%; background: var(--crimson, #f58426); transition: width .4s ease; }
        .bi-stats { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; font-family: var(--mono, monospace); font-size: 12px; color: var(--muted); }
        .bi-ok { color: #3fb950; } .bi-fail { color: #f85149; }
        .bi-status { font-weight: 700; } .bi-status.done { color: #3fb950; } .bi-status.error { color: #f85149; }
        .bi-done { margin-top: 16px; display: flex; flex-direction: column; gap: 12px; }
        .bi-errs { font-size: 12px; color: var(--muted); } .bi-errs ul { margin: 8px 0 0 18px; }
      `}</style>
    </div>
  );
}
