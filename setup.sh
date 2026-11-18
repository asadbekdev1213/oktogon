#!/usr/bin/env bash
# Ubuntu/Debian serverida bir buyruq bilan o'rnatish:
#   sudo bash setup.sh <domen> <BOT_TOKEN>
# Masalan: sudo bash setup.sh oktagon.duckdns.org 123456:ABC...
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "sudo bilan ishga tushiring: sudo bash setup.sh <domen> <BOT_TOKEN>"; exit 1; }
DOMAIN="${1:-}"; TOKEN="${2:-}"
if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ]; then
  echo "Ishlatish: sudo bash setup.sh <domen> <BOT_TOKEN>"; exit 1
fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/oktagon

echo "==> Paketlar o'rnatilmoqda"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]; then
  echo "==> Node.js 20 o'rnatilmoqda"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "==> Caddy (avtomatik HTTPS) o'rnatilmoqda"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Ilova $APP ga nusxalanmoqda"
id oktagon >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin oktagon
mkdir -p "$APP/data"
cp -r "$SRC/server.js" "$SRC/questions.json" "$SRC/package.json" "$SRC/public" "$APP/"
cat > "$APP/.env" <<EOF
BOT_TOKEN=$TOKEN
WEBAPP_URL=https://$DOMAIN
PORT=3000
EOF
chmod 600 "$APP/.env"
chown -R oktagon:oktagon "$APP"

echo "==> Xizmat (systemd) sozlanmoqda"
cat > /etc/systemd/system/oktagon.service <<EOF
[Unit]
Description=Huquq Oktagoni
After=network-online.target
Wants=network-online.target

[Service]
User=oktagon
WorkingDirectory=$APP
EnvironmentFile=$APP/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
EOF

echo "==> Portlar (80, 443) ochilmoqda"
if command -v iptables >/dev/null 2>&1; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport $p -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save || true
fi
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow 80/tcp; ufw allow 443/tcp; fi

systemctl daemon-reload
systemctl enable --now oktagon
systemctl restart oktagon
systemctl enable caddy
systemctl restart caddy

sleep 4
echo
echo "==> Tekshiruv"
systemctl --no-pager --lines=5 status oktagon || true
echo
curl -fsS "http://127.0.0.1:3000/health" && echo || echo "Server javob bermadi: journalctl -u oktagon -n 50"
echo
echo "Tayyor. Brauzerda oching: https://$DOMAIN/health"
echo "Keyin Telegramda botingizga /start yozing."
echo "Loglar: journalctl -u oktagon -f"
