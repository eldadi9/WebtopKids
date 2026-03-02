#!/bin/bash
# Usage: ./deploy.sh user@server.com /srv/webtop
# Example: ./deploy.sh root@1.2.3.4 /srv/webtop

SERVER=${1:?Usage: $0 user@server.com /srv/webtop}
REMOTE_PATH=${2:?Usage: $0 user@server.com /srv/webtop}

echo "📦 Syncing files to $SERVER:$REMOTE_PATH ..."
rsync -avz \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.webtop_session.json' \
  --exclude='homework_status.json' \
  --exclude='.git' \
  --exclude='*.bat' \
  . "$SERVER:$REMOTE_PATH"

echo "🚀 Installing dependencies and restarting PM2 ..."
ssh "$SERVER" "
  cd '$REMOTE_PATH' &&
  npm install --production &&
  (pm2 restart webtop --update-env 2>/dev/null || pm2 start server.js --name webtop) &&
  pm2 save
"

echo "✅ Deployed to $SERVER:$REMOTE_PATH"
echo "   Dashboard: http://$SERVER:3001"
