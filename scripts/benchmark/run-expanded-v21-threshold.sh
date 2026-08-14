#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

mkdir -p reports
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
API_REPORT="${EXPANDED_NOANSWER_OUTPUT:-reports/expanded-noanswer-v21-api.json}"
CAL_REPORT="${EXPANDED_THRESHOLD_OUTPUT:-reports/expanded-v21-threshold-calibration.json}"
LOG="${EXPANDED_THRESHOLD_LOG:-reports/expanded-v21-threshold-${STAMP}.log}"
SHA_FILE="${EXPANDED_THRESHOLD_SHA256:-reports/expanded-v21-threshold-${STAMP}.sha256}"
EVIDENCE_ZIP="${EXPANDED_THRESHOLD_EVIDENCE_ZIP:-reports/expanded-v21-threshold-${STAMP}.zip}"

set +e
(
  set -euo pipefail
  echo "[expanded-v21-threshold] canonical config"
  npm run verify:canonical-config
  echo "[expanded-v21-threshold] semantic provenance"
  npm run verify:semantic-index -- 20000
  echo "[expanded-v21-threshold] qdrant index status"
  npm run seed:status -- --once --expected 20000
  echo "[expanded-v21-threshold] collect 200 public API cases"
  EXPANDED_NOANSWER_OUTPUT="$API_REPORT" npm run benchmark:expanded-v21-noanswer-api
  echo "[expanded-v21-threshold] offline calibration"
  EXPANDED_THRESHOLD_INPUT="$API_REPORT" EXPANDED_THRESHOLD_OUTPUT="$CAL_REPORT" npm run benchmark:calibrate-expanded-v21-threshold
) 2>&1 | tee "$LOG"
RUN_RC=${PIPESTATUS[0]}
set -e

if [[ "$RUN_RC" -ne 0 ]]; then
  echo "EXPANDED_V21_THRESHOLD_BENCHMARK=FAILED"
  echo "LOG=$LOG"
  exit "$RUN_RC"
fi

sha256sum "$API_REPORT" "$CAL_REPORT" "$LOG" > "$SHA_FILE"
rm -f "$EVIDENCE_ZIP"
zip -q -j "$EVIDENCE_ZIP" "$API_REPORT" "$CAL_REPORT" "$LOG" "$SHA_FILE"

echo "EXPANDED_V21_THRESHOLD_BENCHMARK=COMPLETE"
echo "API_REPORT=$API_REPORT"
echo "CALIBRATION_REPORT=$CAL_REPORT"
echo "LOG=$LOG"
echo "SHA256=$SHA_FILE"
echo "EVIDENCE_ZIP=$EVIDENCE_ZIP"
