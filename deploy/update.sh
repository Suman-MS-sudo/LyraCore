#!/bin/bash
# ============================================================
#  LyraCore — Update Script (run after code changes)
#  Usage: bash deploy/update.sh
# ============================================================

set -e

APP_DIR="/var/www/lyracore"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo ">>> Pulling latest code..."
cd "$APP_DIR"
git pull origin main

echo ">>> Rebuilding backend..."
cd "$APP_DIR/backend"
npm ci --silent
npm run build

echo ">>> Rebuilding frontend..."
cd "$APP_DIR/frontend"
npm ci --silent
npm run build

echo ">>> Restarting backend..."
pm2 restart lyracore-backend

echo ""
echo "Done! Changes are live."
pm2 status
