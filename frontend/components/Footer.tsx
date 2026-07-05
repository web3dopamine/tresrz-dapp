import Link from "next/link";

// Site-wide footer. Rendered once from the root layout so it appears on every
// page. MARKET links target home-page sections with an absolute "/#anchor" so
// they work from any route (not just the home page).
export default function Footer() {
  return (
    <footer>
      <div className="foot-top">
        <div className="foot-brand">
          <div className="logo"><div className="bars"><span /><span /><span /><span /></div><b>TRES<span>RZ</span></b></div>
          <p>The marketplace where music becomes property. Publish your masters, sell limited editions, and let fans truly own the sound.</p>
        </div>
        <div className="foot-col"><h5>MARKET</h5><Link href="/#hot">Explore</Link><Link href="/#latest">Suggested</Link><Link href="/#popular">Top artists</Link><Link href="/#genres">Genres</Link></div>
        <div className="foot-col"><h5>CREATE</h5><Link href="/mint">Publish a track</Link><Link href="/about#royalties">Royalties</Link><Link href="/about#docs">How it works</Link><Link href="/collection">Your collection</Link></div>
        <div className="foot-col"><h5>COMPANY</h5><Link href="/about">About</Link><Link href="/about#contact">Contact</Link><Link href="/about#docs">Docs</Link></div>
      </div>
      <div className="foot-bottom"><span>© 2026 TRESRZ — All rights reserved</span><span className="foot-legal"><Link href="/about#terms">TERMS</Link> · <Link href="/about#privacy">PRIVACY</Link> · <Link href="/about#cookies">COOKIES</Link></span></div>
    </footer>
  );
}
