import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.js";
import trackRoutes from "./routes/tracks.js";
import artistRoutes from "./routes/artists.js";
import likeRoutes from "./routes/likes.js";
import saleRoutes from "./routes/sales.js";
import uploadRoutes from "./routes/upload.js";
import streamRoutes from "./routes/stream.js";
import adminRoutes from "./routes/admin.js";
import rateRoutes from "./routes/rate.js";
import fiatRoutes, { fiatWebhook, startFiatReconciler } from "./routes/fiat.js";
import mintRoutes, { startMintReconciler } from "./routes/mint.js";
import mediaRoutes from "./routes/media.js";
import collectionRoutes from "./routes/collections.js";
import activityRoutes from "./routes/activity.js";
import { UPLOAD_DIR } from "./ipfs.js";

// Fail fast: a missing/placeholder JWT_SECRET means every token is forgeable.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === "change_me_to_a_long_random_string" || JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET is missing, default, or too short (<32 chars). Set a strong JWT_SECRET in backend/.env.");
  process.exit(1);
}

const app = express();
// Requests arrive via a proxy: the Next.js /api rewrite (and Cloudflare in front of it)
// set X-Forwarded-For. Trust one proxy hop so req.ip is the real client and
// express-rate-limit accepts the forwarded header instead of crashing.
app.set("trust proxy", 1);
// Stripe webhook needs the raw request body for signature verification —
// mount it before the JSON parser touches anything.
app.post("/api/fiat/webhook", express.raw({ type: "application/json" }), fiatWebhook);
app.use(express.json({ limit: "256kb" }));

// --- rate limiting ---
// General cap across the whole API, plus a tighter cap on auth + sales (the expensive,
// abuse-prone, write paths). Counts per client IP.
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "too many requests, slow down" } });
// Custodial mint has the platform pay gas, so it's tightly capped per IP
// (anti gas-drain). A global daily cap is also enforced in the route.
const mintLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: Number(process.env.MINT_HOURLY_CAP || 6), standardHeaders: true, legacyHeaders: false, message: { error: "minting limit reached for now, try again later" } });

// Allowed browser origins (frontend). "*" if unset (dev convenience).
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Non-browser clients (curl, server-to-server) send no Origin — allow them.
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
      // Not allowlisted: respond without CORS headers so the browser blocks it (no 500).
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/health", (_req, res) => res.json({ ok: true, service: "tresrz-api" }));

// Serve locally-stored uploads (IPFS fallback when PINATA_JWT is unset).
app.use("/uploads", express.static(UPLOAD_DIR));

// DB-backed media (audio/cover). Mounted BEFORE the API rate limiter so audio
// Range streaming isn't throttled. Its own long cache headers keep load low.
app.use("/api/media", mediaRoutes);

app.use("/api", apiLimiter);
app.use("/api/auth", strictLimiter, authRoutes);
app.use("/api/tracks", trackRoutes);
app.use("/api/artists", artistRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/sales", strictLimiter, saleRoutes);
app.use("/api/upload", strictLimiter, uploadRoutes);
app.use("/api/stream", streamRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/rate", rateRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/fiat", strictLimiter, fiatRoutes);
app.use("/api/mint", mintLimiter, mintRoutes);

// 404 + central error handler so a thrown/rejected handler returns JSON, never crashes.
app.use((_req, res) => res.status(404).json({ error: "not found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal error" });
});

// Last-resort guards: log instead of letting the process die on an async slip.
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`TRESRZ API on :${port}`);
  startFiatReconciler(); // heals card orders stuck by crashes/timeouts
  startMintReconciler(); // finalizes background mints once they confirm on-chain
});
