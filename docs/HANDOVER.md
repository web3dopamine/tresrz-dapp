# TRESRZ — Handover & Launch Runbook

Audio NFT marketplace on an EVM chain: ERC-1155 music editions with EIP-2981
royalties, a secondary marketplace (listings + offers), IPFS storage, token-gated
streaming, and an admin dashboard.

This document is the operator's guide: architecture, environment, how to run,
how to deploy to mainnet, how to test, and the security model.

---

## 1. Architecture

```
contracts/   Hardhat — TresrzMusic (ERC-1155 + ERC-2981) + TresrzMarketplace (secondary)
backend/     Express + Prisma + PostgreSQL — API, SIWE auth, IPFS pinning, token-gated streaming, admin
frontend/    Next.js 14 (App Router, TS) — wagmi/RainbowKit wallet, marketplace UI, waveform player, admin
```

| Concern | Where |
|---|---|
| Primary mint + sale | `TresrzMusic.mintTrack` / `.buy` |
| Royalties (EIP-2981) | `TresrzMusic` sets per-token royalty; honoured on primary and secondary |
| Secondary listings | `TresrzMarketplace.list/updateListing/cancelListing/buy` |
| Offers (escrowed) | `TresrzMarketplace.makeOffer/cancelOffer/acceptOffer` |
| IPFS pinning | `backend/src/ipfs.js` (Pinata; local-disk fallback) |
| Token-gated streaming | `backend/src/routes/stream.js` (`balanceOf` check) |
| Admin / moderation | `backend/src/routes/admin.js`, `frontend/app/admin/page.tsx` |
| Price history | `Sale` rows (primary + secondary), `GET /api/sales/history/:id` |

---

## 2. Environment variables

### contracts/.env
```
PRIVATE_KEY=         # deployer key (mainnet: a funded, secured key / hardware wallet)
FEE_RECIPIENT=       # platform fee wallet (defaults to deployer)
LIBERTY_RPC=         # or the target chain RPC
SEPOLIA_RPC=         # testnet RPC for staging
```

### backend/.env  (see `.env.example` for the full annotated list)
```
DATABASE_URL=postgresql://user:pass@host:5432/tresrz?schema=public
PORT=31338
JWT_SECRET=                 # REQUIRED, >=32 random chars — the API refuses to boot otherwise
CORS_ORIGIN=               # comma-separated allowed frontend origins
SIWE_DOMAIN=               # host the browser presents (e.g. tresrz.app)
RPC_URL=                   # chain RPC for sale verification + streaming gate
CHAIN_ID=
MUSIC_CONTRACT=            # deployed TresrzMusic address
MARKET_CONTRACT=           # deployed TresrzMarketplace address
PINATA_JWT=                # IPFS pinning; empty => local-disk fallback (./uploads)
PINATA_GATEWAY=https://gateway.pinata.cloud
PUBLIC_BASE_URL=           # public URL of THIS API (for local-fallback upload URLs)
ADMIN_ADDRESSES=           # comma-separated admin wallets (gates /api/admin/*)
```

### frontend/.env.local
```
NEXT_PUBLIC_MUSIC_CONTRACT=
NEXT_PUBLIC_MARKET_CONTRACT=
NEXT_PUBLIC_DEFAULT_CHAIN=     # chainId the wallet selects by default
NEXT_PUBLIC_WC_PROJECT_ID=     # WalletConnect Cloud project id (real id for prod)
NEXT_PUBLIC_API_URL=           # leave empty to use the same-origin /api proxy
```

---

## 3. Local run (full stack)

```bash
# 1) chain
cd contracts && npm i && npx hardhat node &           # chainId 31337
npm run deploy:local                                  # prints MUSIC + MARKET addresses

# 2) backend  (put the two addresses in backend/.env)
cd ../backend && npm i && npx prisma db push && npm run seed && npm run dev   # :31338

# 3) frontend (put NEXT_PUBLIC_*_CONTRACT in frontend/.env.local)
cd ../frontend && npm i && npm run dev                # :31337
```

Without `PINATA_JWT`, uploads are written to `backend/uploads/` and served at
`/uploads/*` so the pipeline works end-to-end in dev. Set `PINATA_JWT` to pin to
real IPFS.

---

## 4. Mainnet deployment runbook

> Mainnet deployment spends real ETH and is irreversible. Do it from a secured key.

1. **Audit gate.** Commission an independent audit of `TresrzMusic.sol` and
   `TresrzMarketplace.sol`. Do not deploy to mainnet before sign-off. (See §6.)
2. **Stage on a testnet first.** Deploy to Sepolia, run `scripts/market-e2e.mjs`
   and the full app flow against it.
3. **Configure** `contracts/.env` with `MAINNET_RPC`, the mainnet `PRIVATE_KEY`
   (secured/hot key) and `FEE_RECIPIENT`. The `mainnet` network (chainId 1) is
   already defined in `hardhat.config.js`.
4. **Deploy:**
   ```bash
   cd contracts
   npx hardhat run scripts/deploy.js --network mainnet
   ```
   Record the printed `TresrzMusic` and `TresrzMarketplace` addresses.
5. **Verify source** on the block explorer (Etherscan/Blockscout):
   `npx hardhat verify --network <mainnet> <addr> <constructor-args>`.
