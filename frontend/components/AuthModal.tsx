"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

declare global { interface Window { google?: any; } }

export default function AuthModal() {
  const { authOpen, closeAuth, signUpEmail, loginEmail, loginGoogle, signIn, loading, error } = useAuth();
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [mounted, setMounted] = useState(false);
  const [googleId, setGoogleId] = useState<string | null>(null);
  const gBtn = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { if (authOpen) api.googleStatus().then((d) => setGoogleId(d.enabled ? d.clientId : null)).catch(() => setGoogleId(null)); }, [authOpen]);

  // lock scroll while open
  useEffect(() => {
    if (!authOpen) return;
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [authOpen]);

  // render the official Google button once the GIS script + client id are ready
  useEffect(() => {
    if (!authOpen || !googleId) return;
    let cancelled = false;
    const init = () => {
      if (cancelled || !window.google?.accounts?.id || !gBtn.current) return;
      window.google.accounts.id.initialize({
        client_id: googleId,
        callback: (resp: any) => { if (resp?.credential) loginGoogle(resp.credential).catch(() => {}); },
      });
      gBtn.current.innerHTML = "";
      window.google.accounts.id.renderButton(gBtn.current, { theme: "outline", size: "large", width: 320, text: "continue_with" });
    };
    if (window.google?.accounts?.id) { init(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true; s.onload = init;
    document.head.appendChild(s);
    return () => { cancelled = true; };
  }, [authOpen, googleId, loginGoogle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeAuth();
    if (authOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authOpen, closeAuth]);

  if (!mounted || !authOpen) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (mode === "signup") await signUpEmail(email.trim(), password, handle.trim() || undefined);
      else await loginEmail(email.trim(), password);
    } catch { /* error shown from context */ }
  }

  return createPortal(
    <div className="bm-overlay" onClick={closeAuth} role="dialog" aria-modal="true" aria-label="Sign in">
      <div className="bm-panel au-panel" onClick={(e) => e.stopPropagation()}>
        <button className="bm-close" onClick={closeAuth} aria-label="Close">✕</button>
        <h3 className="au-title">{mode === "signup" ? "Create your account" : "Welcome back"}</h3>

        <div ref={gBtn} className="au-google" />
        {googleId && <div className="au-or"><span>or</span></div>}

        <form className="au-form" onSubmit={submit}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" required />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "Password (min 8 chars)" : "Password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
          {mode === "signup" && <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Artist / display name (optional)" maxLength={40} />}
          {error && <div className="mint-err">{error}</div>}
          <button className="buy" type="submit" disabled={loading}>
            {loading ? "…" : mode === "signup" ? "SIGN UP" : "LOG IN"}
          </button>
        </form>

        <div className="au-switch">
          {mode === "login"
            ? <>New here? <button onClick={() => setMode("signup")}>Create an account</button></>
            : <>Already have an account? <button onClick={() => setMode("login")}>Log in</button></>}
        </div>

        <div className="au-wallet">
          {!isConnected
            ? <button className="au-walletbtn" onClick={() => openConnectModal?.()}>or continue with a crypto wallet</button>
            : <button className="au-walletbtn" onClick={() => signIn()}>sign in with your connected wallet</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
