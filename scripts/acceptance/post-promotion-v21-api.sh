#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

REPORT="${POST_PROMOTION_OUTPUT:-reports/post-promotion-v21-api-acceptance.json}"
LOG="${POST_PROMOTION_LOG:-reports/post-promotion-v21-api-acceptance.log}"
STAMP="${POST_PROMOTION_STAMP:-$(date -u '+%Y%m%dT%H%M%SZ')}"
EVIDENCE_ZIP="${POST_PROMOTION_EVIDENCE_ZIP:-reports/post-promotion-v21-api-acceptance-${STAMP}.zip}"
SHA_FILE="${POST_PROMOTION_SHA256:-reports/post-promotion-v21-api-acceptance.sha256}"
mkdir -p "$(dirname "$REPORT")" "$(dirname "$LOG")" "$(dirname "$EVIDENCE_ZIP")"

set +e
{
  echo '============================================================'
  echo ' POST-PROMOTION V2.1 PUBLIC NODE API SEMANTIC ACCEPTANCE'
  echo '============================================================'
  printf 'timestamp_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'api_url=%s\n' "${API_URL:-http://127.0.0.1:3000}"
  echo
  echo '--- canonical config ---'
  npm run verify:canonical-config
  echo
  echo '--- semantic index provenance ---'
  npm run verify:semantic-index -- 20000
  echo
  echo '--- qdrant green/indexed status ---'
  npm run seed:status -- --once --expected 20000
  echo
  echo '--- public API semantic acceptance via POST /api/v1/search ---'
  POST_PROMOTION_OUTPUT="$REPORT" node scripts/benchmark/post-promotion-v21-api-acceptance.mjs
} 2>&1 | tee "$LOG"
run_status=${PIPESTATUS[0]}
set -e

if [[ "$run_status" -ne 0 ]]; then
  echo "POST_PROMOTION_V21_API_ACCEPTANCE=FAIL"
  echo "LOG=$LOG"
  [[ -f "$REPORT" ]] && echo "REPORT=$REPORT"
  exit "$run_status"
fi

command -v sha256sum >/dev/null || { echo 'sha256sum is required to package evidence' >&2; exit 1; }
command -v zip >/dev/null || { echo 'zip is required to package evidence' >&2; exit 1; }
sha256sum "$REPORT" "$LOG" > "$SHA_FILE"
rm -f "$EVIDENCE_ZIP"
zip -q -j "$EVIDENCE_ZIP" "$REPORT" "$LOG" "$SHA_FILE"

printf 'POST_PROMOTION_V21_API_ACCEPTANCE=PASS\n'
printf 'REPORT=%s\n' "$REPORT"
printf 'LOG=%s\n' "$LOG"
printf 'SHA256=%s\n' "$SHA_FILE"
printf 'EVIDENCE_ZIP=%s\n' "$EVIDENCE_ZIP"
sha256sum "$EVIDENCE_ZIP"
