#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
mkdir -p reports
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${PRODUCTION_DOMAIN_ENTITY_INTENT_OUTPUT:-reports/v21-production-domain-entity-intent-acceptance.json}"
LOG="${PRODUCTION_DOMAIN_ENTITY_INTENT_LOG:-reports/v21-production-domain-entity-intent-acceptance-${STAMP}.log}"
SHA_FILE="${PRODUCTION_DOMAIN_ENTITY_INTENT_SHA256:-reports/v21-production-domain-entity-intent-acceptance-${STAMP}.sha256}"
EVIDENCE_ZIP="${PRODUCTION_DOMAIN_ENTITY_INTENT_EVIDENCE_ZIP:-reports/v21-production-domain-entity-intent-acceptance-${STAMP}.zip}"
set +e
(
  set -euo pipefail
  echo '[v21-production-domain-entity-intent] canonical config'; npm run verify:canonical-config
  echo '[v21-production-domain-entity-intent] semantic provenance'; npm run verify:semantic-index -- 20000
  echo '[v21-production-domain-entity-intent] qdrant status'; npm run seed:status -- --once --expected 20000
  echo '[v21-production-domain-entity-intent] 200-query live production API acceptance'; PRODUCTION_DOMAIN_ENTITY_INTENT_OUTPUT="$REPORT" npm run acceptance:v21-production-domain-entity-intent:run
) 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
set -e
if [[ "$RC" -ne 0 ]]; then
  echo 'V21_PRODUCTION_DOMAIN_ENTITY_INTENT_ACCEPTANCE=FAILED'
  echo "LOG=$LOG"
  exit "$RC"
fi
sha256sum "$REPORT" "$LOG" > "$SHA_FILE"
rm -f "$EVIDENCE_ZIP"
zip -q -j "$EVIDENCE_ZIP" "$REPORT" "$LOG" "$SHA_FILE"
echo 'V21_PRODUCTION_DOMAIN_ENTITY_INTENT_ACCEPTANCE=PASS'
echo "REPORT=$REPORT"
echo "LOG=$LOG"
echo "SHA256=$SHA_FILE"
echo "EVIDENCE_ZIP=$EVIDENCE_ZIP"
