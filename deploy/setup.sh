#!/bin/bash
# ============================================================
#  LyraCore — Production Deploy Script
#  Target: Debian 12 (GCP e2-micro)
#  Run as a user with sudo access (not root)
#
#  Usage:
#    chmod +x deploy/setup.sh
#    bash deploy/setup.sh
# ============================================================

set -e   # exit on first error

APP_DIR="/var/www/lyracore"
REPO="https://github.com/Suman-MS-sudo/LyraCore.git"
NODE_VERSION="20"

echo ""
echo "======================================================"
echo "  LyraCore Production Setup"
echo "======================================================"
echo ""

# ── 1. System packages ─────────────────────────────────────────────────────────
echo ">>> [1/9] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq git nginx curl unzip build-essential

# ── 2. Swap file (critical for e2-micro 1 GB RAM) ────────────────────────────
if [ ! -f /swapfile ]; then
  echo ">>> [2/9] Creating 2 GB swap file..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
else
  echo ">>> [2/9] Swap already exists, skipping."
fi

# ── 3. Node.js via nvm ────────────────────────────────────────────────────────
echo ">>> [3/9] Installing Node.js $NODE_VERSION via nvm..."
if [ ! -d "$HOME/.nvm" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
echo "Node: $(node -v)  NPM: $(npm -v)"

# ── 4. PM2 ───────────────────────────────────────────────────────────────────
echo ">>> [4/9] Installing PM2..."
npm install -g pm2 --silent

# ── 5. Clone / pull repo ─────────────────────────────────────────────────────
echo ">>> [5/9] Setting up app directory..."
sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  echo "    Repo already exists — pulling latest..."
  cd "$APP_DIR"
  git pull origin main
else
  echo "    Cloning repository..."
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── 6. Backend setup ─────────────────────────────────────────────────────────
echo ">>> [6/9] Installing backend dependencies & building..."
cd "$APP_DIR/backend"

if [ ! -f .env ]; then
  echo ""
  echo "  !! No .env file found in backend/."
  echo "  !! Copying .env.example — EDIT IT before starting the app."
  cp .env.example .env
fi

npm ci --silent
npm run build

# Ensure uploads dirs exist
mkdir -p "$APP_DIR/uploads/quotations"
mkdir -p "$APP_DIR/uploads/qc_photos"

# Seed DB if it doesn't exist yet
DB_FILE="$APP_DIR/backend/data/lyracore.db"
if [ ! -f "$DB_FILE" ]; then
  echo "    Seeding database..."
  node dist/db/seed.js
fi

# ── 7. Frontend build ─────────────────────────────────────────────────────────
echo ">>> [7/9] Installing frontend dependencies & building..."
cd "$APP_DIR/frontend"
npm ci --silent
npm run build

# ── 8. Nginx setup ───────────────────────────────────────────────────────────
echo ">>> [8/9] Configuring Nginx..."
sudo cp "$APP_DIR/deploy/nginx-lyracore.conf" /etc/nginx/sites-available/lyracore
sudo ln -sf /etc/nginx/sites-available/lyracore /etc/nginx/sites-enabled/lyracore
# Remove default site if it exists
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl enable nginx

# ── 9. PM2 start ─────────────────────────────────────────────────────────────
echo ">>> [9/9] Starting backend with PM2..."
cd "$APP_DIR"
pm2 start ecosystem.config.js --env production
pm2 save

# Register PM2 to start on reboot
PM2_STARTUP=$(pm2 startup | grep "sudo" | tail -1)
echo ""
echo "  Run this command to enable PM2 auto-start on reboot:"
echo "  $PM2_STARTUP"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "======================================================"
echo "  DONE! LyraCore is running."
echo ""
echo "  App:      http://$(curl -s ifconfig.me)"
echo "  PM2 logs: pm2 logs lyracore-backend"
echo "  PM2 mon:  pm2 monit"
echo ""
echo "  Next steps:"
echo "  1. Edit /var/www/lyracore/backend/.env with your real values"
echo "  2. pm2 restart lyracore-backend"
echo "  3. (Optional) sudo certbot --nginx -d yourdomain.com  for HTTPS"
echo "======================================================"
