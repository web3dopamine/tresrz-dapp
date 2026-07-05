import { Router } from "express";
import crypto from "crypto";
import { generateNonce, SiweMessage } from "siwe";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../db.js";
import { signToken, requireAuth, isAdminAddress } from "../middleware/auth.js";

const r = Router();
const NONCE_TTL_MS = 10 * 60 * 1000; // a login nonce is valid for 10 minutes

// ---- email + password (scrypt; no external dep) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64).toString("hex");
  const a = Buffer.from(h), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const publicUser = (u) => ({ id: u.id, email: u.email, handle: u.handle, address: u.address, avatarSeed: u.avatarSeed });

// POST /api/auth/signup { email, password, handle? }  (no email verification)
r.post("/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const handle = String(req.body?.handle || "").trim() || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "valid email required" });
  if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "an account with this email already exists — log in instead" });
  try {
    const handleFree = handle ? !(await prisma.user.findUnique({ where: { handle } })) : false;
    const user = await prisma.user.create({
      data: { email, passwordHash: hashPassword(password), handle: handleFree ? handle : null, avatarSeed: Math.floor(Math.random() * 9999) },
    });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    if (e?.code === "P2002") return res.status(409).json({ error: "email or name already taken" });
    res.status(500).json({ error: "could not create account", detail: String(e.message || e) });
  }
});

// POST /api/auth/login { email, password }
r.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "invalid email or password" });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

// POST /api/auth/google { credential }  -- Google Identity Services ID token
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
r.get("/google/status", (_req, res) => res.json({ enabled: !!googleClient, clientId: GOOGLE_CLIENT_ID || null }));
r.post("/google", async (req, res) => {
  if (!googleClient) return res.status(503).json({ error: "Google sign-in not configured" });
  const credential = String(req.body?.credential || "");
  if (!credential) return res.status(400).json({ error: "missing credential" });
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (e) {
    return res.status(401).json({ error: "invalid Google credential" });
  }
  const googleId = payload.sub;
  const email = String(payload.email || "").toLowerCase();
  try {
    // match by googleId, else adopt an existing same-email account, else create
    let user = await prisma.user.findUnique({ where: { googleId } });
    if (!user && email) {
      const byEmail = await prisma.user.findUnique({ where: { email } });
      if (byEmail) user = await prisma.user.update({ where: { id: byEmail.id }, data: { googleId } });
    }
    if (!user) {
      user = await prisma.user.create({
        data: { googleId, email: email || null, handle: null, avatarSeed: Math.floor(Math.random() * 9999) },
      });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    if (e?.code === "P2002") return res.status(409).json({ error: "account conflict" });
    res.status(500).json({ error: "google sign-in failed", detail: String(e.message || e) });
  }
});

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
  res.json({ user, isAdmin: isAdminAddress(req.user.address) });
});

export default r;
