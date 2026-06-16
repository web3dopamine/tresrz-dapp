"use client";
import Link from "next/link";
import { avatarUrl } from "@/lib/art";
import type { Artist } from "@/lib/api";

// Artists are not a likeable entity in the API (likes belong to tracks), so the old
// local-only heart was fake. We show the artist's real aggregate track likes instead.
export default function ArtistCard({ a }: { a: Artist }) {
  return (
    <Link href={`/artist/${a.address}`} className="creator" style={{ textDecoration: "none" }}>
      <img src={avatarUrl(a.avatarSeed)} alt="" />
      <div className="meta"><b>{a.handle}</b><span>NFTs: {a.nftCount}</span></div>
      <div className="heart" aria-hidden style={{ pointerEvents: "none" }}>
        <svg viewBox="0 0 24 24" style={{ fill: "var(--crimson)" }}><path d="M12 21s-7-4.5-9.5-8.5C1 9 3 5.5 6.5 5.5c2 0 3.5 1.3 5.5 3 2-1.7 3.5-3 5.5-3C21 5.5 23 9 21.5 12.5 19 16.5 12 21 12 21z" /></svg>
        <small>{a.likes}</small>
      </div>
    </Link>
  );
}
