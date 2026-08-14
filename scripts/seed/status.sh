#!/usr/bin/env bash
set -euo pipefail

EXPECTED=20000
INTERVAL=5
WATCH=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --once) WATCH=0; shift ;;
    --watch) WATCH=1; shift ;;
    --expected) EXPECTED="${2:?--expected requires a value}"; shift 2 ;;
    --interval) INTERVAL="${2:?--interval requires seconds}"; shift 2 ;;
    -h|--help)
      cat <<'USAGE'
Usage: npm run seed:status -- [--once|--watch] [--expected 20000] [--interval 5]

Reads QDRANT_PROVIDER/QDRANT_*_URL/QDRANT_*_API_KEY/QDRANT_URL/QDRANT_API_KEY
and always sends the Qdrant API key as the `api-key` HTTP request header when set.
USAGE
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v curl >/dev/null || { echo 'curl is required' >&2; exit 1; }
command -v jq >/dev/null || { echo 'jq is required' >&2; exit 1; }

provider="${QDRANT_PROVIDER:-local}"
upper="$(printf '%s' "$provider" | tr '[:lower:]' '[:upper:]')"
url_var="QDRANT_${upper}_URL"
key_var="QDRANT_${upper}_API_KEY"
provider_url="${!url_var:-}"
provider_key="${!key_var:-}"
qdrant_url="${provider_url:-${QDRANT_URL:-}}"
qdrant_api_key="${provider_key:-${QDRANT_API_KEY:-}}"
collection="${QDRANT_COLLECTION:-knowledge_entities_qwen3_4b_text_v21}"

if [[ -z "$qdrant_url" && "$provider" == "local" ]]; then
  qdrant_url='http://127.0.0.1:6333'
fi
if [[ -z "$qdrant_url" ]]; then
  echo "Qdrant URL is required for provider '$provider'" >&2
  exit 1
fi
if [[ "$provider" != "local" && -z "$qdrant_api_key" ]]; then
  echo "Qdrant API key is required for provider '$provider'" >&2
  exit 1
fi
qdrant_url="${qdrant_url%/}"

curl_args=(-fsS)
if [[ -n "$qdrant_api_key" ]]; then
  curl_args+=(-H "api-key: $qdrant_api_key")
fi

show_status() {
  local body points indexed status percent
  body="$(curl "${curl_args[@]}" "$qdrant_url/collections/$collection")"
  points="$(jq -r '.result.points_count // 0' <<<"$body")"
  indexed="$(jq -r '.result.indexed_vectors_count // 0' <<<"$body")"
  status="$(jq -r '.result.status // "unknown"' <<<"$body")"
  percent="$(awk -v n="$points" -v total="$EXPECTED" 'BEGIN { if (total > 0) printf "%.2f", n/total*100; else printf "0.00" }')"
  printf '[qdrant] %s | %s / %s (%s%%) | indexed=%s | status=%s | collection=%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$points" "$EXPECTED" "$percent" "$indexed" "$status" "$collection"
}

if [[ "$WATCH" -eq 0 ]]; then
  show_status
  exit 0
fi

while true; do
  show_status
  sleep "$INTERVAL"
done
