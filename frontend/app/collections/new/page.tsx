"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function NewCollectionPage() {
  const { token, openAuth } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const c = await api.createCollection({ name: name.trim(), description: description.trim() || undefined });
      router.push(`/collections/${c.slug}`);
    } catch (err: any) { setError(err?.message || "Could not create collection"); setBusy(false); }
  }

  return (
    <div className="wrap">
      <Header />
      <section className="block">
        <div className="sec-title">CREATE A COLLECTION</div>
        <div className="sec-bar" />
        {!token ? (
          <div className="mint-gate">
            <p>Log in to create a collection — you can make as many as you like.</p>
            <button className="buy" style={{ width: "auto", padding: "12px 22px" }} onClick={openAuth}>SIGN UP / LOG IN</button>
          </div>
        ) : (
          <div style={{ maxWidth: 560 }}>
            <p className="mint-lead">Name a new collection, then publish tracks into it from the <Link href="/mint" style={{ color: "var(--crimson-soft)" }}>Publish</Link> page — you pick the collection in the form. One account can own any number of collections, just like OpenSea.</p>
            <form className="mint-form" onSubmit={submit}>
              <label className="mint-field"><span>COLLECTION NAME</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My New Collection" maxLength={80} autoFocus /></label>
              <label className="mint-field"><span>DESCRIPTION (OPTIONAL)</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this collection is about…" maxLength={300} /></label>
              {error && <div className="mint-err">{error}</div>}
              <button className="buy" type="submit" disabled={!name.trim() || busy}>{busy ? "CREATING…" : "CREATE COLLECTION"}</button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
