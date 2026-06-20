// IPFS pinning via Pinata, with a local-filesystem fallback so the upload
// pipeline works in development without API keys. When PINATA_JWT is set, files
// and metadata are pinned to IPFS and addressed by CID through a public gateway.
// Otherwise they are written to ./uploads and served by the API at /uploads/*.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PINATA_JWT = process.env.PINATA_JWT || "";
const PINATA_GATEWAY = (process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud").replace(/\/$/, "");
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""); // e.g. http://localhost:4000

export const ipfsConfigured = !!PINATA_JWT;

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
function ensureDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** Public gateway URL for a CID (ipfs:// or bare CID accepted). */
export function gatewayUrl(cid) {
  if (!cid) return null;
  const id = String(cid).replace(/^ipfs:\/\//, "");
  return `${PINATA_GATEWAY}/ipfs/${id}`;
}

/** Local fallback URL for a stored file. */
function localUrl(filename) {
  const base = PUBLIC_BASE || "";
  return `${base}/uploads/${filename}`;
}

/**
 * Pin a binary file. Returns { cid, uri, url } where uri is `ipfs://<cid>` when
 * pinned to IPFS, and url is a directly-fetchable gateway/local URL.
 */
export async function pinFile(buffer, filename, contentType) {
  if (!PINATA_JWT) {
    ensureDir();
    const ext = path.extname(filename || "") || "";
    const name = crypto.randomBytes(16).toString("hex") + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
    return { cid: null, uri: null, url: localUrl(name), pinned: false };
  }
  const form = new FormData();
  const blob = new Blob([buffer], { type: contentType || "application/octet-stream" });
  form.append("file", blob, filename || "file");
  form.append("pinataMetadata", JSON.stringify({ name: filename || "file" }));

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`pinata file pin failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const cid = json.IpfsHash;
  return { cid, uri: `ipfs://${cid}`, url: gatewayUrl(cid), pinned: true };
}

/** Pin a JSON object (e.g. NFT metadata). Returns { cid, uri, url }. */
export async function pinJSON(obj, name = "metadata.json") {
  if (!PINATA_JWT) {
    ensureDir();
    const filename = crypto.randomBytes(16).toString("hex") + ".json";
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), JSON.stringify(obj, null, 2));
    return { cid: null, uri: null, url: localUrl(filename), pinned: false };
  }
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pinataContent: obj, pinataMetadata: { name } }),
  });
  if (!res.ok) throw new Error(`pinata json pin failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const cid = json.IpfsHash;
  return { cid, uri: `ipfs://${cid}`, url: gatewayUrl(cid), pinned: true };
}

/**
 * Build ERC-721/ERC-1155-compliant metadata for a track. `image` and
 * `animation_url` should be gateway URLs or ipfs:// URIs.
 */
export function buildMetadata({ title, description, image, audio, genre, artist, attributes = [] }) {
  return {
    name: title,
    description: description || `"${title}" — a music NFT on TRESRZ.`,
    image, // cover art
    animation_url: audio, // full-track audio (ERC-721 metadata extension)
    external_url: artist ? `https://tresrz.app/artist/${artist}` : undefined,
    attributes: [
      genre ? { trait_type: "Genre", value: genre } : null,
      artist ? { trait_type: "Artist", value: artist } : null,
      ...attributes,
    ].filter(Boolean),
  };
}

export { UPLOAD_DIR };
