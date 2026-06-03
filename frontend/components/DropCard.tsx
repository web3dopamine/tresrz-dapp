"use client";
import { CoverArt, avatarUrl } from "@/lib/art";
import type { Track } from "@/lib/api";

export default function DropCard({ t, onClick }: { t: Track; onClick: () => void }) {
  return (
    <div className="drop" onClick={onClick}>
      <CoverArt seed={t.coverSeed} />
      <div className="tag"><img src={avatarUrl(t.artist.avatarSeed)} alt="" /><b>{t.artist.handle}</b></div>
      <div className="foot"><h4>{t.title}</h4><span>{t.genre}</span></div>
    </div>
  );
}
