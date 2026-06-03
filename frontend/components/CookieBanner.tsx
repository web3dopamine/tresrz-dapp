"use client";
import { useState } from "react";
export default function CookieBanner() {
  const [hide, setHide] = useState(false);
  return (
    <div className={`cookie${hide ? " hide" : ""}`}>
      <p>Accept all cookies:</p>
      <button className="save" onClick={() => setHide(true)}>Save and close</button>
      <button className="spec" onClick={() => setHide(true)}>Show specifics</button>
    </div>
  );
}
