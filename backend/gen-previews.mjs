// Generate lightweight hover-preview clips for video NFTs: a short, downscaled,
// faststart mp4 (~300KB) per track, stored in ./previews/<trackId>.mp4 and served
// by GET /api/media/:id/preview. Resumable (skips clips that already exist).
//
//   node gen-previews.mjs [CONCURRENCY]
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const DIR = path.resolve(process.cwd(), "previews");
fs.mkdirSync(DIR, { recursive: true });
const CONC = Number(process.argv[2] || 4);

function genOne(src, out) {
  return new Promise((resolve) => {
    execFile(
      "ffmpeg",
      ["-y", "-i", src, "-t", "8", "-vf", "scale=480:-2", "-an",
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-movflags", "+faststart", out],
      { timeout: 120000 },
      (err) => resolve(!err),
    );
  });
}

async function main() {
  const tracks = await prisma.track.findMany({
    where: { mime: { startsWith: "video" } },
    select: { id: true, externalUrl: true, audioUrl: true },
  });
  const todo = tracks.filter((t) => {
    if (!(t.externalUrl || t.audioUrl)) return false;
    try { return fs.statSync(path.join(DIR, `${t.id}.mp4`)).size < 1000; } catch { return true; }
  });
  console.log(`video tracks: ${tracks.length} | to generate: ${todo.length} | concurrency ${CONC}`);

  let done = 0, ok = 0, fail = 0, idx = 0;
  async function worker() {
    while (idx < todo.length) {
      const t = todo[idx++];
      const out = path.join(DIR, `${t.id}.mp4`);
      const success = await genOne(t.externalUrl || t.audioUrl, out);
      let good = false;
      try { good = success && fs.statSync(out).size > 1000; } catch {}
      if (good) ok++; else { fail++; try { fs.unlinkSync(out); } catch {} }
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${todo.length} (ok ${ok}, fail ${fail})`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`DONE. generated=${ok} failed=${fail}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
