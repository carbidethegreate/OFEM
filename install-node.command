#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Node.js Install Script
# Downloads a specific LTS version of Node.js and installs project dependencies.
set -e
cd "$(dirname "$0")"

# Update NODE_VERSION when upgrading Node.js.
# See https://nodejs.org/en/about/releases/ for latest LTS releases.
NODE_VERSION="v22.18.0"

# Skip installation if desired version is already installed.
if command -v node >/dev/null 2>&1 && [ "$(node -v)" = "$NODE_VERSION" ]; then
  echo "✅ Node.js $NODE_VERSION already installed; skipping download."
else
  NODE_PKG="node-${NODE_VERSION}.pkg"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_PKG}"

  echo "📦 Downloading Node.js ${NODE_VERSION} (LTS)..."
  if curl -fsSL "$NODE_URL" -o "$NODE_PKG"; then
    echo "⚙️ Installing Node.js..."
    if command -v installer >/dev/null 2>&1; then
      sudo installer -pkg "$NODE_PKG" -target /
      rm "$NODE_PKG"
    else
      echo "installer command not found; skipping Node.js installation"
    fi
  else
    echo "⚠️ Unable to download Node.js ${NODE_VERSION}."
    echo "   Please manually download the LTS version from https://nodejs.org/."
  fi
fi

echo "📚 Installing npm packages..."
npm install

echo "✅ Node.js and packages installed successfully."
