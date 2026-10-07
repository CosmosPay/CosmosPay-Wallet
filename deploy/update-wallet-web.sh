#!/usr/bin/env bash
# Keeps https://cosmospay.lat/wallet/ on the latest RELEASE of this repo.
#
# Pull, never push: the server asks GitHub (public repo, read-only, no credentials)
# whether a newer vX.Y.Z tag exists, and only then builds and publishes it. Nothing
# outside can connect in. Run every few minutes by cosmos-wallet-web.timer; a run
# with nothing new is one `git ls-remote` and exits.
#
# Release tags, not main: a tag exists only once the release workflow passed its
# tests, so a broken commit on main never reaches the site.
#
# Layout: $ROOT/<tag>/ per build, $ROOT/current -> the live one (nginx serves
# /wallet/ from $ROOT/current/). Publishing is one atomic symlink swap; a smoke
# test through nginx swaps back if the page or its script does not load.
#
# Usage: update-wallet-web.sh            deploy the latest release if newer
#        update-wallet-web.sh --force    rebuild and republish it anyway
#        update-wallet-web.sh v1.13.1    publish that tag (manual pin / rollback)
set -euo pipefail

REPO_URL=${WALLET_REPO_URL:-https://github.com/CosmosPay/CosmosPay-Wallet.git}
STATE=${WALLET_WEB_STATE:-/opt/cosmos-wallet-web}
ROOT=${WALLET_WEB_ROOT:-/var/www/cosmos-wallet-releases}
SITE=${WALLET_WEB_SITE:-cosmospay.lat}
KEEP=${WALLET_WEB_KEEP:-4}
SRC="$STATE/src"

# Build-time settings, same names as the Pages workflow. A web build without a
# gateway calls the API on its own origin (cosmospay.lat/cosmos-api → 404).
: "${PUBLIC_COSMOS_GATEWAY_URL:?set it in /etc/cosmos-wallet-web.env}"

exec 9>"$STATE/.lock"
flock -n 9 || exit 0

latest_tag() {
  git ls-remote --tags --refs "$REPO_URL" 'v*' \
    | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
}

case "${1:-}" in
  --force|"") TAG=$(latest_tag) ;;
  v*) TAG=$1 ;;
  *) echo "usage: $0 [--force | vX.Y.Z]" >&2; exit 2 ;;
esac
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "no release tag found" >&2; exit 1; }

LIVE=$(readlink "$ROOT/current" 2>/dev/null || true)
if [ "${LIVE##*/}" = "$TAG" ] && [ -z "${1:-}" ]; then exit 0; fi

echo "deploying $TAG (live: ${LIVE##*/})"
[ -d "$SRC/.git" ] || git clone -q "$REPO_URL" "$SRC"
git -C "$SRC" fetch -q --force --tags origin
git -C "$SRC" checkout -q --force --detach "refs/tags/$TAG"
git -C "$SRC" clean -qfdx -e node_modules

cd "$SRC"
npm ci --no-audit --no-fund --loglevel=error
rm -rf dist
PAGES_BASE=/wallet/ COSMOS_ICONS=release npm run build --silent >/dev/null

grep -q '/wallet/assets/' dist/web/index.html || { echo "build is not under /wallet/, not publishing" >&2; exit 1; }
[ -f dist/web/cosmos-wallet.js ] || { echo "cosmos-wallet.js missing, not publishing" >&2; exit 1; }

NEW="$ROOT/$TAG"
rm -rf "$NEW.tmp" && cp -a dist/web "$NEW.tmp" && chmod -R a+rX "$NEW.tmp"
rm -rf "$NEW" && mv "$NEW.tmp" "$NEW"
ln -sfn "$NEW" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"

smoke() {
  local js
  js=$(curl -fsk --max-time 10 --resolve "$SITE:443:127.0.0.1" "https://$SITE/wallet/" | grep -oE '/wallet/assets/[^"]+\.js' | head -1) || return 1
  [ -n "$js" ] && curl -fsk --max-time 10 -o /dev/null --resolve "$SITE:443:127.0.0.1" "https://$SITE$js"
}
if ! smoke; then
  echo "smoke test failed, back to ${LIVE##*/}" >&2
  [ -n "$LIVE" ] && ln -sfn "$LIVE" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
  exit 1
fi

# Keep the newest $KEEP builds, never the live one.
NOW=$(readlink "$ROOT/current")
ls -1dt "$ROOT"/v*/ "$ROOT"/manual-*/ 2>/dev/null | sed 's#/$##' | grep -vxF "$NOW" \
  | tail -n +"$KEEP" | xargs -r rm -rf

echo "live: $TAG"
