#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Node.js Install Script
# Downloads the latest LTS version of Node.js and installs project dependencies.
set -e
cd "$(dirname "$0")"

# Discover latest LTS Node.js version using POSIX tools.
NODE_VERSION=$(curl -fsSL https://nodejs.org/dist/index.tab 2>/dev/null |
  awk 'NR>1 && $10 != "-" {print $1; exit}')

if [ -n "$NODE_VERSION" ]; then
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
else
  echo "⚠️ Unable to reach nodejs.org. Skipping Node.js download."
  echo "   Please manually download the LTS version from https://nodejs.org/."
fi

echo "📚 Installing npm packages..."
npm install

echo "✅ Node.js and packages installed successfully."
