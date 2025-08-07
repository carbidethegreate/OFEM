#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Migration Runner
# Usage: Double-click this file or run in Terminal to apply non-destructive migrations.
# Created: 2025-08-05 – v1.0
# Runs all database migrations via migrate_all.js.

set -e
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not installed. Please install Node.js." >&2
  exit 1
fi

# Ensure required Node modules for database tasks are installed
missing=false
for mod in pg dotenv; do
  if [ ! -d "node_modules/$mod" ]; then
    missing=true
    break
  fi
done
if [ "$missing" = true ]; then
  echo "Installing Node dependencies..."
  npm install >/dev/null
fi

node migrate_all.js

