#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Start Script
# Usage: Double-click this file (on macOS) or run it in Terminal to start the server.
# Created: 2025-08-02 – v1.0

set -e
cd "$(dirname "$0")"
echo "Starting OnlyFans Express Messenger..."
echo "Press Ctrl+C to stop the server."

# Install dependencies if pg (PostgreSQL client) is missing
if ! node -e "require('pg')" >/dev/null 2>&1; then
  echo "Installing npm packages..."
  npm install
fi

node migrate.js
npm start

