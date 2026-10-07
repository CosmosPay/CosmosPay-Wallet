#!/usr/bin/env bash
# One-time setup on the server that serves https://cosmospay.lat/wallet/.
# Run as root from a checkout of this repo:
#
#   sudo bash deploy/install-server.sh
#
# Installs update-wallet-web.sh and its systemd timer (checks GitHub for a new
# release every 5 minutes, as an unprivileged `walletweb` user), seeds the
# release directory with the build nginx serves today, points nginx at
# $ROOT/current/ and runs the first update. Idempotent.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
STATE=/opt/cosmos-wallet-web
ROOT=/var/www/cosmos-wallet-releases
OLD=${OLD_WEB_DIR:-/var/www/cosmos-wallet}
NGINX_SITE=${NGINX_SITE:-/etc/nginx/sites-enabled/base.conf}
GATEWAY=${PUBLIC_COSMOS_GATEWAY_URL:-https://api.cosmospay.lat}

id walletweb >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin walletweb
install -d -m 755 -o walletweb -g walletweb "$STATE" "$ROOT"

install -m 755 "$HERE/update-wallet-web.sh" /usr/local/bin/update-wallet-web.sh
install -m 644 "$HERE/cosmos-wallet-web.service" "$HERE/cosmos-wallet-web.timer" /etc/systemd/system/

# Build-time settings (the same as the Pages workflow's repository variables).
if [ ! -f /etc/cosmos-wallet-web.env ]; then
  cat > /etc/cosmos-wallet-web.env <<ENV
# Read by cosmos-wallet-web.service at build time. Public values only: every
# PUBLIC_* ends up in the browser bundle.
PUBLIC_COSMOS_GATEWAY_URL=$GATEWAY
#PUBLIC_COSMOS_GATEWAY_ENTRY=
#PUBLIC_COSMOS_RECOVERY_A_URL=
#PUBLIC_COSMOS_RECOVERY_B_URL=
ENV
  chmod 644 /etc/cosmos-wallet-web.env
fi

# Seed: the build nginx serves today becomes the first release, so nothing
# changes for visitors until a real release replaces it.
if [ ! -e "$ROOT/current" ] && [ -d "$OLD" ]; then
  cp -a "$OLD" "$ROOT/manual-$(date +%Y%m%d)"
  ln -sfn "$ROOT/manual-$(date +%Y%m%d)" "$ROOT/current"
fi
chown -R walletweb:walletweb "$ROOT"

if grep -q "alias $OLD/" "$NGINX_SITE"; then
  cp "$NGINX_SITE" "/root/$(basename "$NGINX_SITE").bak-$(date +%Y%m%d%H%M%S)"
  sed -i "s#alias $OLD/assets/;#alias $ROOT/current/assets/;#; s#alias $OLD/;#alias $ROOT/current/;#" "$NGINX_SITE"
  nginx -t && systemctl reload nginx
fi

systemctl daemon-reload
systemctl enable --now cosmos-wallet-web.timer
echo "first update (npm ci + build, a minute or two)…"
systemctl start cosmos-wallet-web.service || true
journalctl -u cosmos-wallet-web --no-pager -n 5 -o cat
echo "live: $(readlink "$ROOT/current")"