6. **Wire the app:** put the addresses + mainnet `RPC_URL`/`CHAIN_ID` in
   `backend/.env` and `NEXT_PUBLIC_*` in `frontend/.env.local`; set
   `ADMIN_ADDRESSES` to the platform owner/multisig.
7. **Migrate DB:** `npx prisma migrate deploy` against the production Postgres.
8. **Build & serve:** `backend: npm start`; `frontend: npm run build && npm start`
   behind a reverse proxy/CDN with TLS. Set `CORS_ORIGIN`/`SIWE_DOMAIN` to the prod host.
9. **Smoke test:** mint → buy → list → buy-secondary → make/accept offer →
   stream-gate, all from the live UI.
10. **Transfer ownership** of both contracts to the platform multisig if the
    deployer key was a hot key.

---

## 4b. Sepolia staging (live)

Deployed and verified on Sepolia (chainId 11155111) on 2026-06-20:

| Contract | Address |
|---|---|
| `TresrzMusic` | `0x1E109bcA6c2088abCE2D604483137949f8B4BBFA` |
| `TresrzMarketplace` | `0x2F8b555352618E8c04A740C5002489AD05F48FD1` |

Deployer/treasury: `0xe5EC7c3E4F2fFd95dC62b97465c932a457AB539F` (burner — testnet ETH
only). RPC: Alchemy Sepolia (in `contracts/.env`, gitignored).

Verified end-to-end with `backend/scripts/market-e2e-sepolia.mjs` (a testnet-scaled
mirror of `market-e2e.mjs`: mint → primary buy → list → secondary buy → offer →
accept, with a freshly-generated funded buyer and a sweep-back). On-chain splits
confirmed correct: 5% royalty + 2.5% platform fee on the secondary sale. Run:
```bash
RPC_URL=<sepolia-rpc> MUSIC_CONTRACT=0x1E10..BBFA MARKET_CONTRACT=0x2F8b..8FD1 \
  DEPLOYER_PK=0x<funded-key> CHAIN_ID=11155111 \
  node backend/scripts/market-e2e-sepolia.mjs
```

> The live dev stack (`:31337`/`:31338`) is NOT yet repointed to Sepolia — it still
> targets the local chain. To make Sepolia the running staging env, set the two
> contract addresses + Sepolia RPC + `CHAIN_ID=11155111` in `backend/.env` and the
> `NEXT_PUBLIC_*` equivalents (incl. `NEXT_PUBLIC_DEFAULT_CHAIN=11155111`) in
> `frontend/.env.local`, then restart both.

---

## 5. Testing

| Suite | Command | Covers |
|---|---|---|
| Contract units | `cd contracts && npm test` | mint/royalty bounds, primary fee split, refund, reentrancy, **secondary listings + offers, royalty+fee distribution, admin bounds** (35 tests) |
| Marketplace E2E | `node backend/scripts/market-e2e.mjs` | mint→primary-buy→list→secondary-buy + offer→accept against a local chain |
| Marketplace E2E (Sepolia) | `… node backend/scripts/market-e2e-sepolia.mjs` | same flow, testnet-scaled, funded buyer + sweep-back (see §4b) |
| Primary E2E | `node backend/scripts/{mint,buy,sales-verify}-e2e.mjs` | mint/buy/sale-reconciliation |
| Load / perf | `CONNS=50 DURATION=10 node backend/scripts/loadtest.mjs` | API throughput + p50/p95/p99 latency; distinguishes 429 rate-limit from real errors |

Latest local load result (read endpoints): ~6,300 req/s, p99 ~5 ms, 0 real
errors; requests over 600/15 min correctly return HTTP 429.

---

## 6. Security model

- **JWT_SECRET required at boot** — API exits if missing/placeholder/<32 chars.
- **SIWE** sign-in; nonces persisted in Postgres (10-min TTL, single-use) so
  pending logins survive restarts.
- **Sales are verified on-chain.** `POST /api/sales` and `/api/sales/secondary`
  re-read the tx receipt and only record if the contract event matches the
  tokenId, authenticated buyer and qty — forged/replayed hashes are rejected.
- **Reentrancy:** both contracts use OpenZeppelin `ReentrancyGuard` on all
  value-moving paths (`buy`, `acceptOffer`, `cancelOffer`); effects precede
  interactions; refunds/payouts are checked. Covered by tests.
- **Marketplace is escrow-free for tokens** (pulls on sale via approval) and only
  escrows ETH for open offers, refundable by the offerer at any time.
- **Royalty is resolved defensively** via `try/catch` on `royaltyInfo` and bounded
  so royalty+fee can never exceed the sale price.
- **Admin** endpoints gated by `ADMIN_ADDRESSES` allowlist; on-chain fee/royalty
  changes require the contract **owner** wallet (enforced by `onlyOwner`).
- **Rate limiting:** 600 req/15 min across `/api`, 60/15 min on auth/sales/upload.
- **Uploads** capped at 50 MB with audio/image MIME allowlists.

> Note: token-gating reveals the full-track gateway URL to verified holders. For
> hard DRM, serve the full track from an access-controlled/encrypted store rather
> than a public IPFS CID; the gate (`balanceOf` check) is enforced server-side
> either way.

---

## 7. Milestone completion — see [MILESTONES_DELIVERED.md](./MILESTONES_DELIVERED.md)
