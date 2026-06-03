import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import trackRoutes from "./routes/tracks.js";
import artistRoutes from "./routes/artists.js";
import likeRoutes from "./routes/likes.js";
import saleRoutes from "./routes/sales.js";

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || "*" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "tresrz-api" }));
app.use("/api/auth", authRoutes);
app.use("/api/tracks", trackRoutes);
app.use("/api/artists", artistRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/sales", saleRoutes);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`TRESRZ API on :${port}`));
