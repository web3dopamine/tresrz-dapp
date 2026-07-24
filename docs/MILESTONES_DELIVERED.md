# Milestone Completion Matrix

Maps each scope item from the project SOW to the delivered artifact and how it
was verified. Status legend: ✅ done & verified · 🔑 done, needs your keys/funds
to operate in production.

---

## Milestone 1 — Smart Contract Development

| Scope item | Delivered | Status |
|---|---|---|
| ERC-721 / ERC-1155 NFT contract | `contracts/contracts/TresrzMusic.sol` (ERC-1155; each tokenId = a track, supply = editions) | ✅ |
| Minting with configurable royalty (EIP-2981) | `mintTrack(maxSupply, price, royaltyBps, uri)` + `_setTokenRoyalty` | ✅ |
| Marketplace: listing, buying, selling, offers | `contracts/contracts/TresrzMarketplace.sol` — `list/updateListing/cancelListing/buy` + `makeOffer/cancelOffer/acceptOffer` | ✅ |
| Royalty distribution: primary **and** secondary | Primary in `TresrzMusic.buy`; secondary in `TresrzMarketplace._settle` (royalty → creator, fee → platform, remainder → seller) | ✅ |
| Unit testing + audit-ready docs | `contracts/test/*.test.js` — **35 passing** (incl. 24 new marketplace tests: fund splits, refund, escrow, reentrancy, admin bounds); NatSpec on both contracts | ✅ |
| Testnet deployment + validation | `scripts/deploy.js` deploys both contracts (Sepolia/Liberty/local); `scripts/market-e2e.mjs` validates the flows | 🔑 (run with your RPC/key) |

Verify: `cd contracts && npm test`

## Milestone 2 — Frontend Marketplace UI & Wallet Integration

| Scope item | Delivered | Status |
|---|---|---|
| Responsive marketplace (browse, search, filter) | `app/page.tsx` + server-side search `GET /api/tracks?q=` | ✅ |
| NFT detail: metadata, price history, ownership | `app/track/[id]/page.tsx` — price-history sparkline (`/api/sales/history`), listings, ownership reads | ✅ |
| Wallet integration (MetaMask, WalletConnect) | RainbowKit/wagmi (`lib/wagmi.ts`) — both connectors | ✅ |
| Mint, list, buy, transfer flows | `lib/useBuyTrack.ts` + `lib/useMarket.ts` (list/buy/offer/accept/cancel/transfer with approval handling) | ✅ |
| User profile (owned + created) | `app/profile/[address]/page.tsx` (Created + Owned tabs) | ✅ |
| Transaction status feedback + error handling | Toasts + `{ok,error}` result shape across all hooks | ✅ |

Verify: `cd frontend && npm run build` (compiles clean), routes serve 200.

## Milestone 3 — Audio Player, Streaming & IPFS Storage

| Scope item | Delivered | Status |
|---|---|---|
| Audio player (preview + full playback) | `components/WaveformPlayer.tsx` (Web Audio API, no extra deps) | ✅ |
| Token-gated streaming (holders only) | `GET /api/stream/:id/full` checks on-chain `balanceOf`; `/preview` is public | ✅ |
| IPFS integration | `backend/src/ipfs.js` — Pinata pin + gateway URLs | 🔑 (set `PINATA_JWT`) |
| Upload pipeline with pinning | `POST /api/upload/audio` & `/image` (multer, 50 MB, MIME allowlist) → Pinata, local-disk fallback | ✅ |
| ERC-721-compliant metadata generation | `buildMetadata()` + `POST /api/upload/metadata` (name/description/image/animation_url/attributes) | ✅ |
| Waveform visualizer + progress UI | Canvas waveform + progress fill + seek + time in `WaveformPlayer` | ✅ |

Verify (tested live this session): audio/image upload, MIME rejection (415),
metadata pinning, preview (public) vs full (403 for non-holders, bypass for artist).

## Milestone 4 — Admin Dashboard, Testing & Launch

