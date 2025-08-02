#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi
echo "Starting OnlyFans Express Messenger..."
npm start
