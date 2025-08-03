#!/bin/bash
# Remove the macOS quarantine attribute from command files
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

xattr -d com.apple.quarantine "$DIR/install.command" 2>/dev/null || true
xattr -d com.apple.quarantine "$DIR/install-node.command" 2>/dev/null || true
xattr -d com.apple.quarantine "$DIR/install-docker.command" 2>/dev/null || true
xattr -d com.apple.quarantine "$DIR/setup-db.command" 2>/dev/null || true
xattr -d com.apple.quarantine "$DIR/start.command" 2>/dev/null || true
xattr -d com.apple.quarantine "$DIR/remove-quarantine.command" 2>/dev/null || true

echo "Quarantine flags removed from command files."