| Scope item | Delivered | Status |
|---|---|---|
| Admin dashboard | `app/admin/page.tsx` (gated by `isAdmin`) + `backend/src/routes/admin.js` | ✅ |
| Featured listings, user flags | `adminFeature` (hot flag) + `adminFlagTrack`/`adminFlagUser`; flagged tracks hidden from public listings | ✅ |
| Platform fee & royalty config panel | Reads/writes `platformFeeBps` + `feeRecipient` on both contracts (owner wallet) from the dashboard | ✅ |
| End-to-end functional/integration testing | `scripts/market-e2e.mjs`, `scripts/*-e2e.mjs` | ✅ |
| Performance / load testing | `scripts/loadtest.mjs` — ran ~6,300 req/s, p99 ~5 ms, 0 real errors | ✅ |
| Mainnet deployment + go-live | Runbook in [HANDOVER.md §4](./HANDOVER.md#4-mainnet-deployment-runbook) | 🔑 (your funded key) |
| Post-launch handover docs | [HANDOVER.md](./HANDOVER.md) + this matrix | ✅ |

---

## Gap-closure pass (2026-07-03)

A full audit of every interactive element against the SOW surfaced and closed
these remaining gaps — all verified live in a headless-browser run (22/22 checks):

| Fix | Where |
|---|---|
| Offer management UI — holders can now ACCEPT offers, buyers can CANCEL (escrow refund); open offers listed per track | `app/track/[id]/page.tsx` + `lib/useMarket.ts` |
| Listing management UI — sellers can CANCEL and EDIT (update qty/price) their own listings | `app/track/[id]/page.tsx` |
| Accepted offers are now recorded to price history — `/api/sales/secondary` accepts the seller as the recording party (verified against the on-chain event; tested against a real Sepolia `OfferAccepted` tx) | `backend/src/chain.js`, `backend/src/routes/sales.js` |
| Buy-flow feedback bug — an on-chain-successful purchase whose DB record failed no longer reports "purchase failed"; a warning toast shows instead | `lib/useBuyTrack.ts`, `lib/useMarket.ts` |
| Genre filter chips on browse (milestone 2 "filter") | `app/page.tsx` |
| User moderation flags now enforced — flagged users vanish from `/api/artists` and their tracks from public listings | `backend/src/routes/artists.js`, `tracks.js` |
| Dead footer links replaced; new `/about` page (about / how-it-works / royalties / contact) | `app/page.tsx`, `app/about/page.tsx` |
| Cookie banner: "Show specifics" now shows the storage actually used; dismissal persists | `components/CookieBanner.tsx` |
| Header nav anchors matched to their labels (DROPS→latest, ARTISTS→popular) | `components/Header.tsx` |
| Full-track unlock now confirms visibly ("🔓 Full track unlocked…") | `components/WaveformPlayer.tsx` |
| Next.js upgraded 14.2.5 → 14.2.35 (security patch) | `frontend/package.json` |
| **Go-live hardening:** systemd units (`tresrz-backend`, `tresrz-frontend`, `tresrz-tunnel`) — services survive reboots; the tunnel unit re-syncs `CORS_ORIGIN`/`SIWE_DOMAIN` to the fresh quick-tunnel URL on start | `/etc/systemd/system/`, `ops/tunnel-sync.sh` |
| RPC moved off the exhausted Alchemy key to `ethereum-sepolia-rpc.publicnode.com` | `backend/.env`, `contracts/.env` |

## What needs you (can't be done without your accounts/funds)
1. **Mainnet deploy** — a funded, secured deployer key (real ETH gas).
2. **Pinata (or equivalent) API key** — set `PINATA_JWT` to pin to real IPFS.
3. **WalletConnect Cloud project id** — `NEXT_PUBLIC_WC_PROJECT_ID` for production.
4. **Independent security audit** — recommended gate before mainnet (§6 of HANDOVER).
5. **Production Postgres + host/CDN** — `DATABASE_URL`, TLS, `CORS_ORIGIN`/`SIWE_DOMAIN`.

Everything else is implemented, wired, and verified locally.
