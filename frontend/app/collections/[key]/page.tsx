"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import TrackCard from "@/components/TrackCard";
import { avatarUrl } from "@/lib/art";
import { api, type CollectionDetail, type Track } from "@/lib/api";
import { usd, useUsdRate } from "@/lib/usd";
import { useAuth } from "@/lib/auth";

const PAGE = 24;

export default function CollectionPage() {
  const { key } = useParams<{ key: string }>();
  const { me } = useAuth();
  const [col, setCol] = useState<CollectionDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [eName, setEName] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eCover, setECover] = useState("");
  const [saving, setSaving] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [tierPrices, setTierPrices] = useState<Record<string, string>>({});
  const [pricing, setPricing] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [active, setActive] = useState<string | null>(null);
  const [search, setSearch] = useState("");        // raw input
  const [query, setQuery] = useState("");          // debounced, sent to the API
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState("");
  const rate = useUsdRate();
  const tRef = useRef<any>(null);
  function toast(m: string) { setMsg(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(""), 2200); }

  const isOwner = !!me && !!col && col.owner.id === me.id;
  function openEdit() {
    if (!col) return;
    setEName(col.name); setEDesc(col.description || ""); setECover(col.coverUrl || "");
    setEditOpen(true);
  }
  function openPricing() {
    if (!col) return;
    const seed: Record<string, string> = {};
    col.rarities.forEach((r) => { seed[r.rarity] = ""; });
    setTierPrices(seed);
    setPriceOpen(true);
  }
  async function savePricing() {
    if (!col) return;
    const byRarity: Record<string, string> = {};
    Object.entries(tierPrices).forEach(([k, v]) => { if (String(v).trim() !== "") byRarity[k] = String(v).trim(); });
    if (!Object.keys(byRarity).length) return toast("Enter at least one price");
    setPricing(true);
    try {
      const r = await api.repriceTracks({ collectionId: col.id, byRarity });
      toast(`Re-priced ${r.updated} item${r.updated === 1 ? "" : "s"} on-chain ✓`);
      setPriceOpen(false);
      load(col.id, active, query);
    } catch (e: any) {
      toast(e?.message || "Could not update prices");
    } finally { setPricing(false); }
  }

  async function saveEdit() {
    if (!col) return;
    if (!eName.trim()) return toast("Name can't be empty");
    setSaving(true);
    try {
      const u = await api.updateCollection(col.id, { name: eName.trim(), description: eDesc.trim(), coverUrl: eCover.trim() });
      setCol({ ...col, name: u.name, description: u.description, coverUrl: u.coverUrl });
      toast("Saved ✓");
      setEditOpen(false);
    } catch (e: any) {
      toast(e?.message || "Could not save changes");
    } finally { setSaving(false); }
  }

  useEffect(() => {
    api.collection(key).then((c) => { setCol(c); setState("ready"); }).catch(() => setState("missing"));
  }, [key]);

  // debounce the search box so we don't fire a request on every keystroke
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async (colId: string, rarity: string | null, q: string) => {
    setLoadingMore(true); setDone(false);
    const qs = `?collection=${colId}&limit=${PAGE}${rarity ? `&rarity=${encodeURIComponent(rarity)}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    const rows = await api.tracks(qs).catch(() => []);
    setTracks(rows); setDone(rows.length < PAGE); setLoadingMore(false);
  }, []);

  useEffect(() => { if (col) load(col.id, active, query); }, [col, active, query, load]);

  async function loadMore() {
    if (!col || loadingMore || done) return;
    setLoadingMore(true);
    const qs = `?collection=${col.id}&limit=${PAGE}&skip=${tracks.length}${active ? `&rarity=${encodeURIComponent(active)}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
    const rows = await api.tracks(qs).catch(() => []);
    setTracks((p) => [...p, ...rows]); setDone(rows.length < PAGE); setLoadingMore(false);
  }

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        {state === "loading" && <div className="muted-note">Loading collection…</div>}
        {state === "missing" && <div className="muted-note">Collection not found. <Link href="/#collections" style={{ color: "var(--crimson-soft)" }}>← All collections</Link></div>}
        {state === "ready" && col && (
          <>
            <div className="artist-header">
              <img src={avatarUrl(col.owner.avatarSeed)} alt="" />
              <div className="artist-meta">
                <div className="coll-eyebrow">COLLECTION{isOwner && <><button className="coll-edit" onClick={openEdit}>✎ EDIT</button><button className="coll-edit" onClick={openPricing}>＄ SET PRICES</button><Link className="coll-edit" href={`/collections/${col.slug}/import`}>⬆ BULK UPLOAD</Link></>}</div>
                <h1>{col.name}</h1>
                <div className="coll-by">by <Link href={`/artist/${col.owner.address}`}><b>{col.owner.handle}</b></Link></div>
                <div className="artist-counts">
                  <span><b>{col.itemCount.toLocaleString()}</b> items</span>
                  {col.floorWei && rate && usd(col.floorWei, rate) && <span>floor <b>{usd(col.floorWei, rate)}</b></span>}
                </div>
                {col.description && <p className="artist-bio">{col.description}</p>}
              </div>
            </div>

            <div className="sec-title" style={{ marginTop: 30 }}>ITEMS</div>
            <div className="sec-bar" />

            <div className="coll-search">
              <span className="cs-icon">🔍</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${col.name} by name…`}
                spellCheck={false}
              />
              {search && <button className="cs-clear" onClick={() => setSearch("")} aria-label="Clear search">✕</button>}
            </div>

            {col.rarities.length > 0 && (
              <div className="rarity-filter">
                <button className={`rf-chip${active === null ? " on" : ""}`} onClick={() => setActive(null)}>
                  ALL <span>{col.itemCount.toLocaleString()}</span>
                </button>
                {col.rarities.map((r) => (
                  <button key={r.rarity} className={`rf-chip${active === r.rarity ? " on" : ""}`} onClick={() => setActive(r.rarity)}>
                    {r.rarity} <span>{r.count.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}

            {tracks.length === 0 && !loadingMore ? (
              <div className="muted-note">No items{query ? ` matching “${query}”` : ""}{active ? ` in ${active}` : ""}.</div>
            ) : (
              <>
                <div className="artist-grid">{tracks.map((t) => <TrackCard key={t.id} t={t} toast={toast} />)}</div>
                <div className="rf-more">
                  {loadingMore ? <span className="muted-note">Loading…</span>
                    : !done ? <button className="buy rf-loadmore" onClick={loadMore}>LOAD MORE</button>
                    : tracks.length > 0 ? <span className="muted-note">— end of {active || "collection"} —</span> : null}
                </div>
              </>
            )}
          </>
        )}
      </section>
      {priceOpen && col && (
        <div className="ce-overlay" onClick={() => setPriceOpen(false)} role="dialog" aria-modal="true">
          <div className="ce-panel" onClick={(e) => e.stopPropagation()}>
            <button className="ce-close" onClick={() => setPriceOpen(false)} aria-label="Close">✕</button>
            <h3 className="ce-title">SET PRICES BY RARITY</h3>
            <p className="ce-hint">Prices are in ETH and are written <b>on-chain</b>, so buyers are charged exactly this. Leave a tier blank to leave it unchanged. USD shown on the site follows the live rate.</p>
            {col.rarities.map((r) => (
              <label key={r.rarity} className="ce-field ce-tier">
                <span>{r.rarity} <i>({r.count.toLocaleString()} items)</i></span>
                <input
                  value={tierPrices[r.rarity] ?? ""}
                  onChange={(e) => setTierPrices((p) => ({ ...p, [r.rarity]: e.target.value }))}
                  placeholder="unchanged" inputMode="decimal" spellCheck={false}
                />
              </label>
            ))}
            <div className="ce-actions">
              <button className="ce-cancel" onClick={() => setPriceOpen(false)} disabled={pricing}>CANCEL</button>
              <button className="buy ce-save" onClick={savePricing} disabled={pricing}>{pricing ? "WRITING ON-CHAIN…" : "APPLY PRICES"}</button>
            </div>
          </div>
        </div>
      )}
      {editOpen && col && (
        <div className="ce-overlay" onClick={() => setEditOpen(false)} role="dialog" aria-modal="true">
          <div className="ce-panel" onClick={(e) => e.stopPropagation()}>
            <button className="ce-close" onClick={() => setEditOpen(false)} aria-label="Close">✕</button>
            <h3 className="ce-title">EDIT COLLECTION</h3>
            <label className="ce-field"><span>NAME</span>
              <input value={eName} onChange={(e) => setEName(e.target.value)} maxLength={80} spellCheck={false} />
            </label>
            <label className="ce-field"><span>DESCRIPTION</span>
              <textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} rows={3} />
            </label>
            <label className="ce-field"><span>COVER IMAGE URL</span>
              <input value={eCover} onChange={(e) => setECover(e.target.value)} placeholder="https://…" spellCheck={false} />
            </label>
            <div className="ce-actions">
              <button className="ce-cancel" onClick={() => setEditOpen(false)} disabled={saving}>CANCEL</button>
              <button className="buy ce-save" onClick={saveEdit} disabled={saving}>{saving ? "SAVING…" : "SAVE CHANGES"}</button>
            </div>
          </div>
        </div>
      )}
      <div className={`toast${msg ? " show" : ""}`}>{msg}</div>

      <style jsx>{`
        .coll-edit { margin-left: 10px; display: inline-block; font-family: var(--mono, monospace); font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--ink); background: transparent; border: 1px solid var(--crimson, #f58426); border-radius: 12px; padding: 2px 9px; cursor: pointer; vertical-align: middle; text-decoration: none; }
        .coll-edit:hover { background: var(--crimson, #f58426); color: #fff; }
        .ce-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,.62); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .ce-panel { position: relative; width: 100%; max-width: 460px; background: var(--card-bg, #14161a); border: 1.5px solid var(--card-line, rgba(255,255,255,.12)); border-radius: 14px; padding: 26px 24px; }
        .ce-close { position: absolute; top: 14px; right: 14px; border: 0; background: transparent; color: var(--muted); font-size: 15px; cursor: pointer; }
        .ce-title { font-family: var(--display, sans-serif); letter-spacing: 1px; margin: 0 0 18px; color: var(--ink); }
        .ce-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .ce-field span { font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .1em; color: var(--muted); }
        .ce-field input, .ce-field textarea { background: var(--input-bg, rgba(255,255,255,.04)); border: 1.5px solid var(--card-line, rgba(255,255,255,.14)); border-radius: 8px; padding: 11px 12px; color: var(--ink); font-family: var(--mono, monospace); font-size: 14px; outline: 0; resize: vertical; }
        .ce-field input:focus, .ce-field textarea:focus { border-color: var(--crimson, #f58426); }
        .ce-hint { font-size: 12.5px; color: var(--muted); line-height: 1.5; margin: -6px 0 16px; }
        .ce-tier span i { font-style: normal; opacity: .6; }
        .ce-actions { display: flex; gap: 10px; margin-top: 8px; }
        .ce-cancel { flex: 0 0 auto; padding: 12px 20px; border-radius: 8px; border: 1.5px solid var(--card-line, rgba(255,255,255,.14)); background: transparent; color: var(--ink); font-family: var(--mono, monospace); font-weight: 700; cursor: pointer; }
        .ce-save { flex: 1; }
        .coll-search { display: flex; align-items: center; gap: 8px; max-width: 420px; margin: 14px 0 16px; padding: 0 12px; border: 1.5px solid var(--card-line, rgba(0,0,0,.15)); border-radius: 9px; background: var(--card-bg, transparent); transition: border-color .15s; }
        .coll-search:focus-within { border-color: var(--crimson, #f58426); }
        .cs-icon { opacity: .55; font-size: 13px; }
        .coll-search input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink); font-family: var(--mono, monospace); font-size: 13px; padding: 11px 0; }
        .coll-search input::placeholder { color: var(--muted); opacity: .8; }
        .cs-clear { border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 13px; padding: 4px; line-height: 1; }
        .cs-clear:hover { color: var(--crimson, #f58426); }
        .rarity-filter { display: flex; flex-wrap: wrap; gap: 9px; margin: 4px 0 20px; }
        .rf-chip { background: transparent; border: 1.5px solid var(--card-line, rgba(0,0,0,.15)); color: var(--ink); font-family: var(--mono, monospace); font-size: 12px; font-weight: 700; letter-spacing: .04em; padding: 8px 13px; border-radius: 7px; cursor: pointer; transition: .15s; display: inline-flex; align-items: center; gap: 7px; }
        .rf-chip span { font-weight: 400; opacity: .6; font-size: 11px; }
        .rf-chip:hover { border-color: var(--crimson, #f58426); }
        .rf-chip.on { background: var(--crimson, #f58426); border-color: var(--crimson, #f58426); color: #fff; }
        .rf-chip.on span { opacity: .85; color: #fff; }
        .rf-more { display: flex; justify-content: center; margin: 26px 0 4px; }
        .rf-loadmore { width: auto; padding: 11px 30px; }
        .coll-eyebrow { font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .18em; color: var(--crimson, #f58426); font-weight: 700; margin-bottom: 4px; }
        .coll-by { font-size: 13px; color: var(--muted); margin: 2px 0 4px; }
        .coll-by b { color: var(--ink); }
      `}</style>
    </div>
  );
}
