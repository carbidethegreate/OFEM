#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Environment Setup Wizard
# Usage: Double-click this file (on macOS) or run it in Terminal to create/update .env with API keys.
# Created: 2025-08-05 – v1.0

set -e
cd "$(dirname "$0")"
node setup-env.js
