#!/usr/bin/env bash
# The receiving end of .github/workflows/deploy-server.yml.
#
# Installed as /usr/local/bin/receive-wallet-web.sh and pinned as the ONLY command
# of the deploy user's key in ~/.ssh/authorized_keys:
#
#   restrict,command="/usr/local/bin/receive-wallet-web.sh" ssh-ed25519 AAAA... wallet-deploy
#
# so whatever the client asks to run arrives here as $SSH_ORIGINAL_COMMAND. Only a
# release name (12 hex chars, the commit) is accepted from it; the build itself is
# a tarball on stdin.
#
# Layout: $ROOT/<release>/ per build, $ROOT/current -> the live one. nginx serves
# https://cosmospay.lat/wallet/ from $ROOT/current/, so publishing is one atomic
# symlink swap, and a smoke test through nginx rolls it back if the page or its
# script does not load. The newest $KEEP releases are kept for a manual rollback:
#   ln -sfn $ROOT/<release> $ROOT/current.tmp && mv -T $ROOT/current.tmp $ROOT/current
set -euo pipefail

ROOT=${WALLET_WEB_ROOT:-/var/www/cosmos-wallet-releases}
SITE=${WALLET_WEB_SITE:-cosmospay.lat}
KEEP=${WALLET_WEB_KEEP:-4}
MAX_BYTES=$((200 * 1024 * 1024))

REL=${SSH_ORIGINAL_COMMAND:-${1:-}}
[[ "$REL" =~ ^[0-9a-f]{12}$ ]] || { echo "refused: expected a 12-char commit, got '${REL:0:40}'" >&2; exit 2; }

exec 9>"$ROOT/.lock"
flock -w 600 9 || { echo "another deploy holds the lock" >&2; exit 1; }

TMP=$(mktemp -d "$ROOT/.incoming.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
head -c "$MAX_BYTES" | tar -xzf - -C "$TMP" --no-same-owner --no-same-permissions
chmod -R a+rX "$TMP"

grep -q '/wallet/assets/' "$TMP/index.html" || { echo "refused: build is not under /wallet/" >&2; exit 1; }
[ -f "$TMP/cosmos-wallet.js" ] || { echo "refused: cosmos-wallet.js missing" >&2; exit 1; }

PREV=$(readlink "$ROOT/current" 2>/dev/null || true)
rm -rf "${ROOT:?}/$REL"
mv "$TMP" "$ROOT/$REL"
trap - EXIT
ln -sfn "$ROOT/$REL" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"

smoke() {
  local js
  js=$(curl -fsk --max-time 10 --resolve "$SITE:443:127.0.0.1" "https://$SITE/wallet/" | grep -oE '/wallet/assets/[^"]+\.js' | head -1) || return 1
  [ -n "$js" ] && curl -fsk --max-time 10 -o /dev/null --resolve "$SITE:443:127.0.0.1" "https://$SITE$js"
}
if ! smoke; then
  echo "smoke test failed, rolling back to ${PREV:-nothing}" >&2
  [ -n "$PREV" ] && ln -sfn "$PREV" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
  exit 1
fi

# Prune old releases, never the live one.
LIVE=$(readlink "$ROOT/current")
ls -1dt "$ROOT"/[0-9a-f]*/ "$ROOT"/manual-*/ 2>/dev/null | sed 's#/$##' | grep -vxF "$LIVE" | tail -n +"$KEEP" | xargs -r rm -rf

echo "live: $REL (was ${PREV##*/})"
