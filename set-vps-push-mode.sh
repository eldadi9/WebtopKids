#!/bin/bash
# Run this ON THE VPS (or via: ssh root@76.13.8.113 'bash -s' < set-vps-push-mode.sh)
# Switches VPS to receive pushes from home PC instead of scraping locally

DEPLOY_DIR=${1:-/srv/webtop}
ENV_FILE="$DEPLOY_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env not found at $ENV_FILE"
  exit 1
fi

# Ensure USE_LOCAL_SCRAPER=false
if grep -q "USE_LOCAL_SCRAPER=" "$ENV_FILE"; then
  sed -i 's/USE_LOCAL_SCRAPER=.*/USE_LOCAL_SCRAPER=false/' "$ENV_FILE"
else
  echo "USE_LOCAL_SCRAPER=false" >> "$ENV_FILE"
fi

# Ensure PORT=3001
if grep -q "^PORT=" "$ENV_FILE"; then
  sed -i 's/^PORT=.*/PORT=3001/' "$ENV_FILE"
else
  echo "PORT=3001" >> "$ENV_FILE"
fi

echo "✅ VPS configured for push mode (USE_LOCAL_SCRAPER=false, PORT=3001)"
pm2 restart webtop --update-env 2>/dev/null || echo "Restart PM2 manually: pm2 restart webtop"
