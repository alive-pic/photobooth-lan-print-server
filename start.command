#!/usr/bin/env bash
# PhotoBooth LAN Print Server launcher (macOS/Linux)
# Place this script alongside the compiled binary (photobooth-print-server)
# and double-click or run `./start.command` to launch.

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

BIN="./photobooth-print-server"

if [ ! -x "$BIN" ]; then
  echo "Error: $BIN not found or not executable."
  echo "Ensure the compiled binary is located next to this script."
  exit 1
fi

exec "$BIN" "$@" 