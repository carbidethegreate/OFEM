#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Install Script
# Usage: Double-click this file (on macOS) or run it in Terminal to set up the project.
# Created: 2025-08-02 – v1.0

echo "🔧 Installing Node.js dependencies (this may take a moment)..."
npm install

echo "🐘 Setting up the PostgreSQL database (creating tables)..."
node migrate.js

echo "✅ Installation complete! OFEM is now set up."
echo "-------------------------------------------------"
echo "Next steps:"
echo "1. Start the server with: ./start.command"
echo "2. Once the server is running, you can test the endpoints."
echo "   - GET http://localhost:3000/api/fans        (fetch the list of fans)"
echo "   - POST http://localhost:3000/api/sendMessage (send a personalised message)"
echo ""
echo "Happy messaging! 😃"

# End of File – Last modified 2025-08-02
