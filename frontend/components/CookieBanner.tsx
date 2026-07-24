"use client";
import { useEffect, useState } from "react";

const KEY = "tresrz_cookie_ok";

export default function CookieBanner() {
  const [hide, setHide] = useState(true); // hidden until we know it wasn't dismissed
  const [showSpecifics, setShowSpecifics] = useState(false);

  useEffect(() => {
    setHide(localStorage.getItem(KEY) === "1");
  }, []);

  function dismiss() {
    localStorage.setItem(KEY, "1");
    setHide(true);
  }

  return (
    <div className={`cookie${hide ? " hide" : ""}`}>
      <p>Accept all cookies:</p>
      <button className="save" onClick={dismiss}>Save and close</button>
      <button className="spec" onClick={() => setShowSpecifics((v) => !v)}>
        {showSpecifics ? "Hide specifics" : "Show specifics"}
      </button>
      {showSpecifics && (
        <div className="cookie-specifics">
          TRESRZ stores no tracking or advertising cookies. The only browser storage used:
          <ul>
            <li><b>tresrz_token</b> — your sign-in session (JWT), kept until you sign out.</li>
            <li><b>tresrz-theme</b> — your light/dark theme choice.</li>
            <li><b>tresrz_cookie_ok</b> — remembers that you closed this banner.</li>
            <li>Your wallet extension may store its own connection state.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
