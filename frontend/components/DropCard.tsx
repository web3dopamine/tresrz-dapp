"use client";
import Link from "next/link";
import { CoverArt, avatarUrl } from "@/lib/art";
import type { Track } from "@/lib/api";

export default function DropCard({ t }: { t: Track }) {
  return (
    <Link href={`/track/${t.id}`} className="drop" style={{ display: "block", textDecoration: "none" }}>
      <CoverArt seed={t.coverSeed} url={t.coverUrl} video={t.mime?.startsWith("video") ? t.audioUrl : undefined} />
      <div className="tag"><img src={avatarUrl(t.artist.avatarSeed)} alt="" /><b>{t.artist.handle}</b></div>
      <div className="foot"><h4>{t.title}</h4><span>{t.genre}</span></div>
    </Link>
  );
}
