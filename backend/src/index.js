import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.js";
import trackRoutes from "./routes/tracks.js";
import artistRoutes from "./routes/artists.js";
import likeRoutes from "./routes/likes.js";
import saleRoutes from "./routes/sales.js";

// Fail fast: a missing/placeholder JWT_SECRET means every token is forgeable.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === "change_me_to_a_long_random_string" || JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET is missing, default, or too short (<32 chars). Set a strong JWT_SECRET in backend/.env.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "256kb" }));

// --- rate limiting ---
// General cap across the whole API, plus a tighter cap on auth + sales (the expensive,
// abuse-prone, write paths). Counts per client IP.
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "too many requests, slow down" } });

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
app.use("/api", apiLimiter);
app.use("/api/auth", strictLimiter, authRoutes);
app.use("/api/tracks", trackRoutes);
app.use("/api/artists", artistRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/sales", strictLimiter, saleRoutes);

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
app.listen(port, () => console.log(`TRESRZ API on :${port}`));
