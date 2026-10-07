#!/usr/bin/env bash
# One-time setup of the server side of .github/workflows/deploy-server.yml.
# Run as root on the server, from a checkout of this repo:
#
#   sudo bash deploy/install-server.sh "ssh-ed25519 AAAA... wallet-deploy"
#
# It creates the deploy user (no password, no shell use beyond the forced
# command), installs receive-wallet-web.sh, pins the given public key to it,
# seeds the release directory from the build nginx serves today and points nginx
# at $ROOT/current/. Idempotent.
set -euo pipefail

PUBKEY=${1:?usage: install-server.sh "<ssh public key>"}
DEPLOY_USER=${DEPLOY_USER:-walletdeploy}
ROOT=${WALLET_WEB_ROOT:-/var/www/cosmos-wallet-releases}
OLD=${OLD_WEB_DIR:-/var/www/cosmos-wallet}
NGINX_SITE=${NGINX_SITE:-/etc/nginx/sites-enabled/base.conf}
HERE=$(cd "$(dirname "$0")" && pwd)

[[ "$PUBKEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+ ]] || { echo "expected an ssh-ed25519 public key" >&2; exit 2; }

id "$DEPLOY_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
passwd -l "$DEPLOY_USER" >/dev/null

install -m 755 "$HERE/receive-wallet-web.sh" /usr/local/bin/receive-wallet-web.sh

install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
printf 'restrict,command="/usr/local/bin/receive-wallet-web.sh" %s\n' "$PUBKEY" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ROOT"
if [ ! -e "$ROOT/current" ] && [ -d "$OLD" ]; then
  cp -a "$OLD" "$ROOT/manual-$(date +%Y%m%d)"
  ln -sfn "$ROOT/manual-$(date +%Y%m%d)" "$ROOT/current"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ROOT"

if grep -q "alias $OLD/" "$NGINX_SITE"; then
  cp "$NGINX_SITE" "$NGINX_SITE.bak-$(date +%Y%m%d%H%M%S)"
  sed -i "s#alias $OLD/assets/;#alias $ROOT/current/assets/;#; s#alias $OLD/;#alias $ROOT/current/;#" "$NGINX_SITE"
  nginx -t && systemctl reload nginx
fi

echo "ready: $DEPLOY_USER@$(hostname) -> $ROOT/current (nginx: $NGINX_SITE)"
