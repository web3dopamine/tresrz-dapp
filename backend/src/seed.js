import "dotenv/config";
import { prisma } from "./db.js";

const E = (n) => BigInt(Math.round(n * 1e18)).toString(); // ETH -> wei string

const artists = [
  ["BLOCKJ4NE","BELLADONNA"],["Charlie","NERVOUSCAT"],["The_Account","matlemad"],
  ["TwoSpiral","Jaidem"],["GordieDean","Cappadonia"],["Adeline_Yeo","La_Santeria"],
];

const tracks = [
  { title:"NEON PULSE", genre:"SYNTHWAVE", price:0.47, max:14, hot:true },
  { title:"Remore", genre:"HOUSE", price:1.97, max:1, hot:true },
  { title:"AWAKENING", genre:"AMBIENT", price:3.80, max:33, hot:true },
  { title:"Two Spirals", genre:"TECHNO", price:0.85, max:5, hot:true },
  { title:"Dub Skull", genre:"DUB", price:9.39, max:1, hot:true },
  { title:"After Hours", genre:"LO-FI", price:0.30, max:20 },
  { title:"Polychrome", genre:"JAZZ", price:0.55, max:8 },
  { title:"Latin Tech", genre:"TRAP", price:1.10, max:12 },
  { title:"Static Bloom", genre:"PHONK", price:0.72, max:6 },
  { title:"Midnight Run", genre:"DRILL", price:1.45, max:9 },
];

async function main() {
  console.log("Seeding…");
  const userIds = [];
  for (let i = 0; i < artists.length; i++) {
    const addr = "0x" + (i + 1).toString(16).padStart(40, "0");
    const u = await prisma.user.upsert({
      where: { address: addr },
      update: {},
      create: { address: addr, handle: artists[i][0], avatarSeed: i * 137 + 7 },
    });
    userIds.push(u.id);
  }
  let token = 1;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    await prisma.track.create({
      data: {
        title: t.title, genre: t.genre, priceWei: E(t.price), maxSupply: t.max,
        minted: Math.floor(Math.random() * Math.min(t.max, 3)),
        coverSeed: i * 53 + 11, hot: !!t.hot, chainTokenId: token++,
        artistId: userIds[i % userIds.length],
      },
    });
  }
  console.log("Done. Users:", userIds.length, "Tracks:", tracks.length);
}
main().finally(() => prisma.$disconnect());
