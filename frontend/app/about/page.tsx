import Link from "next/link";
import Header from "@/components/Header";

export const metadata = { title: "About — TRESRZ" };

export default function AboutPage() {
  return (
    <div className="wrap">
      <Header />

      <section className="block" id="about">
        <div className="sec-title">ABOUT TRESRZ</div>
        <div className="sec-bar" />
        <div className="about-panel">
          <p>
            TRESRZ is a music NFT marketplace where tracks are published as limited on-chain
            editions (ERC-1155). Artists set the supply, the price and their royalty; fans buy
            editions directly from the artist or trade them on the secondary market. Owning an
            edition unlocks full-track streaming — everyone else hears the preview.
          </p>
        </div>
      </section>

      <section className="block" id="docs">
        <div className="sec-title">HOW IT WORKS</div>
        <div className="sec-bar" />
        <div className="about-panel">
          <ol>
            <li><b>Connect &amp; sign in</b> — connect a wallet (MetaMask or WalletConnect) and sign a Sign-In-With-Ethereum message. No password, no email.</li>
            <li><b>Mint</b> — upload your audio and cover art (pinned to IPFS), set supply, price and royalty, and confirm the mint transaction. <Link href="/mint">Mint a track →</Link></li>
            <li><b>Collect</b> — buy editions on the primary market, or via listings and offers on the secondary market. Your holdings live in <Link href="/collection">your collection</Link>.</li>
            <li><b>Stream</b> — holders (and the artist) stream the full track; non-holders hear the preview.</li>
            <li><b>Trade</b> — list editions at a fixed price, make or accept offers, or transfer to any address, all from a track&apos;s page.</li>
          </ol>
        </div>
      </section>

      <section className="block" id="royalties">
        <div className="sec-title">ROYALTIES &amp; FEES</div>
        <div className="sec-bar" />
        <div className="about-panel">
          <p>
            Royalties use the EIP-2981 standard, set per track at publish time (up to 10%). On every
            secondary sale — listing purchase or accepted offer — the royalty is paid to the
            creator automatically by the marketplace contract, then the platform fee (2.5% by
            default), and the remainder goes to the seller. Primary sales pay the artist directly,
            minus the platform fee. All splits are enforced on-chain and visible in the
            transaction logs.
          </p>
        </div>
      </section>

      <section className="block" id="contact">
        <div className="sec-title">CONTACT</div>
        <div className="sec-bar" />
        <div className="about-panel">
          <p>
            Questions, takedown requests or partnership ideas:{" "}
            <a href="mailto:hello@tresrz.app">hello@tresrz.app</a>. For anything on-chain, the
            contract addresses are linked from every track&apos;s ON-CHAIN panel.
          </p>
          <p><Link href="/">← Back to the marketplace</Link></p>
        </div>
      </section>
    </div>
  );
}
