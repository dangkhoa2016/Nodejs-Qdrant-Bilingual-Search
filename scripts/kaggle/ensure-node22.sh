#!/usr/bin/env bash
# Source this file before invoking repository JavaScript on Kaggle.
# It preserves a compatible Node already on PATH and otherwise installs a
# verified portable Node 22 runtime under /kaggle/working.

KAGGLE_NODE_MIN_MAJOR="${KAGGLE_NODE_MIN_MAJOR:-22}"
KAGGLE_NODE_VERSION="${KAGGLE_NODE_VERSION:-22.23.2}"
KAGGLE_NODE_ROOT="${KAGGLE_NODE_ROOT:-/kaggle/working/node-v${KAGGLE_NODE_VERSION}}"
KAGGLE_NODE_DIST_BASE="${KAGGLE_NODE_DIST_BASE:-https://nodejs.org/dist}"
KAGGLE_NODE_BOOTSTRAP_DOWNLOAD="${KAGGLE_NODE_BOOTSTRAP_DOWNLOAD:-1}"

_node_major() {
  local bin="$1" version
  version="$($bin --version 2>/dev/null || true)"
  [[ "$version" =~ ^v([0-9]+)\. ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

_node_compatible() {
  local bin="$1" major
  [[ -x "$bin" ]] || return 1
  major="$(_node_major "$bin")" || return 1
  [[ "$major" -ge "$KAGGLE_NODE_MIN_MAJOR" ]]
}

_emit_node_runtime() {
  local source="$1" bin version
  bin="$(command -v node)"
  version="$(node --version)"
  export NODE_SOURCE="$source"
  export NODE_VERSION="$version"
  export NODE_BINARY="$bin"
  printf 'NODE_SOURCE=%s\n' "$source"
  printf 'NODE_VERSION=%s\n' "$version"
  printf 'NODE_BINARY=%s\n' "$bin"
}

ensure_node22() {
  local current cached archive_name archive_url shasums_url tmp extracted

  current="$(command -v node 2>/dev/null || true)"
  if [[ -n "$current" ]] && _node_compatible "$current"; then
    _emit_node_runtime system
    return 0
  fi

  cached="$KAGGLE_NODE_ROOT/bin/node"
  if _node_compatible "$cached"; then
    export PATH="$KAGGLE_NODE_ROOT/bin:$PATH"
    _emit_node_runtime cached
    return 0
  fi

  if [[ "$KAGGLE_NODE_BOOTSTRAP_DOWNLOAD" != "1" ]]; then
    printf 'ERROR: Node >=%s is required; no compatible runtime found and KAGGLE_NODE_BOOTSTRAP_DOWNLOAD=%s\n' \
      "$KAGGLE_NODE_MIN_MAJOR" "$KAGGLE_NODE_BOOTSTRAP_DOWNLOAD" >&2
    return 69
  fi

  if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
    printf 'ERROR: automatic Node bootstrap currently supports Linux x86_64 only\n' >&2
    return 69
  fi
  command -v curl >/dev/null 2>&1 || { echo 'ERROR: curl is required to bootstrap Node' >&2; return 69; }
  command -v tar >/dev/null 2>&1 || { echo 'ERROR: tar is required to bootstrap Node' >&2; return 69; }
  command -v sha256sum >/dev/null 2>&1 || { echo 'ERROR: sha256sum is required to verify Node' >&2; return 69; }

  archive_name="node-v${KAGGLE_NODE_VERSION}-linux-x64.tar.xz"
  archive_url="${KAGGLE_NODE_DIST_BASE}/v${KAGGLE_NODE_VERSION}/${archive_name}"
  shasums_url="${KAGGLE_NODE_DIST_BASE}/v${KAGGLE_NODE_VERSION}/SHASUMS256.txt"

  (
    set -euo pipefail
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/node22-bootstrap.XXXXXX")"
    trap 'rm -rf "$tmp"' EXIT

    curl -fL --retry 3 --connect-timeout 15 -o "$tmp/$archive_name" "$archive_url"
    curl -fL --retry 3 --connect-timeout 15 -o "$tmp/SHASUMS256.txt" "$shasums_url"
    (
      cd "$tmp"
      grep -E "[[:space:]]${archive_name}$" SHASUMS256.txt > expected.sha256
      [[ -s expected.sha256 ]]
      sha256sum -c expected.sha256
    )

    tar -xJf "$tmp/$archive_name" -C "$tmp"
    extracted="$tmp/node-v${KAGGLE_NODE_VERSION}-linux-x64"
    _node_compatible "$extracted/bin/node" || {
      printf 'ERROR: downloaded Node runtime failed version compatibility check\n' >&2
      exit 69
    }

    mkdir -p "$(dirname "$KAGGLE_NODE_ROOT")"
    rm -rf "$KAGGLE_NODE_ROOT"
    mv "$extracted" "$KAGGLE_NODE_ROOT"
  )

  export PATH="$KAGGLE_NODE_ROOT/bin:$PATH"
  _emit_node_runtime downloaded
}

ensure_node22
