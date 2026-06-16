"use client";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export default function Header({ search, setSearch }: { search?: string; setSearch?: (s: string) => void }) {
  const { isConnected } = useAccount();
  const { token, signIn, signOut, loading } = useAuth();

  // prompt SIWE once wallet connects but not yet authenticated
  useEffect(() => { if (isConnected && !token && !loading) signIn().catch(() => {}); }, [isConnected, token]);

  return (
    <header>
      <Link href="/" className="logo" style={{ textDecoration: "none" }}>
        <div className="bars"><span /><span /><span /><span /></div>
        <b>TRES<span>RZ</span></b>
      </Link>
      {setSearch && (
        <div className="search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search artist or track" /></div>
      )}
      <div className="lang"><button className="on">EN</button><i>/</i><button>IT</button></div>
      <nav>
        <Link href="/#hot">MARKETPLACE</Link>
        <Link href="/#popular">DROPS</Link>
        <Link href="/#latest">STREAMING</Link>
        <Link href="/mint">MINT</Link>
        <Link href="/collection">COLLECTION</Link>
      </nav>
      <div className="auth-area">
        {token && <button className="heart" style={{ color: "var(--muted)", fontSize: 11 }} onClick={signOut}>SIGN OUT</button>}
        <ConnectButton showBalance={false} accountStatus="address" chainStatus="icon" label="SIGN UP / LOGIN" />
      </div>
    </header>
  );
}
