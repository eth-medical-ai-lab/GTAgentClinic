#!/bin/sh
# Opened in Terminal by ~/Applications/GTAgentClinic.app (made by `npm run mac-launcher`).
# Runs the game in this window, so you see the server: Ctrl+C or closing the window stops it,
# and it stops by itself 2 minutes after the last game tab closes (--exit-when-idle).
cd "$(dirname "$0")/../.." || exit 1
printf '\033]0;GTAgentClinic\007'
if ! command -v npm >/dev/null 2>&1; then
  echo "GTAgentClinic needs Node.js 22.12 or newer, and npm wasn't found. Install it (https://nodejs.org), then open the app again."
  exit 1
fi
exec npm start -- --exit-when-idle
