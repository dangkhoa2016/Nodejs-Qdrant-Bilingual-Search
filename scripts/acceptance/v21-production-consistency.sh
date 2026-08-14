#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
mkdir -p reports
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${PRODUCTION_CONSISTENCY_OUTPUT:-reports/v21-production-consistency-acceptance.json}"
LOG="${PRODUCTION_CONSISTENCY_LOG:-reports/v21-production-consistency-acceptance-${STAMP}.log}"
SHA_FILE="${PRODUCTION_CONSISTENCY_SHA256:-reports/v21-production-consistency-acceptance-${STAMP}.sha256}"
EVIDENCE_ZIP="${PRODUCTION_CONSISTENCY_EVIDENCE_ZIP:-reports/v21-production-consistency-acceptance-${STAMP}.zip}"
set +e
(
  set -euo pipefail
  echo '[v21-production-consistency] canonical config'; npm run verify:canonical-config
  echo '[v21-production-consistency] semantic provenance'; npm run verify:semantic-index -- 20000
  echo '[v21-production-consistency] qdrant status'; npm run seed:status -- --once --expected 20000
  echo '[v21-production-consistency] 200-query live API acceptance'; PRODUCTION_CONSISTENCY_OUTPUT="$REPORT" npm run acceptance:v21-production-consistency:run
) 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
set -e
if [[ "$RC" -ne 0 ]]; then
  echo 'V21_PRODUCTION_CONSISTENCY_ACCEPTANCE=FAILED'
  echo "LOG=$LOG"
  exit "$RC"
fi
sha256sum "$REPORT" "$LOG" > "$SHA_FILE"
rm -f "$EVIDENCE_ZIP"
zip -q -j "$EVIDENCE_ZIP" "$REPORT" "$LOG" "$SHA_FILE"
echo 'V21_PRODUCTION_CONSISTENCY_ACCEPTANCE=PASS'
echo "REPORT=$REPORT"
echo "LOG=$LOG"
echo "SHA256=$SHA_FILE"
echo "EVIDENCE_ZIP=$EVIDENCE_ZIP"
