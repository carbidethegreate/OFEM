#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Database Setup Wizard
# Usage: Double-click this file (on macOS) or run it in Terminal to create a new database.
# Created: 2025-08-02 – v1.0

set -e
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not installed. Please install Node.js." >&2
  exit 1
fi

if [ ! -d node_modules/pg ]; then
  echo "Installing Node dependencies..."
  npm install >/dev/null
fi

node setup-db.js
node migrate.js

