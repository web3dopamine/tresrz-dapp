#!/usr/bin/env bash
set -e
echo "▶ TRESRZ setup"
echo "1) Postgres"; docker compose up -d
echo "2) Backend"; (cd backend && cp -n .env.example .env || true && npm i && npx prisma db push && npm run seed)
echo "3) Contracts (optional)"; (cd contracts && cp -n .env.example .env || true && npm i)
echo "4) Frontend"; (cd frontend && cp -n .env.example .env.local || true && npm i)
echo "✓ Done. Run backend:  cd backend && npm run dev   (:31338)"
echo "        Run frontend: cd frontend && npm run dev  (:31337)"
