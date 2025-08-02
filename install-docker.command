#!/usr/bin/env bash
set -e

OS=$(uname)

if [[ "$OS" == "Darwin" ]]; then
  echo "Downloading Docker Desktop for macOS..."
  curl -L https://desktop.docker.com/mac/main/amd64/Docker.dmg -o Docker.dmg
  hdiutil attach Docker.dmg
  cp -R /Volumes/Docker/Docker.app /Applications
  hdiutil detach /Volumes/Docker
  open /Applications/Docker.app
  echo "Docker Desktop installed."
elif [[ "$OS" == "Linux" ]]; then
  echo "Installing Docker Engine using convenience script..."
  curl -fsSL https://get.docker.com | sh
  echo "Docker Engine installed. Please log out and back in to start using Docker."
elif [[ "$OS" =~ MINGW64_NT|MSYS_NT|CYGWIN_NT ]]; then
  echo "Downloading Docker Desktop for Windows..."
  curl -L "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -o DockerDesktopInstaller.exe
  echo "Launching Docker Desktop installer..."
  start "" DockerDesktopInstaller.exe
else
  echo "Unsupported OS: $OS"
  exit 1
fi
