#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/demo/lifecycle.sh"

command="${1:-start}"
case "$command" in
  start|stop|restart|status)
    "demo_${command}"
    ;;
  -h|--help|help)
    cat <<USAGE
Usage: ./run.sh [start|stop|restart|status]

Environment:
  DEMO_PUBLIC=1|0              Start optional Cloudflare tunnel (default: 1)
  DEMO_INSTALL_DEPS=1|0        Install missing Node/Python dependencies (default: 1)
  DEMO_DOWNLOAD_QDRANT=1|0     Download Qdrant when no local binary exists (default: 1)
  DEMO_RUNTIME_DIR=PATH         Runtime PID/URL state directory
  DEMO_LOG_DIR=PATH             Service log directory
USAGE
    ;;
  *)
    echo "ERROR: unknown command: $command" >&2
    echo "Usage: ./run.sh [start|stop|restart|status]" >&2
    exit 64
    ;;
esac
