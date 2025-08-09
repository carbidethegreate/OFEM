#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Database Setup Wizard
# Usage: Double-click this file (on macOS) or run it in Terminal to create a new database.
# Created: 2025-08-02 – v1.0
# Includes migrations for scheduled messages and PPV tables.

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

node setup-db.js
node migrate.js
node migrate_add_fan_fields.js
node migrate_messages.js
node migrate_scheduled_messages.js
node migrate_add_ppv_tables.js
node migrate_add_ppv_schedule_fields.js
