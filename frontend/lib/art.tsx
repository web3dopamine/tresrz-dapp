"use client";
import React from "react";

const palettes = [
  ["#ff1f4b", "#b1006b", "#2a1247"], ["#00e5ff", "#7b2ff7", "#0a0510"],
  ["#ffb800", "#ff1f4b", "#3d1d5e"], ["#39ff14", "#00aaaa", "#11052a"],
  ["#ff6ec7", "#7b2ff7", "#120a1f"], ["#ff8a00", "#e52e71", "#1a0a2e"],
  ["#00ffa3", "#03e1ff", "#0a0510"], ["#f72585", "#7209b7", "#3a0ca3"],
];
const rand = (s: number) => { const x = Math.sin(s * 9999) * 10000; return x - Math.floor(x); };

export function CoverArt({ seed, style, url, video, controls }: { seed: number; style?: number; url?: string | null; video?: string | null; controls?: boolean }) {
  const [videoFailed, setVideoFailed] = React.useState(false);
  const [imgFailed, setImgFailed] = React.useState(false);
  const vref = React.useRef<HTMLVideoElement>(null);
  // Video NFT (animation_url): full player with controls on the detail page,
  // hover-to-play elsewhere. Poster = the cover image, so grids stay fast
  // (preload="none" — the video only loads when interacted with).
  if (video && !videoFailed) {
    const hover = !controls;
    return (
      <video
        ref={vref}
        src={video}
        poster={url || undefined}
        controls={controls}
        preload="metadata"
        muted={hover}
        loop={hover}
        playsInline
        onError={() => setVideoFailed(true)}
        onMouseEnter={hover ? () => { vref.current?.play().catch(() => {}); } : undefined}
        onMouseLeave={hover ? () => { const v = vref.current; if (v) { v.pause(); v.currentTime = 0; } } : undefined}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  // Real cover image (from NFT metadata) when present; generative art otherwise
  // or if the image/video fails to load.
  if (url && !imgFailed) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setImgFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  const st = (style ?? seed) % 3;
  const p = palettes[Math.floor(rand(seed + 1) * palettes.length)];
  const shapes: React.ReactNode[] = [];
  if (st === 0) {
    for (let i = 8; i > 0; i--)
      shapes.push(<circle key={i} cx={50} cy={50} r={i * 6} fill="none" stroke={p[i % 2]} strokeWidth={rand(seed + i) * 2 + 0.5} opacity={0.4 + rand(seed + i) * 0.5} />);
    shapes.push(<circle key="h" cx={50} cy={50} r={7} fill={p[0]} />, <circle key="c" cx={50} cy={50} r={2.5} fill="#0a0510" />);
  } else if (st === 1) {
    for (let i = 0; i < 14; i++)
      shapes.push(<rect key={i} x={i * 7.4} y={rand(seed + i) * 30} width={6} height={40 + rand(seed + i + 5) * 60} fill={p[i % 3]} opacity={0.5 + rand(seed + i) * 0.5} transform="skewX(-12)" />);
  } else {
    for (let i = 0; i < 6; i++)
      shapes.push(<circle key={i} cx={20 + rand(seed + i) * 60} cy={20 + rand(seed + i + 9) * 60} r={8 + rand(seed + i + 3) * 22} fill={p[i % 3]} opacity={0.45 + rand(seed + i) * 0.4} />);
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <radialGradient id={`g${seed}`} cx="50%" cy="35%"><stop offset="0%" stopColor={p[0]} stopOpacity={0.35} /><stop offset="100%" stopColor={p[2]} /></radialGradient>
        <filter id={`b${seed}`}><feGaussianBlur stdDeviation="1.1" /></filter>
      </defs>
      <rect width={100} height={100} fill={`url(#g${seed})`} />
      <g filter={`url(#b${seed})`}>{shapes}</g>
    </svg>
  );
}

export function avatarUrl(seed: number) {
  const p = palettes[Math.floor(rand(seed * 3) * palettes.length)];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[1]}"/></linearGradient></defs><rect width="40" height="40" fill="url(#a)"/><circle cx="${10 + rand(seed) * 20}" cy="${10 + rand(seed + 1) * 20}" r="${5 + rand(seed + 2) * 8}" fill="${p[2]}" opacity=".6"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
