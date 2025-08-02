#!/bin/bash
# Exit on first error
set -e
# OnlyFans Express Messenger (OFEM) - Install Script
# Usage: Double-click this file (on macOS) or run it in Terminal to set up the project.
# Created: 2025-08-02 – v1.0

cd "$(dirname "$0")"
echo "🔧 Installing Node.js dependencies (this may take a moment)..."
npm install

if [ -f .env ]; then
  echo "🐘 Running database migrations..."
  if node migrate.js; then
    echo "Database is ready."
  else
    echo "Skipping migrations (database not yet configured)."
  fi
fi

echo "✅ Installation complete!"
echo "-------------------------------------------------"
echo "Next steps:"
echo "1. If you haven't created the database yet, open predeploy.html and click 'Set up new database'."
echo "2. Start the server with: ./start.command"
echo ""
echo "Happy messaging! 😃"

# End of File – Last modified 2025-08-02
