#!/bin/bash
# OnlyFans Express Messenger (OFEM) - Database Setup Wizard
# Usage: Double-click this file (on macOS) or run it in Terminal to create a new database.
# Created: 2025-08-02 – v1.0

set -e
cd "$(dirname "$0")"
node setup-db.js

