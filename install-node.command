#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Node.js Install Script
# Downloads the latest LTS version of Node.js and installs project dependencies.
set -e
cd "$(dirname "$0")"

NODE_INDEX="https://nodejs.org/dist/latest-lts/"
NODE_PKG=$(curl -fsSL "$NODE_INDEX" | grep -o 'node-v[0-9\.]*\.pkg' | head -1)
NODE_VERSION=${NODE_PKG#node-v}
NODE_VERSION=${NODE_VERSION%.pkg}

echo "📦 Downloading Node.js $NODE_VERSION (LTS)..."
curl -fsSL "${NODE_INDEX}${NODE_PKG}" -o "$NODE_PKG"

echo "⚙️ Installing Node.js..."
sudo installer -pkg "$NODE_PKG" -target /
rm "$NODE_PKG"

echo "📚 Installing npm packages..."
npm install

echo "✅ Node.js and packages installed successfully."
