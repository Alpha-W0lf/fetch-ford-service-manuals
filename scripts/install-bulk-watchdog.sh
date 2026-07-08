#!/usr/bin/env bash
# Install launchd watchdog (runs every 5 min, also at login).
# Launcher lives in ~/bin (outside Documents) to avoid macOS TCC blocking launchd.
# Experimental: verify with `launchctl print gui/$UID/com.alphaw0lf.ford-bulk-watchdog`
# and ~/Library/Logs/ford-bulk-watchdog.log before relying on it overnight.
#
# Usage:
#   ./scripts/install-bulk-watchdog.sh
#   ./scripts/install-bulk-watchdog.sh --uninstall
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.alphaw0lf.ford-bulk-watchdog"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/${UID_NUM}" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Uninstalled $LABEL"
  exit 0
fi

chmod +x "$ROOT/scripts/ensure-bulk-running.sh"
mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents" "$HOME/bin"

LAUNCHER="$HOME/bin/ford-bulk-watchdog.sh"
cp "$ROOT/scripts/ensure-bulk-running.sh" "$LAUNCHER"
chmod +x "$LAUNCHER"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${LAUNCHER}</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/ford-bulk-watchdog.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/ford-bulk-watchdog.log</string>
  <key>WorkingDirectory</key>
  <string>${HOME}</string>
</dict>
</plist>
EOF

launchctl bootout "gui/${UID_NUM}" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"
launchctl enable "gui/${UID_NUM}/${LABEL}"
launchctl kickstart -k "gui/${UID_NUM}/${LABEL}"

echo "Installed $LABEL"
echo "  plist:  $PLIST"
echo "  log:    $ROOT/logs/watchdog.log"
echo "  check:  launchctl print gui/${UID_NUM}/${LABEL}"
echo "  health: $ROOT/scripts/queue-status.sh --health"
