"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { api } from "./api";

type AuthCtx = { token: string | null; me: any; loading: boolean; signIn: () => Promise<void>; signOut: () => void };
const Ctx = createContext<AuthCtx>({ token: null, me: null, loading: false, signIn: async () => {}, signOut: () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { const t = localStorage.getItem("tresrz_token"); if (t) { setToken(t); api.me().then((d) => setMe(d.user)).catch(() => signOut()); } }, []);

  // SIWE flow: nonce -> sign -> verify -> JWT
  const signIn = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const { nonce } = await api.nonce(address);
      const msg = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to TRESRZ - own the sound.",
        uri: window.location.origin,
        version: "1",
        chainId: chainId ?? 13370,
        nonce,
      });
      const prepared = msg.prepareMessage();
      const signature = await signMessageAsync({ message: prepared });
      const { token: jwt, user } = await api.verify(prepared, signature);
      localStorage.setItem("tresrz_token", jwt);
      setToken(jwt); setMe(user);
    } finally { setLoading(false); }
  }, [address, chainId, signMessageAsync]);

  const signOut = useCallback(() => { localStorage.removeItem("tresrz_token"); setToken(null); setMe(null); }, []);

  // auto sign-out if wallet disconnects
  useEffect(() => { if (!isConnected && token) signOut(); }, [isConnected]);

  return <Ctx.Provider value={{ token, me, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
