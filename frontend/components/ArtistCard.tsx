"use client";
import { useState } from "react";
import { avatarUrl } from "@/lib/art";
import type { Artist } from "@/lib/api";

export default function ArtistCard({ a }: { a: Artist }) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(a.likes);
  return (
    <div className="creator">
      <img src={avatarUrl(a.avatarSeed)} alt="" />
      <div className="meta"><b>{a.handle}</b><span>NFTs: {a.nftCount}</span></div>
      <button className={`heart${liked ? " liked" : ""}`} onClick={(e) => { e.stopPropagation(); setLiked(!liked); setLikes((v) => v + (liked ? -1 : 1)); }}>
        <svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-8.5C1 9 3 5.5 6.5 5.5c2 0 3.5 1.3 5.5 3 2-1.7 3.5-3 5.5-3C21 5.5 23 9 21.5 12.5 19 16.5 12 21 12 21z" /></svg>
        <small>{likes}</small>
      </button>
    </div>
  );
}
