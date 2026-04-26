#!/bin/bash
# ============================================================
#  LyraCore — Update Script (run after code changes)
#  Usage: bash deploy/update.sh
# ============================================================

set -e

APP_DIR="/var/www/lyracore"

# node/npm/pm2 live under suman's nvm — always source from there
export NVM_DIR="/home/suman/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if ! command -v npm &>/dev/null; then
  echo "ERROR: npm not found. Run this script as suman or via: sudo -u suman bash deploy/update.sh"
  exit 1
fi



echo ">>> Pulling latest code..."
cd "$APP_DIR"
git pull origin main

echo ">>> Rebuilding backend..."
cd "$APP_DIR/backend"
npm ci --silent
npm run build

echo ">>> Stopping backend before migration..."
pm2 stop lyracore-backend 2>/dev/null || true

echo ">>> Applying database migrations..."
npm run migrate

echo ">>> Rebuilding frontend..."
cd "$APP_DIR/frontend"
npm ci --silent
# Increase heap for frontend build only
NODE_OPTIONS="--max-old-space-size=2048" npm run build

echo ">>> Updating nginx config..."
sudo cp "$APP_DIR/deploy/nginx-lyracore.conf" /etc/nginx/sites-available/lyracore
sudo ln -sf /etc/nginx/sites-available/lyracore /etc/nginx/sites-enabled/lyracore
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ">>> Restarting backend..."
if pm2 list 2>/dev/null | grep -q lyracore-backend; then
  pm2 restart lyracore-backend
else
  echo "  (pm2 process not running — starting fresh)"
  cd "$APP_DIR"
  pm2 start ecosystem.config.js
  pm2 save
fi

echo ""
echo "Done! Changes are live."
pm2 status
