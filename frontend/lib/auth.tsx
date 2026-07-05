"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { api } from "./api";
import AuthModal from "@/components/AuthModal";

type AuthCtx = {
  token: string | null;
  me: any;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;                 // wallet (SIWE)
  signUpEmail: (email: string, password: string, handle?: string) => Promise<void>;
  loginEmail: (email: string, password: string) => Promise<void>;
  loginGoogle: (credential: string) => Promise<void>;
  signOut: () => void;
  openAuth: () => void;
  closeAuth: () => void;
  authOpen: boolean;
};
const Ctx = createContext<AuthCtx>({
  token: null, me: null, loading: false, error: null,
  signIn: async () => {}, signUpEmail: async () => {}, loginEmail: async () => {}, loginGoogle: async () => {},
  signOut: () => {}, openAuth: () => {}, closeAuth: () => {}, authOpen: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("tresrz_token");
    if (t) { setToken(t); api.me().then((d) => setMe(d.user)).catch(() => signOut()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setSession(jwt: string, user: any) {
    localStorage.setItem("tresrz_token", jwt);
    setToken(jwt); setMe(user); setError(null); setAuthOpen(false);
  }

  const signUpEmail = useCallback(async (email: string, password: string, handle?: string) => {
    setError(null); setLoading(true);
    try { const { token: jwt, user } = await api.signupEmail({ email, password, handle }); setSession(jwt, user); }
    catch (e: any) { setError(e?.message || "Sign up failed"); throw e; }
    finally { setLoading(false); }
  }, []);

  const loginEmail = useCallback(async (email: string, password: string) => {
    setError(null); setLoading(true);
    try { const { token: jwt, user } = await api.loginEmail({ email, password }); setSession(jwt, user); }
    catch (e: any) { setError(e?.message || "Login failed"); throw e; }
    finally { setLoading(false); }
  }, []);

  const loginGoogle = useCallback(async (credential: string) => {
    setError(null); setLoading(true);
    try { const { token: jwt, user } = await api.loginGoogle(credential); setSession(jwt, user); }
    catch (e: any) { setError(e?.message || "Google sign-in failed"); throw e; }
    finally { setLoading(false); }
  }, []);

  // wallet SIWE
  const signIn = useCallback(async () => {
    setError(null);
    if (!isConnected || !address) { setError("Connect your wallet first."); return; }
    setLoading(true);
    try {
      const { nonce } = await api.nonce(address);
      const msg = new SiweMessage({
        domain: window.location.host, address, statement: "Sign in to TRESRZ - own the sound.",
        uri: window.location.origin, version: "1", chainId: chainId ?? 31337, nonce,
      });
      const prepared = msg.prepareMessage();
      const signature = await signMessageAsync({ message: prepared });
      const { token: jwt, user } = await api.verify(prepared, signature);
      setSession(jwt, user);
    } catch (e: any) {
      const m = e?.shortMessage || e?.message || String(e);
      setError(/user rejected|denied/i.test(m) ? "Signature request was rejected in your wallet." : `Sign-in failed: ${m}`);
    } finally { setLoading(false); }
  }, [address, chainId, isConnected, signMessageAsync]);

  const signOut = useCallback(() => { localStorage.removeItem("tresrz_token"); setToken(null); setMe(null); setError(null); }, []);
  const openAuth = useCallback(() => { setError(null); setAuthOpen(true); }, []);
  const closeAuth = useCallback(() => setAuthOpen(false), []);

  return (
    <Ctx.Provider value={{ token, me, loading, error, signIn, signUpEmail, loginEmail, loginGoogle, signOut, openAuth, closeAuth, authOpen }}>
      {children}
      <AuthModal />
    </Ctx.Provider>
  );
}
export const useAuth = () => useContext(Ctx);
