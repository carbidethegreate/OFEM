#!/usr/bin/env bash
# OnlyFans Express Messenger (OFEM) - Docker Install Script
# Installs Docker Desktop using Homebrew.
set -e
cd "$(dirname "$0")"

OS=$(uname)
if [[ "$OS" != "Darwin" ]]; then
  echo "Unsupported OS: $OS"
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew not found. Please install Homebrew from https://brew.sh"
  exit 1
fi

echo "Installing Docker Desktop via Homebrew..."
brew install --cask docker
open -a Docker || open /Applications/Docker.app
echo "Docker Desktop installed."
