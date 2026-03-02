#!/bin/bash
# ─── Webtop Dashboard — VPS Setup Script ────────────────────────────────────
# Run this on Ubuntu 24.04 after SSHing in:
#   ssh root@76.13.8.113
#   bash /srv/webtop/setup-vps.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e
DEPLOY_DIR=${1:-/srv/webtop}

echo "🚀 Setting up Webtop Dashboard at $DEPLOY_DIR"

# ── 1. Install Node.js 20 LTS (if not present) ───────────────────────────────
if ! command -v node &>/dev/null; then
  echo "📦 Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "✅ Node $(node --version) / npm $(npm --version)"

# ── 2. Install PM2 (if not present) ──────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "📦 Installing PM2..."
  npm install -g pm2
fi
echo "✅ PM2 $(pm2 --version)"

# ── 3. Clone or update from GitHub ───────────────────────────────────────────
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "📥 Pulling latest from GitHub..."
  cd "$DEPLOY_DIR"
  git pull origin main
else
  echo "📥 Cloning from GitHub..."
  git clone https://github.com/eldadi9/WebtopKids.git "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
fi

# ── 4. Create .env (only if it doesn't exist) ────────────────────────────────
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "⚙️  Creating .env from .env.example..."
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  echo ""
  echo "⚠️  IMPORTANT: Edit $DEPLOY_DIR/.env and fill in:"
  echo "   WEBTOP_USER=<your webtop username>"
  echo "   WEBTOP_PASS=<your webtop password>"
  echo "   TELEGRAM_BOT_TOKEN=<your bot token>"
  echo "   TELEGRAM_CHAT_ID=<your chat id>"
  echo "   PORT=3001"
  echo "   USE_LOCAL_SCRAPER=false   (use home PC to push data)"
  echo ""
  echo "   Run: nano $DEPLOY_DIR/.env"
  echo "   Then re-run this script."
  exit 0
fi

# ── 5. npm install ────────────────────────────────────────────────────────────
echo "📦 Installing Node dependencies..."
npm install --production

# ── 6. Install Playwright Chromium + system deps ─────────────────────────────
echo "🎭 Installing Playwright Chromium..."
npx playwright install chromium
npx playwright install-deps chromium

# ── 7. Start / restart with PM2 ──────────────────────────────────────────────
echo "🔄 Starting PM2 process..."
if pm2 describe webtop &>/dev/null; then
  pm2 restart webtop --update-env
else
  pm2 start server.js --name webtop --node-args="--env-file=.env" 2>/dev/null \
    || pm2 start server.js --name webtop
fi
pm2 save

# ── 8. Enable PM2 on boot ─────────────────────────────────────────────────────
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash || true
pm2 save

echo ""
echo "✅ Webtop Dashboard deployed!"
echo "   URL:    http://76.13.8.113:3001"
echo "   Logs:   pm2 logs webtop"
echo "   Status: pm2 status"
echo ""
echo "💡 To open port 3001 in firewall:"
echo "   ufw allow 3001/tcp"
