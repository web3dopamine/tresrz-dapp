#!/bin/bash
# After the quick tunnel starts it gets a fresh *.trycloudflare.com URL.
# Wait for it to appear in the journal, then point the backend's CORS/SIWE
# config at it and restart the backend so wallet sign-in keeps working.
for i in $(seq 1 60); do
  URL=$(journalctl -u tresrz-tunnel --since "-5 min" -o cat 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
  [ -n "$URL" ] && break
  sleep 2
done
[ -z "$URL" ] && exit 0
HOST=${URL#https://}
ENVF=/root/tresrz-dapp/backend/.env
grep -q "$HOST" "$ENVF" && exit 0
sed -i -E "s|^CORS_ORIGIN=.*|CORS_ORIGIN=\"http://localhost:31337,http://localhost:3000,https://mvp.tresrz.com,$URL\"|" "$ENVF"
sed -i -E "s|^SIWE_DOMAIN=.*|SIWE_DOMAIN=\"$HOST\"|" "$ENVF"
systemctl restart tresrz-backend
