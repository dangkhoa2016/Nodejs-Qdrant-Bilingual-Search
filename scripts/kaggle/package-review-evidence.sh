#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 REVIEW_DIR OUTPUT_ZIP" >&2
  exit 64
fi

REVIEW_DIR="$(realpath "$1")"
OUTPUT_ZIP="$2"
[[ -d "$REVIEW_DIR" ]] || { echo "ERROR: review directory not found: $REVIEW_DIR" >&2; exit 66; }
case "$OUTPUT_ZIP" in
  /*) ;;
  *) OUTPUT_ZIP="$(pwd)/$OUTPUT_ZIP" ;;
esac
mkdir -p "$(dirname "$OUTPUT_ZIP")"
OUTPUT_ZIP="$(realpath -m "$OUTPUT_ZIP")"

case "$OUTPUT_ZIP" in
  "$REVIEW_DIR"/*)
    echo "ERROR: output ZIP must be outside REVIEW_DIR" >&2
    exit 64
    ;;
esac

for cmd in find sort sha256sum zip unzip mktemp realpath; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: required command missing: $cmd" >&2; exit 69; }
done

rm -f "$REVIEW_DIR/SHA256SUMS.txt"
(
  cd "$REVIEW_DIR"
  find . -type f -print | LC_ALL=C sort > FILES.txt
  find . -type f ! -name 'SHA256SUMS.txt' -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum > SHA256SUMS.txt
  sha256sum -c SHA256SUMS.txt
)

rm -f "$OUTPUT_ZIP" "${OUTPUT_ZIP}.sha256" "${OUTPUT_ZIP}.verify.log" "${OUTPUT_ZIP}.internal-verify.log"
REVIEW_PARENT="$(dirname "$REVIEW_DIR")"
REVIEW_NAME="$(basename "$REVIEW_DIR")"
(
  cd "$REVIEW_PARENT"
  zip -qr "$OUTPUT_ZIP" "$REVIEW_NAME"
)
sha256sum "$OUTPUT_ZIP" > "${OUTPUT_ZIP}.sha256"
unzip -t "$OUTPUT_ZIP" > "${OUTPUT_ZIP}.verify.log"

VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/review-verify.XXXXXX")"
trap 'rm -rf "$VERIFY_ROOT"' EXIT
unzip -q "$OUTPUT_ZIP" -d "$VERIFY_ROOT"
(
  cd "$VERIFY_ROOT/$REVIEW_NAME"
  sha256sum -c SHA256SUMS.txt
) > "${OUTPUT_ZIP}.internal-verify.log"

echo "EVIDENCE_ZIP=$OUTPUT_ZIP"
echo "EVIDENCE_SHA256_FILE=${OUTPUT_ZIP}.sha256"
echo "EVIDENCE_ZIP_VERIFY_LOG=${OUTPUT_ZIP}.verify.log"
echo "EVIDENCE_INTERNAL_VERIFY_LOG=${OUTPUT_ZIP}.internal-verify.log"
