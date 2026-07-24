# TRESRZ — Music NFT Marketplace (full dApp)

A neon/cyberpunk music NFT marketplace. Artists mint tracks as limited editions
(ERC-1155), fans buy editions on-chain, royalties flow to creators (ERC-2981).

## Stack
| Layer       | Tech |
|-------------|------|
| Contracts   | Solidity 0.8.24, OpenZeppelin, Hardhat (`TresrzMusic` ERC-1155 + ERC-2981) |
| Backend     | Node + Express, Prisma, **PostgreSQL**, SIWE auth + JWT |
| Frontend    | Next.js 14 (App Router, TS) |
| Wallet      | **wagmi v2 + RainbowKit v2 + viem**, Sign-In With Ethereum |
| Chains      | Liberty Chain (13370), Sepolia, Mainnet — edit `frontend/lib/wagmi.ts` |

### Why Postgres over Mongo
The domain is relational: artists → tracks → editions → sales → likes, with
unique constraints (one like per user/track, unique tx hashes) and transactional
mint+sale updates. Prisma + Postgres gives integrity and clean joins for the
"popular artists by total likes" and "editions left" queries.

## Quick start
```bash
./setup.sh                       # postgres + install + db push + seed
cd backend  && npm run dev       # http://localhost:31338
cd frontend && npm run dev       # http://localhost:31337
```
The frontend renders demo data immediately; once the API + seed are up it pulls live data.

## Wallet flow (SIWE)
1. User clicks **Connect** (RainbowKit modal).
2. App requests a nonce → builds a SIWE message → wallet signs.
3. Backend verifies the signature, upserts the user, returns a JWT.
4. JWT authorizes likes, sale records, and minting metadata.

## Deploy the contract
```bash
cd contracts
cp .env.example .env             # add PRIVATE_KEY, FEE_RECIPIENT
npm run deploy:liberty           # or deploy:local / network sepolia
# put the printed address in frontend/.env.local -> NEXT_PUBLIC_MUSIC_CONTRACT
```

## API
| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET  | /api/tracks?hot=true | – | list tracks |
| GET  | /api/tracks/:id | – | one track |
| POST | /api/tracks | ✓ | persist minted track metadata |
| GET  | /api/artists | – | popular artists |
| POST | /api/likes/:trackId | ✓ | toggle like |
| POST | /api/sales | ✓ | record confirmed purchase |
| GET  | /api/auth/nonce / POST /api/auth/verify / GET /api/auth/me | – / – / ✓ | SIWE |

## Layout
```
contracts/  Hardhat project (TresrzMusic.sol, deploy.js, test/)
backend/    Express + Prisma API (routes, SIWE middleware, seed)
frontend/   Next.js app (RainbowKit providers, components, generative art)
```

## Ports
Frontend **31337**, backend API **31338** (see `*/.env.example`). The frontend `dev`/`start`
scripts pin `-p 31337`.

## Local run without Docker
`docker-compose.yml` describes the Postgres the app expects
(`postgresql://tresrz:tresrz@localhost:5432/tresrz`). If you can't run Docker, point
`DATABASE_URL` at any Postgres exposing that database. Then:
```bash
cd contracts && npm i && npx hardhat node &        # local chain (chainId 31337)
npm run deploy:local                               # prints the TresrzMusic address
# put that address in backend/.env (MUSIC_CONTRACT) and frontend/.env.local (NEXT_PUBLIC_MUSIC_CONTRACT)
cd ../backend  && npm i && npx prisma db push && npm run seed && npm run dev   # :31338
cd ../frontend && npm i && npm run dev                                        # :31337
```
The seed **mints the demo tracks on-chain** (from hardhat artist accounts) when
`MUSIC_CONTRACT`/`RPC_URL` are set, so every seeded track is real and buyable; without
them it seeds off-chain (`chainTokenId = null`).

## Production-hardening notes
- **`JWT_SECRET` is required at boot** — the API exits if it's missing, the placeholder, or <32 chars.
- **SIWE nonces are stored in Postgres** (`SiweNonce`, 10-min TTL, single-use) so pending
  logins survive an API restart.
- **`POST /api/sales` is verified on-chain** — the server reads the `TrackPurchased` event
  for the supplied `txHash` and only records the sale if the tokenId, buyer (= the
  authenticated wallet) and qty match. Forged/replayed tx hashes are rejected.
- **Rate limiting** (`express-rate-limit`): 600 req/15 min across `/api`, 60/15 min on
  `/api/auth` and `/api/sales`.
- **Contract tests**: `cd contracts && npm test` (mint/royalty bounds, fee split, refund,
  sold-out/inactive reverts, reentrancy).
