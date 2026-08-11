#!/bin/bash
# Install (or update) the 5pm work-log sync.
#
# The script is copied to ~/.local/bin rather than run from this repo: macOS gates
# background access to ~/Documents, and a launchd job that silently loses that
# permission is worse than one extra copy step. Re-run this after editing the script.

set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/worklog-sync.py"
DEST="$HOME/.local/bin/lcp-worklog-sync.py"
LABEL="com.jacksondarr.lcp-worklog-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/.local/bin" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$SRC" "$DEST"
chmod +x "$DEST"
echo "installed $DEST"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DEST</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>17</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/lcp-worklog-sync.out</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/lcp-worklog-sync.err</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST_EOF
echo "wrote $PLIST"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "loaded — runs daily at 5:00 PM"
echo
launchctl print "gui/$UID/$LABEL" | grep -E "state|program|runs" | head -5 || true
