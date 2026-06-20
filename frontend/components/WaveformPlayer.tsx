"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Track, BASE } from "@/lib/api";

type Mode = "preview" | "full";

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Resolve a possibly-relative stream URL against the API base so <audio>/fetch work.
function resolveUrl(u: string): string {
  if (!u) return u;
  if (/^https?:\/\//i.test(u) || u.startsWith("data:") || u.startsWith("blob:")) return u;
  return `${BASE}${u}`;
}

export default function WaveformPlayer({ track }: { track: Track }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<number[] | null>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [loadingFull, setLoadingFull] = useState(false);
  const [gateMsg, setGateMsg] = useState("");
  const [decoded, setDecoded] = useState(false); // true when we have real peaks

  // 1) fetch the preview src on mount
  useEffect(() => {
    let alive = true;
    api
      .streamPreview(track.id)
      .then((d) => {
        if (!alive) return;
        const url = d.previewUrl || track.audioUrl || null;
        if (url) setSrc(resolveUrl(url));
      })
      .catch(() => {
        if (alive && track.audioUrl) setSrc(resolveUrl(track.audioUrl));
      });
    return () => {
      alive = false;
    };
  }, [track.id, track.audioUrl]);

  // 2) decode the audio to extract waveform peaks (best-effort; falls back on failure)
  useEffect(() => {
    if (!src) return;
    let alive = true;
    peaksRef.current = null;
    setDecoded(false);
    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error("fetch failed");
        const buf = await res.arrayBuffer();
        const AC: typeof AudioContext =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) throw new Error("no AudioContext");
        const ctx = new AC();
        const audioBuf = await ctx.decodeAudioData(buf.slice(0));
        ctx.close();
        if (!alive) return;
        const raw = audioBuf.getChannelData(0);
        const buckets = 140;
        const block = Math.floor(raw.length / buckets) || 1;
        const peaks: number[] = [];
        for (let i = 0; i < buckets; i++) {
          let max = 0;
          const start = i * block;
          for (let j = 0; j < block; j++) {
            const v = Math.abs(raw[start + j] || 0);
            if (v > max) max = v;
          }
          peaks.push(max);
        }
        const norm = Math.max(...peaks) || 1;
        peaksRef.current = peaks.map((p) => p / norm);
        setDecoded(true);
        drawWaveform(0);
      } catch {
        // decode failed (CORS, unsupported, etc.) -> animated-bars fallback used instead
        if (alive) {
          peaksRef.current = null;
          setDecoded(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const drawWaveform = useCallback(
    (progress: number) => {
      const canvas = canvasRef.current;
      const peaks = peaksRef.current;
      if (!canvas || !peaks) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || 64;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const n = peaks.length;
      const gap = 2;
      const bw = Math.max(1, w / n - gap);
      for (let i = 0; i < n; i++) {
        const ph = Math.max(2, peaks[i] * (h * 0.9));
        const x = i * (w / n);
        const y = (h - ph) / 2;
        const played = i / n <= progress;
        ctx.fillStyle = played ? "#ff1f4b" : "rgba(255,31,75,0.28)";
        ctx.fillRect(x, y, bw, ph);
      }
    },
    [],
  );

  // redraw on resize
  useEffect(() => {
    if (!decoded) return;
    const onResize = () => drawWaveform(dur > 0 ? cur / dur : 0);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [decoded, drawWaveform, cur, dur]);

  // audio element wiring
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setCur(el.currentTime);
      if (el.duration) drawWaveform(el.currentTime / el.duration);
    };
    const onMeta = () => setDur(el.duration || 0);
    const onEnd = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("play", () => setPlaying(true));
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
    };
  }, [drawWaveform, src]);

  function toggle() {
    const el = audioRef.current;
    if (!el || !src) return;
    if (el.paused) el.play().catch(() => setGateMsg("Could not play audio"));
    else el.pause();
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * dur;
  }

  async function unlockFull() {
    setGateMsg("");
    setLoadingFull(true);
    try {
      const d = await api.streamFull(track.id);
      const url = resolveUrl(d.fullUrl);
      setMode("full");
      setSrc(url);
      const el = audioRef.current;
      if (el) {
        el.load();
        el.play().catch(() => {});
      }
    } catch {
      setGateMsg("🔒 Hold an edition to unlock the full track");
    } finally {
      setLoadingFull(false);
    }
  }

  const progress = dur > 0 ? cur / dur : 0;

  return (
    <div className="wfp">
      <div className="wfp-top">
        <button className="wfp-btn" onClick={toggle} disabled={!src} aria-label="play/pause">
          {playing ? (
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          )}
        </button>

        <div className="wfp-canvas-wrap" onClick={seek}>
          {decoded ? (
            <canvas ref={canvasRef} className="wfp-canvas" />
          ) : (
            <div className={`wave wfp-fallback${playing ? " on" : ""}`}>
              {Array.from({ length: 40 }).map((_, i) => (
                <i key={i} style={{ animationDelay: `${i * 0.05}s` }} />
              ))}
            </div>
          )}
          {!decoded && src && (
            <div className="wfp-fallbar" style={{ width: `${progress * 100}%` }} />
          )}
        </div>

        <span className="wfp-badge" title={mode === "full" ? "Full track" : "Preview"}>
          {mode === "full" ? "🔓" : "🔒"}
        </span>
      </div>

      <div className="wfp-bottom">
        <span className="wfp-time">{fmt(cur)} / {fmt(dur)}</span>
        <button className="wfp-full" onClick={unlockFull} disabled={loadingFull || mode === "full"}>
          {mode === "full" ? "FULL TRACK ✓" : loadingFull ? "UNLOCKING…" : "PLAY FULL TRACK"}
        </button>
      </div>

      {gateMsg && <div className="wfp-gate">{gateMsg}</div>}

      {src && <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />}

      <style jsx>{`
        .wfp {
          background: linear-gradient(180deg, #170c26, #0f0719);
          border: 1px solid var(--card-line, rgba(255, 31, 75, 0.25));
          border-radius: 12px;
          padding: 14px 16px;
          margin: 14px 0;
        }
        .wfp-top {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .wfp-btn {
          flex: 0 0 auto;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: 1.5px solid var(--crimson, #ff1f4b);
          background: rgba(255, 31, 75, 0.12);
          color: var(--crimson, #ff1f4b);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: 0.2s;
        }
        .wfp-btn:hover:not(:disabled) {
          background: var(--crimson, #ff1f4b);
          color: #fff;
        }
        .wfp-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .wfp-canvas-wrap {
          position: relative;
          flex: 1;
          height: 64px;
          cursor: pointer;
          overflow: hidden;
          border-radius: 6px;
        }
        .wfp-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }
        .wfp-fallback {
          position: static;
          opacity: 1;
          height: 64px;
          padding: 0;
        }
        .wfp-fallback i {
          opacity: 0.35;
          animation-play-state: paused;
        }
        .wfp-fallback.on i {
          opacity: 1;
          animation-play-state: running;
        }
        .wfp-fallbar {
          position: absolute;
          left: 0;
          bottom: 0;
          height: 3px;
          background: var(--crimson, #ff1f4b);
          box-shadow: var(--glow);
          transition: width 0.1s linear;
        }
        .wfp-badge {
          font-size: 18px;
          flex: 0 0 auto;
        }
        .wfp-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 10px;
          gap: 12px;
        }
        .wfp-time {
          font-family: var(--mono, monospace);
          font-size: 12px;
          color: var(--muted, #9a8fb0);
        }
        .wfp-full {
          font-family: var(--mono, monospace);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: var(--ink, #fff);
          background: transparent;
          border: 1.5px solid rgba(255, 31, 75, 0.45);
          border-radius: 3px;
          padding: 7px 12px;
          cursor: pointer;
          transition: 0.2s;
        }
        .wfp-full:hover:not(:disabled) {
          border-color: var(--crimson, #ff1f4b);
          box-shadow: var(--glow);
        }
        .wfp-full:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .wfp-gate {
          margin-top: 10px;
          font-size: 12px;
          color: var(--crimson-soft, #ff6b8a);
          font-family: var(--mono, monospace);
        }
      `}</style>
    </div>
  );
}
