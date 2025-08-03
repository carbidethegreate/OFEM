#!/bin/bash
# Remove the macOS quarantine attribute from command files
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

for f in "$DIR"/*.command; do
  xattr -d com.apple.quarantine "$f" 2>/dev/null || true
done

echo "Quarantine flags removed from command files."
