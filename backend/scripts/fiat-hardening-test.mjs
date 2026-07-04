// Exercises the hardened fiat flow directly against the running API + chain,
// simulating signed Stripe webhooks to cover paths a browser test can't.
import "dotenv/config";
import Stripe from "stripe";
import { prisma } from "../src/db.js";
import { deliveryBalanceOf } from "../src/chain.js";

const API = "http://localhost:31338";
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const results = [];
const ok = (n, c, x = "") => { results.push(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); };

const track = await prisma.track.findFirst({ where: { chainTokenId: { not: null } } });
const tokenId = track.chainTokenId;

async function sendWebhook(sessionId, meta) {
  const payload = JSON.stringify({
    id: "evt_" + sessionId.slice(-10), type: "checkout.session.completed",
    data: { object: { id: sessionId, payment_intent: "pi_test_" + sessionId.slice(-8), metadata: meta } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  const res = await fetch(`${API}/api/fiat/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const meta = (buyer) => ({ trackId: track.id, chainTokenId: String(tokenId), buyer: buyer || "", qty: "1", unitPriceWei: track.priceWei });
const rnd = () => "cs_test_" + Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 8);

// 1) GUEST hold + claim
const mintedBefore = (await prisma.track.findUnique({ where: { id: track.id } })).minted;
const gs = rnd();
let w = await sendWebhook(gs, meta(""));
ok("guest webhook accepted", w.status === 200, JSON.stringify(w.body));
let order = await prisma.fiatOrder.findUnique({ where: { stripeSessionId: gs } });
ok("guest order held after buy", order?.status === "held", order?.status);
ok("guest buyTx recorded", !!order?.buyTx);
ok("minted incremented once", (await prisma.track.findUnique({ where: { id: track.id } })).minted === mintedBefore + 1);

// 2) DUPLICATE webhook -> no double buy
const dup = await sendWebhook(gs, meta(""));
ok("duplicate webhook is a no-op", dup.status === 200 && dup.body.already === true, JSON.stringify(dup.body));
ok("still exactly one order row", (await prisma.fiatOrder.count({ where: { stripeSessionId: gs } })) === 1);
ok("minted NOT double-counted", (await prisma.track.findUnique({ where: { id: track.id } })).minted === mintedBefore + 1);

// 3) claim to a fresh wallet
const CLAIM = "0x3333333333333333333333333333333333333333";
const c1 = await fetch(`${API}/api/fiat/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: gs, address: CLAIM }) });
const c1b = await c1.json();
ok("claim succeeds", c1.status === 200 && c1b.ok, JSON.stringify(c1b).slice(0, 80));
ok("order marked delivered", (await prisma.fiatOrder.findUnique({ where: { stripeSessionId: gs } })).status === "delivered");

// 4) double-claim rejected
const c2 = await fetch(`${API}/api/fiat/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: gs, address: "0x4444444444444444444444444444444444444444" }) });
ok("double-claim rejected (409)", c2.status === 409, `HTTP ${c2.status}`);

// 5) DIRECT delivery (buyer known) auto-sends
const DIRECT = "0x5555555555555555555555555555555555555555";
const ds = rnd();
const dw = await sendWebhook(ds, meta(DIRECT));
ok("direct webhook accepted", dw.status === 200);
const dorder = await prisma.fiatOrder.findUnique({ where: { stripeSessionId: ds } });
ok("direct order auto-delivered", dorder?.status === "delivered" && dorder?.deliveredTo?.toLowerCase() === DIRECT.toLowerCase(), dorder?.status);

// 6) forged signature rejected
const bad = await fetch(`${API}/api/fiat/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" }, body: JSON.stringify({ id: "evt_x", type: "checkout.session.completed", data: { object: { id: rnd(), metadata: meta("") } } }) });
ok("forged webhook signature rejected", bad.status === 400, `HTTP ${bad.status}`);

// 7) concurrent duplicate webhooks -> single fulfilment (TOCTOU)
const cs = rnd();
const [a, b] = await Promise.all([sendWebhook(cs, meta("")), sendWebhook(cs, meta(""))]);
ok("concurrent dup webhooks both 200", a.status === 200 && b.status === 200);
ok("concurrent dup -> one order", (await prisma.fiatOrder.count({ where: { stripeSessionId: cs } })) === 1);

console.log(results.join("\n"));
await prisma.$disconnect();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
