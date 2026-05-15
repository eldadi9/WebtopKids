#!/usr/bin/env bash
# ============================================================
# WebtopKids DEV server on localhost:3002
# Uses .env.dev (NOT .env)
# ============================================================
set -e
cd "$(dirname "$0")/.."
export DOTENV_PATH=.env.dev
export USERS_FILE_OVERRIDE=users.dev.json
echo "Starting WebtopKids DEV on http://localhost:3002 ..."
node server.js
