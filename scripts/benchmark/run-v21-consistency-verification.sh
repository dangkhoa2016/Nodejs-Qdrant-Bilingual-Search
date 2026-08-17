#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
mkdir -p reports
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${CONSISTENCY_OUTPUT:-reports/v21-consistency-verification.json}"
LOG="${CONSISTENCY_LOG:-reports/v21-consistency-verification-${STAMP}.log}"
SHA_FILE="${CONSISTENCY_SHA256:-reports/v21-consistency-verification-${STAMP}.sha256}"
EVIDENCE_ZIP="${CONSISTENCY_EVIDENCE_ZIP:-reports/v21-consistency-verification-${STAMP}.zip}"
set +e
(
  set -euo pipefail
  echo '[v21-consistency] canonical config'; npm run verify:canonical-config
  echo '[v21-consistency] semantic provenance'; npm run verify:semantic-index -- 20000
  echo '[v21-consistency] qdrant status'; npm run seed:status -- --once --expected 20000
  echo '[v21-consistency] 200-query public API experiment'; CONSISTENCY_OUTPUT="$REPORT" npm run benchmark:v21-consistency-verification:run
) 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
set -e
if [[ "$RC" -ne 0 ]]; then echo 'V21_CONSISTENCY_VERIFICATION=FAILED'; echo "LOG=$LOG"; exit "$RC"; fi
sha256sum "$REPORT" "$LOG" > "$SHA_FILE"
rm -f "$EVIDENCE_ZIP"; zip -q -j "$EVIDENCE_ZIP" "$REPORT" "$LOG" "$SHA_FILE"
echo 'V21_CONSISTENCY_VERIFICATION=COMPLETE'
echo "REPORT=$REPORT"; echo "LOG=$LOG"; echo "SHA256=$SHA_FILE"; echo "EVIDENCE_ZIP=$EVIDENCE_ZIP"
