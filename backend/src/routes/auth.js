import { Router } from "express";
import { generateNonce, SiweMessage } from "siwe";
import { prisma } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const r = Router();
const nonces = new Map(); // address(lower) -> nonce  (use Redis in production)

// 1) Client asks for a nonce to sign
r.get("/nonce", (req, res) => {
  const nonce = generateNonce();
  const addr = (req.query.address || "").toLowerCase();
  nonces.set(addr, nonce);
  res.json({ nonce });
});

// 2) Client returns signed SIWE message -> we verify & issue JWT
r.post("/verify", async (req, res) => {
  try {
    const { message, signature } = req.body;
    const siwe = new SiweMessage(message);
    const expected = nonces.get(siwe.address.toLowerCase());
    const { data } = await siwe.verify({ signature, nonce: expected, domain: process.env.SIWE_DOMAIN });
    nonces.delete(siwe.address.toLowerCase());

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
