#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TUNNEL_ID="${1:-}"
if [[ ! "$TUNNEL_ID" =~ ^tunnel_[A-Za-z0-9]+$ ]]; then
  echo '사용법: bash scripts/connect-chatgpt.sh tunnel_<발급받은 ID>' >&2
  exit 1
fi
TUNNEL_BIN="${STUDY_TUNNEL_BIN:-$ROOT/.local-tools/tunnel-client}"
NODE_BIN="$(command -v node)"
if [[ ! -x "$TUNNEL_BIN" ]]; then
  echo 'OpenAI 공식 tunnel-client를 .local-tools/tunnel-client에 설치해야 합니다.' >&2
  exit 1
fi
STATE_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-path study-log/tunnel)"
umask 077
mkdir -p "$STATE_DIR/profiles"
KEY_FILE="$STATE_DIR/runtime-key"
if [[ ! -s "$KEY_FILE" ]]; then
  if [[ ! -t 0 ]]; then
    echo 'API 키 입력은 사용자 터미널에서 진행하세요. 채팅에 키를 붙이지 마세요.' >&2
    exit 1
  fi
  IFS= read -r -s -p 'Tunnel Read + Use 런타임 API 키 (화면에 표시되지 않음): ' STUDY_TUNNEL_KEY
  echo
  if [[ -z "$STUDY_TUNNEL_KEY" ]]; then exit 1; fi
  printf '%s' "$STUDY_TUNNEL_KEY" > "$KEY_FILE"
  unset STUDY_TUNNEL_KEY
fi
chmod 600 "$KEY_FILE"
"$TUNNEL_BIN" runtimes connect \
  --alias study-site \
  --profile study-site \
  --profile-dir "$STATE_DIR/profiles" \
  --tunnel-id "$TUNNEL_ID" \
  --runtime-api-key "file:$KEY_FILE" \
  --mcp-command "\"$NODE_BIN\" \"$ROOT/scripts/study-mcp.mjs\""
"$TUNNEL_BIN" --json runtimes status study-site
