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
            <li><b>Sign in</b> — create an account with email or Google in a few seconds. No wallet or crypto required to get started.</li>
            <li><b>Publish</b> — upload your audio and cover art (pinned to IPFS), set the supply, a price in USD and your royalty, and hit publish. It goes on-chain in the background and lands live on the marketplace. <Link href="/mint">Publish a track →</Link></li>
            <li><b>Collect</b> — fans buy editions with a card (USD) or with crypto — no wallet needed for card checkout. Holdings live in <Link href="/collection">your collection</Link>.</li>
            <li><b>Stream</b> — holders (and the artist) stream the full track; everyone else hears the preview.</li>
            <li><b>Trade</b> — connect a wallet to list editions, make or accept offers, or transfer to any address from a track&apos;s page. Prices are shown and entered in USD.</li>
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

      <section className="block" id="terms">
        <div className="sec-title">TERMS</div>
        <div className="sec-bar" />
        <div className="about-panel">
          <p>
            TRESRZ is provided “as is” for publishing, buying and streaming music editions. By
            using it you confirm you own or are licensed to distribute any audio and artwork you
            publish, and that you will not upload infringing, unlawful or harmful content. Editions
            are blockchain assets: on-chain transactions are final and irreversible, and their value
            can go down as well as up. We may remove content that violates these terms or the law,
            and we are not liable for losses arising from use of the marketplace, third-party
            wallets, or the underlying network. This is an early-stage product currently running on
            a test network.
          </p>
        </div>
      </section>

      <section className="block" id="privacy">
        <div className="sec-title">PRIVACY</div>
        <div className="sec-bar" />
        <div className="about-panel">
          <p>
            We collect only what we need to run the service: your account email (or Google account
            identifier), the tracks you publish, and basic activity such as likes and purchases.
            Passwords are stored only as salted hashes; we never see your card details — card
            payments are handled by Stripe. Public blockchain data (wallet addresses, transactions)
            is inherently public. We don’t sell your personal data. To access or delete your data,
            email <a href="mailto:hello@tresrz.app">hello@tresrz.app</a>.
          </p>
        </div>
      </section>

      <section className="block" id="cookies">
        <div className="sec-title">COOKIES</div>
        <div className="sec-bar" />
        <div className="about-panel">
          <p>
            TRESRZ uses only essential storage — a login token kept in your browser to keep you
            signed in, and a small flag remembering your cookie choice and theme. We don’t use
            advertising or third-party tracking cookies. You can clear this storage any time from
            your browser settings.
          </p>
        </div>
      </section>
    </div>
  );
}
