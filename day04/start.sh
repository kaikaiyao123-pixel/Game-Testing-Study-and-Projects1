#!/usr/bin/env bash
# Git Bash / macOS / Linux one-click launcher
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js 18+ is required but not found in PATH."
  exit 1
fi

echo "Starting blog auth service ..."
echo "Open http://127.0.0.1:3000/login.html in your browser."
exec node server/app.js
