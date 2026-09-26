#!/usr/bin/env bash
# scripts/start.sh で起動した静的 HTTP サーバを停止する。
#   使い方: scripts/stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$ROOT/.server.pid"

if [[ ! -f "$PIDFILE" ]]; then
  echo "サーバは起動していません (PID ファイルなし)"
  exit 0
fi

PID="$(cat "$PIDFILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for _ in {1..10}; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID"
  fi
  echo "サーバを停止しました (PID $PID)"
else
  echo "PID $PID のプロセスは存在しません"
fi

rm -f "$PIDFILE"
