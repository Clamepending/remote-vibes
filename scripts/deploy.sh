#!/usr/bin/env bash
# Push the current commit to origin/main, then ask a deployed Vibe Research
# instance to pull and restart. Polls the instance until it reports the new
# commit so the script doubles as a smoke test.

set -euo pipefail

DEPLOY_URL="${VIBE_RESEARCH_DEPLOY_URL:-https://cthulhu1.tail8dd042.ts.net}"
POLL_INTERVAL_SECONDS=3
POLL_MAX_SECONDS=180

usage() {
  cat <<USAGE
Usage: scripts/deploy.sh [--no-push]

Pushes HEAD to origin/main, triggers \$VIBE_RESEARCH_DEPLOY_URL to update,
and waits until the deployment reports the new commit.

Environment:
  VIBE_RESEARCH_DEPLOY_URL  Deployment base URL (default: $DEPLOY_URL)
USAGE
}

PUSH=1
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --no-push) PUSH=0 ;;
    *) echo "unknown argument: $arg" >&2; usage >&2; exit 64 ;;
  esac
done

LOCAL_COMMIT="$(git rev-parse HEAD)"
LOCAL_SHORT="${LOCAL_COMMIT:0:7}"

if [ "$PUSH" -eq 1 ]; then
  echo "[deploy] pushing $LOCAL_SHORT to origin/main"
  git push origin "HEAD:main"
fi

echo "[deploy] asking $DEPLOY_URL to apply update"
APPLY_RESPONSE="$(curl -fsS -X POST --max-time 30 "$DEPLOY_URL/api/update/apply")"
if ! printf '%s' "$APPLY_RESPONSE" | grep -q '"ok":true'; then
  echo "[deploy] update apply did not report ok:" >&2
  printf '%s\n' "$APPLY_RESPONSE" >&2
  exit 1
fi

echo "[deploy] waiting for $LOCAL_SHORT to become current (timeout ${POLL_MAX_SECONDS}s)"
DEADLINE=$(( $(date +%s) + POLL_MAX_SECONDS ))
while :; do
  STATUS_JSON="$(curl -fsS --max-time 10 "$DEPLOY_URL/api/update/status?force=1" || true)"
  CURRENT="$(printf '%s' "$STATUS_JSON" | sed -n 's/.*"currentCommit":"\([0-9a-f]*\)".*/\1/p')"
  if [ "$CURRENT" = "$LOCAL_COMMIT" ]; then
    echo "[deploy] live: $LOCAL_SHORT"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "[deploy] timed out waiting for $LOCAL_SHORT (last seen ${CURRENT:0:7})" >&2
    exit 1
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done
