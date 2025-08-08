#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Predeploy Script
# Ensures database migrations run before server start.
# Created: 2025-08-08 – v1.0

set -e
cd "$(dirname "$0")"

# Ensure required Node modules are installed
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

