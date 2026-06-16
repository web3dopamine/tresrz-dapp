const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:31338";

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("tresrz_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function req(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || res.statusText);
  return res.json();
}

export type Track = {
  id: string; chainTokenId: number | null; title: string; genre: string; coverSeed: number;
  audioUrl?: string | null;
  priceWei: string; maxSupply: number; minted: number; left: number; hot: boolean;
  artist: { id: string; handle: string; address: string; avatarSeed: number };
  likes: number; liked: boolean;
};
export type Artist = { id: string; handle: string; address: string; avatarSeed: number; nftCount: number; likes: number };
export type ArtistDetail = { id: string; handle: string; address: string; avatarSeed: number; bio: string | null; nftCount: number; totalLikes: number; tracks: Track[] };

export const api = {
  tracks: (q = ""): Promise<Track[]> => req(`/api/tracks${q}`),
  track: (id: string): Promise<Track> => req(`/api/tracks/${id}`),
  artists: (): Promise<Artist[]> => req(`/api/artists`),
  artist: (key: string): Promise<ArtistDetail> => req(`/api/artists/${key}`),
  nonce: (address: string): Promise<{ nonce: string }> => req(`/api/auth/nonce?address=${address}`),
  verify: (message: string, signature: string) => req(`/api/auth/verify`, { method: "POST", body: JSON.stringify({ message, signature }) }),
  me: () => req(`/api/auth/me`),
  toggleLike: (trackId: string) => req(`/api/likes/${trackId}`, { method: "POST" }),
  recordSale: (b: { trackId: string; qty: number; priceWei: string; txHash: string }) => req(`/api/sales`, { method: "POST", body: JSON.stringify(b) }),
  createTrack: (b: Record<string, unknown>) => req(`/api/tracks`, { method: "POST", body: JSON.stringify(b) }),
};
export { BASE };
