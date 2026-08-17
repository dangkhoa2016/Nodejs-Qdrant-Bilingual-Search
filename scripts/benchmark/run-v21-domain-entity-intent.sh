#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
mkdir -p reports
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${DOMAIN_ENTITY_INTENT_OUTPUT:-reports/v21-domain-entity-intent-experiment.json}"
LOG="${DOMAIN_ENTITY_INTENT_LOG:-reports/v21-domain-entity-intent-experiment-${STAMP}.log}"
SHA_FILE="${DOMAIN_ENTITY_INTENT_SHA256:-reports/v21-domain-entity-intent-experiment-${STAMP}.sha256}"
EVIDENCE_ZIP="${DOMAIN_ENTITY_INTENT_EVIDENCE_ZIP:-reports/v21-domain-entity-intent-experiment-${STAMP}.zip}"
set +e
(
  set -euo pipefail
  echo '[v21-domain-entity-intent] canonical config'; npm run verify:canonical-config
  echo '[v21-domain-entity-intent] semantic provenance'; npm run verify:semantic-index -- 20000
  echo '[v21-domain-entity-intent] qdrant status'; npm run seed:status -- --once --expected 20000
  echo '[v21-domain-entity-intent] 200-query live public API experiment'; DOMAIN_ENTITY_INTENT_OUTPUT="$REPORT" npm run benchmark:v21-domain-entity-intent:run
) 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
set -e
if [[ "$RC" -ne 0 ]]; then
  echo 'V21_DOMAIN_ENTITY_INTENT_EXPERIMENT=FAILED'
  echo "LOG=$LOG"
  exit "$RC"
fi
sha256sum "$REPORT" "$LOG" > "$SHA_FILE"
rm -f "$EVIDENCE_ZIP"
zip -q -j "$EVIDENCE_ZIP" "$REPORT" "$LOG" "$SHA_FILE"
echo 'V21_DOMAIN_ENTITY_INTENT_EXPERIMENT=PASS'
echo "REPORT=$REPORT"
echo "LOG=$LOG"
echo "SHA256=$SHA_FILE"
echo "EVIDENCE_ZIP=$EVIDENCE_ZIP"
