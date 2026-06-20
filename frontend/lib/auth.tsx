"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { api } from "./api";

type AuthCtx = { token: string | null; me: any; loading: boolean; error: string | null; signIn: () => Promise<void>; signOut: () => void };
const Ctx = createContext<AuthCtx>({ token: null, me: null, loading: false, error: null, signIn: async () => {}, signOut: () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { const t = localStorage.getItem("tresrz_token"); if (t) { setToken(t); api.me().then((d) => setMe(d.user)).catch(() => signOut()); } }, []);

  // SIWE flow: nonce -> sign -> verify -> JWT. Errors are surfaced (UI + console)
  // instead of swallowed, so a failed/rejected signature isn't a silent no-op.
  const signIn = useCallback(async () => {
    setError(null);
    if (!isConnected || !address) { setError("Connect your wallet first."); return; }
    setLoading(true);
    try {
      console.debug("[SIWE] requesting nonce for", address);
      const { nonce } = await api.nonce(address);
      const msg = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to TRESRZ - own the sound.",
        uri: window.location.origin,
        version: "1",
        chainId: chainId ?? 31337,
        nonce,
      });
      const prepared = msg.prepareMessage();
      console.debug("[SIWE] requesting signature…");
      const signature = await signMessageAsync({ message: prepared });
      console.debug("[SIWE] verifying signature…");
      const { token: jwt, user } = await api.verify(prepared, signature);
      localStorage.setItem("tresrz_token", jwt);
      setToken(jwt); setMe(user);
      console.debug("[SIWE] signed in as", user?.address);
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || String(e);
      console.error("[SIWE] sign-in failed:", e);
      setError(/user rejected|denied/i.test(msg) ? "Signature request was rejected in your wallet." : `Sign-in failed: ${msg}`);
    } finally { setLoading(false); }
  }, [address, chainId, isConnected, signMessageAsync]);

  const signOut = useCallback(() => { localStorage.removeItem("tresrz_token"); setToken(null); setMe(null); setError(null); }, []);

  // auto sign-out if wallet disconnects
  useEffect(() => { if (!isConnected && token) signOut(); }, [isConnected]);

  return <Ctx.Provider value={{ token, me, loading, error, signIn, signOut }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
