#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Node.js Install Script
# Downloads the latest LTS version of Node.js and installs project dependencies.
set -e
cd "$(dirname "$0")"

NODE_VERSION=$(curl -fsSL https://nodejs.org/dist/index.json |
  python3 -c "import sys, json; print(next(r['version'] for r in json.load(sys.stdin) if r.get('lts')))" )
NODE_PKG="node-${NODE_VERSION}.pkg"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_PKG}"

echo "📦 Downloading Node.js ${NODE_VERSION} (LTS)..."
curl -fsSL "$NODE_URL" -o "$NODE_PKG"

echo "⚙️ Installing Node.js..."
if command -v installer >/dev/null 2>&1; then
  sudo installer -pkg "$NODE_PKG" -target /
  rm "$NODE_PKG"
else
  echo "installer command not found; skipping Node.js installation"
fi

echo "📚 Installing npm packages..."
npm install

echo "✅ Node.js and packages installed successfully."
