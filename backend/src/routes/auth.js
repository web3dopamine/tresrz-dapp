import { Router } from "express";
import { generateNonce, SiweMessage } from "siwe";
import { prisma } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const r = Router();
const NONCE_TTL_MS = 10 * 60 * 1000; // a login nonce is valid for 10 minutes

// Hosts the browser may legitimately present as the SIWE message `domain`.
// Built from CORS_ORIGIN (the allowed frontend origins) plus SIWE_DOMAIN as a fallback,
// so the frontend's `domain: window.location.host` always matches whichever host is in use.
const allowedDomains = new Set(
  [
    ...(process.env.CORS_ORIGIN || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => {
        try {
          return new URL(o).host;
        } catch {
          return o;
        }
      }),
    process.env.SIWE_DOMAIN,
  ].filter(Boolean)
);

// Pick the domain to verify the SIWE message against: prefer the message's own domain
// when it is allowlisted, otherwise fall back to the configured SIWE_DOMAIN.
function resolveDomain(messageDomain) {
  if (messageDomain && allowedDomains.has(messageDomain)) return messageDomain;
  return process.env.SIWE_DOMAIN;
}

// 1) Client asks for a nonce to sign (persisted in the DB so it survives restarts)
r.get("/nonce", async (req, res) => {
  try {
    const nonce = generateNonce();
    const addr = String(req.query.address || "").toLowerCase();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return res.status(400).json({ error: "valid address required" });
    await prisma.siweNonce.upsert({ where: { address: addr }, update: { nonce, createdAt: new Date() }, create: { address: addr, nonce } });
    res.json({ nonce });
  } catch (e) {
    res.status(500).json({ error: "could not issue nonce", detail: String(e.message || e) });
  }
});

// 2) Client returns signed SIWE message -> we verify & issue JWT
r.post("/verify", async (req, res) => {
  try {
    const { message, signature } = req.body || {};
    if (!message || !signature) return res.status(400).json({ error: "message and signature required" });
    const siwe = new SiweMessage(message);
    const addr = siwe.address.toLowerCase();

    const record = await prisma.siweNonce.findUnique({ where: { address: addr } });
    if (!record) return res.status(401).json({ error: "no nonce issued for this address" });
    if (Date.now() - record.createdAt.getTime() > NONCE_TTL_MS) {
      await prisma.siweNonce.delete({ where: { address: addr } }).catch(() => {});
      return res.status(401).json({ error: "nonce expired, request a new one" });
    }

    const domain = resolveDomain(siwe.domain);
    const { data } = await siwe.verify({ signature, nonce: record.nonce, domain });
    // single-use: consume the nonce so the signature can't be replayed
    await prisma.siweNonce.delete({ where: { address: addr } }).catch(() => {});

    const user = await prisma.user.upsert({
      where: { address: data.address },
      update: {},
      create: { address: data.address, avatarSeed: Math.floor(Math.random() * 9999) },
    });
    res.json({ token: signToken(user), user });
  } catch (e) {
    res.status(401).json({ error: "verification failed", detail: String(e.message || e) });
  }
});

// 3) Who am I
r.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({ user });
});

export default r;
