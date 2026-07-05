// Default to same-origin ("") so calls go to /api/* and are proxied to the backend by
// next.config.js — works on localhost AND through the Cloudflare tunnel. Only use an
// absolute URL when NEXT_PUBLIC_API_URL is explicitly set to a non-empty value.
// (Note: `|| "http://localhost:31338"` was wrong — an empty env value is falsy and
// would fall back to localhost, which is unreachable from a browser over the tunnel.)
const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();

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

// Multipart upload (no JSON Content-Type — the browser sets the multipart boundary).
async function upload(path: string, file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { ...authHeaders() }, body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || res.statusText);
  return res.json();
}

export type Track = {
  id: string; chainTokenId: number | null; title: string; genre: string; coverSeed: number;
  audioUrl?: string | null; coverUrl?: string | null; metadataUri?: string | null; mime?: string | null;
  hasFullAudio?: boolean;
  priceWei: string; maxSupply: number; minted: number; left: number; hot: boolean; flagged?: boolean;
  custodial?: boolean; mintStatus?: string;
  artist: { id: string; handle: string; address: string; avatarSeed: number };
  likes: number; liked: boolean;
  txHash?: string | null; createdAt?: string;
};
export type Artist = { id: string; handle: string; address: string; avatarSeed: number; nftCount: number; likes: number };
export type ArtistDetail = { id: string; handle: string; address: string; avatarSeed: number; bio: string | null; nftCount: number; totalLikes: number; tracks: Track[] };
export type SaleHistory = {
  kind: string; qty: number; priceWei: string; unitWei: string; txHash: string;
  buyer: string | null; seller: string | null; at: string;
};
export type UploadResult = { cid: string | null; uri: string | null; url: string | null; pinned: boolean; mime?: string };
export type AdminStats = {
  users: number; tracks: number; sales: number; flaggedTracks: number; flaggedUsers: number; featured: number;
  saleCount: number; contracts: { music: string | null; market: string | null; chainConfigured: boolean };
};
export type AdminTrack = Track & { _count?: { likes: number; sales: number }; flagged: boolean };
export type AdminUser = { id: string; address: string; handle: string | null; bio: string | null; flagged: boolean; createdAt: string; _count?: { tracks: number; sales: number } };

export type TrendingTrack = Track & { windowVolumeWei: string; windowSales: number; isNew?: boolean };
export type TrendWindow = "1h" | "1d" | "7d" | "all";

export const api = {
  tracks: (q = ""): Promise<Track[]> => req(`/api/tracks${q}`),
  trending: (window: TrendWindow = "1d"): Promise<TrendingTrack[]> => req(`/api/tracks/trending?window=${window}`),
  track: (id: string): Promise<Track> => req(`/api/tracks/${id}`),
  myTracks: (): Promise<Track[]> => req(`/api/tracks/mine`),
  artists: (): Promise<Artist[]> => req(`/api/artists`),
  artist: (key: string): Promise<ArtistDetail> => req(`/api/artists/${key}`),
  nonce: (address: string): Promise<{ nonce: string }> => req(`/api/auth/nonce?address=${address}`),
  verify: (message: string, signature: string) => req(`/api/auth/verify`, { method: "POST", body: JSON.stringify({ message, signature }) }),
  me: (): Promise<{ user: any; isAdmin: boolean }> => req(`/api/auth/me`),
  // email + Google accounts (no email verification)
  signupEmail: (b: { email: string; password: string; handle?: string }): Promise<{ token: string; user: any }> => req(`/api/auth/signup`, { method: "POST", body: JSON.stringify(b) }),
  loginEmail: (b: { email: string; password: string }): Promise<{ token: string; user: any }> => req(`/api/auth/login`, { method: "POST", body: JSON.stringify(b) }),
  loginGoogle: (credential: string): Promise<{ token: string; user: any }> => req(`/api/auth/google`, { method: "POST", body: JSON.stringify({ credential }) }),
  googleStatus: (): Promise<{ enabled: boolean; clientId: string | null }> => req(`/api/auth/google/status`),
  toggleLike: (trackId: string) => req(`/api/likes/${trackId}`, { method: "POST" }),
  recordSale: (b: { trackId: string; qty: number; priceWei: string; txHash: string }) => req(`/api/sales`, { method: "POST", body: JSON.stringify(b) }),
  recordSecondarySale: (b: { trackId: string; qty: number; txHash: string }) => req(`/api/sales/secondary`, { method: "POST", body: JSON.stringify(b) }),
  history: (trackId: string): Promise<SaleHistory[]> => req(`/api/sales/history/${trackId}`),
  createTrack: (b: Record<string, unknown>) => req(`/api/tracks`, { method: "POST", body: JSON.stringify(b) }),

  // M3: IPFS pipeline + token-gated streaming
  uploadAudio: (file: File) => upload(`/api/upload/audio`, file),
  uploadImage: (file: File) => upload(`/api/upload/image`, file),
  pinMetadata: (b: Record<string, unknown>): Promise<UploadResult & { metadata: any }> =>
    req(`/api/upload/metadata`, { method: "POST", body: JSON.stringify(b) }),
  streamPreview: (trackId: string): Promise<{ trackId: string; previewUrl: string | null }> => req(`/api/stream/${trackId}/preview`),
  streamFull: (trackId: string): Promise<{ trackId: string; fullUrl: string; mime: string | null; viaArtist: boolean }> =>
    req(`/api/stream/${trackId}/full`),

  // USD pricing + Stripe card checkout
  rate: (): Promise<{ usdPerEth: number; at: number }> => req(`/api/rate`),
  fiatStatus: (): Promise<{ enabled: boolean }> => req(`/api/fiat/status`),
  fiatCheckout: (b: { trackId: string; qty: number; deliveryAddress?: string }): Promise<{ url: string }> =>
    req(`/api/fiat/checkout`, { method: "POST", body: JSON.stringify(b) }),
  fiatOrder: (sessionId: string): Promise<{ status: "held" | "delivered" | "processing" | "refunded"; qty?: number; track?: { id: string; title: string; coverSeed: number }; deliveredTo?: string | null; deliverTx?: string | null }> =>
    req(`/api/fiat/order?session_id=${encodeURIComponent(sessionId)}`),
  fiatClaim: (b: { sessionId: string; address: string }): Promise<{ ok: boolean; deliverTx: string; deliveredTo: string }> =>
    req(`/api/fiat/claim`, { method: "POST", body: JSON.stringify(b) }),

  // custodial (wallet-less) minting + creator dashboard
  custodialStatus: (): Promise<{ enabled: boolean }> => req(`/api/mint/status`),
  custodialMint: (form: FormData): Promise<{ trackId: string; txHash?: string; status: string }> => {
    return fetch(`${BASE}/api/mint/custodial`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || r.statusText);
      return r.json();
    });
  },

  // M4: admin
  adminStats: (): Promise<AdminStats> => req(`/api/admin/stats`),
  adminTracks: (): Promise<AdminTrack[]> => req(`/api/admin/tracks`),
  adminUsers: (): Promise<AdminUser[]> => req(`/api/admin/users`),
  adminFeature: (id: string, featured: boolean) => req(`/api/admin/tracks/${id}/feature`, { method: "POST", body: JSON.stringify({ featured }) }),
  adminFlagTrack: (id: string, flagged: boolean) => req(`/api/admin/tracks/${id}/flag`, { method: "POST", body: JSON.stringify({ flagged }) }),
  adminFlagUser: (id: string, flagged: boolean) => req(`/api/admin/users/${id}/flag`, { method: "POST", body: JSON.stringify({ flagged }) }),
};
export { BASE };
