#!/usr/bin/env bash
# 静的 HTTP サーバをバックグラウンドで起動する。
#   使い方: scripts/start.sh
#   ポート: 環境変数 PORT で変更可能（既定 8001）
set -euo pipefail

PORT="${PORT:-8001}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$ROOT/.server.pid"
LOGFILE="$ROOT/.server.log"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "サーバは既に起動しています (PID $(cat "$PIDFILE"), port $PORT)"
  exit 0
fi

cd "$ROOT"
nohup python3 -m http.server "$PORT" >"$LOGFILE" 2>&1 &
echo $! >"$PIDFILE"
sleep 1

if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "サーバを起動しました: http://localhost:$PORT (PID $(cat "$PIDFILE"))"
else
  echo "起動に失敗しました。$LOGFILE を確認してください。" >&2
  rm -f "$PIDFILE"
  exit 1
fi
