#!/usr/bin/env bash
set -e

OS=$(uname)

if [[ "$OS" != "Darwin" ]]; then
  echo "Unsupported OS: $OS"
  exit 1
fi

ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
  echo "This is the Intel version of Docker Desktop"
  echo "Please download the latest Apple Silicon build from"
  echo "https://desktop.docker.com/mac/main/arm64/Docker.dmg"
  exit 1
fi

echo "Downloading Docker Desktop for macOS (Apple Silicon)..."
curl -L https://desktop.docker.com/mac/main/arm64/Docker.dmg -o Docker.dmg
hdiutil attach Docker.dmg
cp -R /Volumes/Docker/Docker.app /Applications
hdiutil detach /Volumes/Docker
open /Applications/Docker.app
echo "Docker Desktop installed."
