#!/usr/bin/env bash
# Launch Chrome with remote debugging for capture-params (CDP mode).
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="${PTS_CHROME_PROFILE:-$HOME/.pts-chrome-profile}"

if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome not found at: $CHROME"
  exit 1
fi

mkdir -p "$PROFILE"

echo "Starting Chrome with CDP on port 9222"
echo "Profile: $PROFILE"
echo ""
echo "1. Log into PTS in this window if needed"
echo "2. Leave this Chrome window open"
echo "3. In another terminal, run:"
echo "   cd $(cd "$(dirname "$0")/.." && pwd)"
echo "   yarn capture-params --tier 1 --limit 5"
echo ""

exec "$CHROME" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE" \
  --disable-http2 \
  --disable-quic \
  "https://www.fordtechservice.dealerconnection.com/"
