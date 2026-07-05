"use client";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";

export default function Header({ search, setSearch }: { search?: string; setSearch?: (s: string) => void }) {
  const { address, isConnected } = useAccount();
  const { token, me, signOut, openAuth } = useAuth();
  const { theme, toggle } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const who = me?.handle || (me?.email ? me.email.split("@")[0] : (me?.address ? `${me.address.slice(0, 6)}…` : "Account"));

  // NOTE: SIWE sign-in is explicit (the "SIGN IN" button below) — we no longer
  // auto-prompt on connect, so MetaMask doesn't pop a signature on every refresh.

  // check admin access once authenticated (SSR-safe: runs in effect)
  useEffect(() => {
    if (!token) { setIsAdmin(false); return; }
    api.me().then((d) => setIsAdmin(!!d.isAdmin)).catch(() => setIsAdmin(false));
  }, [token]);

  return (
    <header>
      <Link href="/" className="logo" style={{ textDecoration: "none" }}>
        <div className="bars"><span /><span /><span /><span /></div>
        <b>TRES<span>RZ</span></b>
      </Link>
      {setSearch && (
        <div className="search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search artist or track" /></div>
      )}
      <nav>
        <Link href="/#hot">MARKETPLACE</Link>
        <Link href="/#latest">SUGGESTED</Link>
        <Link href="/#popular">ARTISTS</Link>
        <Link href="/mint">PUBLISH</Link>
        <Link href="/collection">COLLECTION</Link>
        {isConnected && address && <Link href={`/profile/${address}`}>PROFILE</Link>}
        {isAdmin && <Link href="/admin">ADMIN</Link>}
      </nav>
      <button
        className="nav-burger"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Open menu"
        aria-expanded={menuOpen}
      >
        {menuOpen ? (
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
        )}
      </button>
      {menuOpen && (
        <div className="mobile-menu" onClick={() => setMenuOpen(false)}>
          <Link href="/#hot">MARKETPLACE</Link>
          <Link href="/#latest">SUGGESTED</Link>
          <Link href="/#popular">ARTISTS</Link>
          <Link href="/mint">PUBLISH</Link>
          <Link href="/collection">COLLECTION</Link>
          {isConnected && address && <Link href={`/profile/${address}`}>PROFILE</Link>}
          {isAdmin && <Link href="/admin">ADMIN</Link>}
        </div>
      )}
      <button
        className="theme-toggle"
        onClick={toggle}
        aria-label="Toggle light / dark theme"
        title="Toggle light / dark theme"
        suppressHydrationWarning
      >
        <span suppressHydrationWarning>{theme === "dark" ? "☀" : "☾"}</span>
        <span suppressHydrationWarning>{theme === "dark" ? "LIGHT" : "DARK"}</span>
      </button>
      <div className="auth-area">
        {token ? (
          <>
            <span className="au-who" title={me?.email || me?.address || ""}>{who}</span>
            <button className="au-signout" onClick={signOut}>SIGN OUT</button>
          </>
        ) : (
          <button className="au-login" onClick={openAuth}>SIGN UP / LOGIN</button>
        )}
      </div>
    </header>
  );
}
