"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Track } from "@/lib/api";
import { useUsdRate, usd } from "@/lib/usd";

/**
 * Creator self-edit modal for a single track. Shown only to the track's owner
 * (the caller enforces that). Price is entered in ETH — matching how prices are
 * set on the platform — with a live USD preview, and the buyer still pays ETH.
 * On save it PATCHes /api/tracks/:id and hands the fresh row back via onSaved.
 */
export default function EditTrackModal({
  track, open, onClose, onSaved, toast,
}: {
  track: Track;
  open: boolean;
  onClose: () => void;
  onSaved: (t: Track) => void;
  toast: (m: string) => void;
}) {
  const rate = useUsdRate();
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(track.title);
  const [genre, setGenre] = useState(track.genre);
  const [priceEth, setPriceEth] = useState(String(Number(BigInt(track.priceWei)) / 1e18));
  const [rarity, setRarity] = useState(track.rarity || "");
  const [coverUrl, setCoverUrl] = useState(track.coverUrl || "");
  const [externalUrl, setExternalUrl] = useState(track.externalUrl || "");

  useEffect(() => setMounted(true), []);
  // reset fields to the current track each time the modal opens
  useEffect(() => {
    if (!open) return;
    setTitle(track.title); setGenre(track.genre);
    setPriceEth(String(Number(BigInt(track.priceWei)) / 1e18));
    setRarity(track.rarity || ""); setCoverUrl(track.coverUrl || ""); setExternalUrl(track.externalUrl || "");
  }, [open, track]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const ethNum = Number(priceEth);
  const priceWeiPreview = Number.isFinite(ethNum) && ethNum >= 0 ? BigInt(Math.round(ethNum * 1e18)).toString() : null;
  const usdPreview = priceWeiPreview ? usd(priceWeiPreview, rate) : null;

  async function save() {
    if (!title.trim()) return toast("Title can't be empty");
    if (!Number.isFinite(ethNum) || ethNum < 0) return toast("Enter a valid price in ETH");
    setBusy(true);
    try {
      const updated = await api.updateTrack(track.id, {
        title: title.trim(),
        genre: genre.trim(),
        priceEth: ethNum,
        rarity: rarity.trim(),
        coverUrl: coverUrl.trim(),
        externalUrl: externalUrl.trim(),
      });
      toast(ethNum !== Number(BigInt(track.priceWei)) / 1e18 ? "Saved — price updated on-chain ✓" : "Saved ✓");
      onSaved(updated);
      onClose();
    } catch (e: any) {
      toast(e?.message || "Could not save changes");
    } finally { setBusy(false); }
  }

  return createPortal(
    <div className="em-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Edit track">
      <div className="em-panel" onClick={(e) => e.stopPropagation()}>
        <button className="em-close" onClick={onClose} aria-label="Close">✕</button>
        <h3 className="em-title">EDIT TRACK</h3>

        <label className="em-field">
          <span>TITLE</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} spellCheck={false} />
        </label>

        <div className="em-row">
          <label className="em-field">
            <span>GENRE</span>
            <input value={genre} onChange={(e) => setGenre(e.target.value)} maxLength={40} spellCheck={false} />
          </label>
          <label className="em-field">
            <span>RARITY</span>
            <input value={rarity} onChange={(e) => setRarity(e.target.value)} placeholder="e.g. RARE" maxLength={40} spellCheck={false} />
          </label>
        </div>

        <label className="em-field">
          <span>PRICE (ETH)</span>
          <input value={priceEth} onChange={(e) => setPriceEth(e.target.value)} inputMode="decimal" spellCheck={false} />
          <em className="em-hint">{usdPreview ? `≈ ${usdPreview} at the current rate · written on-chain` : "buyers pay this amount in ETH · written on-chain"}</em>
        </label>

        <label className="em-field">
          <span>COVER IMAGE URL</span>
          <input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
        </label>

        <label className="em-field">
          <span>EXTERNAL / MEDIA URL</span>
          <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
        </label>

        <div className="em-actions">
          <button className="em-cancel" onClick={onClose} disabled={busy}>CANCEL</button>
          <button className="buy em-save" onClick={save} disabled={busy}>{busy ? "SAVING…" : "SAVE CHANGES"}</button>
        </div>
      </div>

      <style jsx>{`
        .em-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,.62); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .em-panel { position: relative; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; background: var(--card-bg, #14161a); border: 1.5px solid var(--card-line, rgba(255,255,255,.12)); border-radius: 14px; padding: 26px 24px; }
        .em-close { position: absolute; top: 14px; right: 14px; border: 0; background: transparent; color: var(--muted); font-size: 15px; cursor: pointer; }
        .em-title { font-family: var(--display, sans-serif); letter-spacing: 1px; margin: 0 0 18px; color: var(--ink); }
        .em-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .em-field span { font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .1em; color: var(--muted); }
        .em-field input { background: var(--input-bg, rgba(255,255,255,.04)); border: 1.5px solid var(--card-line, rgba(255,255,255,.14)); border-radius: 8px; padding: 11px 12px; color: var(--ink); font-family: var(--mono, monospace); font-size: 14px; outline: 0; }
        .em-field input:focus { border-color: var(--crimson, #f58426); }
        .em-hint { font-family: var(--mono, monospace); font-size: 11px; color: var(--crimson-soft, #f58426); font-style: normal; }
        .em-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .em-actions { display: flex; gap: 10px; margin-top: 8px; }
        .em-cancel { flex: 0 0 auto; padding: 12px 20px; border-radius: 8px; border: 1.5px solid var(--card-line, rgba(255,255,255,.14)); background: transparent; color: var(--ink); font-family: var(--mono, monospace); font-weight: 700; cursor: pointer; }
        .em-save { flex: 1; }
      `}</style>
    </div>,
    document.body,
  );
}
