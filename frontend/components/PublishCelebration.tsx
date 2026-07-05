"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

const COLORS = ["#f58426", "#1f3a8a", "#ff5252", "#ffd166", "#06d6a0", "#118ab2", "#e879f9"];

// Celebratory popup shown after a successful publish — a burst of CSS confetti
// (no external libs; CSP-safe) plus a button to the new track's page.
export default function PublishCelebration({
  trackId, firstTime, onClose,
}: { trackId: string; firstTime: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // Compute confetti pieces once (stable across re-renders).
  const pieces = useMemo(
    () => Array.from({ length: 130 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.7,
      dur: 2.6 + Math.random() * 2.2,
      col: COLORS[i % COLORS.length],
      w: 6 + Math.random() * 8,
      round: Math.random() > 0.6,
    })),
    [],
  );

  if (!mounted) return null;

  return createPortal(
    <div className="pc-overlay" role="dialog" aria-modal="true" aria-label="Publish successful" onClick={onClose}>
      <div className="pc-confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <span key={i} style={{
            left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
            background: p.col, width: p.w, height: p.w * 1.5, borderRadius: p.round ? "50%" : "1px",
          }} />
        ))}
      </div>
      <div className="pc-card" onClick={(e) => e.stopPropagation()}>
        <button className="pc-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="pc-emoji">🎉</div>
        <h2>{firstTime ? "Your first track is live!" : "Congratulations!"}</h2>
        <p>
          {firstTime
            ? "You just published your first track on TRESRZ. It's live on the marketplace — go take a look."
            : "Your track is published and live on the marketplace."}
        </p>
        <div className="pc-actions">
          <Link href={`/track/${trackId}`} className="buy pc-view">VIEW YOUR TRACK →</Link>
          <button className="pc-secondary" onClick={onClose}>Publish another</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
