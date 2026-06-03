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
cd backend  && npm run dev       # http://localhost:4000
cd frontend && npm run dev       # http://localhost:3000
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
contracts/  Hardhat project (TresrzMusic.sol, deploy.js)
backend/    Express + Prisma API (routes, SIWE middleware, seed)
frontend/   Next.js app (RainbowKit providers, components, generative art)
```
