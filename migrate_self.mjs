import 'dotenv/config';
import { readFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createUser, loadUsers } from './users.mjs';
import { hashPassword, encryptToken } from './auth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PHONE = process.env.ADMIN_PHONE;
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!PHONE || !PASSWORD) {
  console.error('Usage: set ADMIN_PHONE and ADMIN_PASSWORD in .env, then run: node migrate_self.mjs');
  process.exit(1);
}

// Idempotency check
const existing = loadUsers().find(u => u.role === 'admin');
if (existing) {
  console.log(`ℹ️  Admin already exists: ${existing.name} (${existing.phone}) — skipping migration.`);
  process.exit(0);
}

try {
  // Load existing webToken
  let webToken = null;
  const sessionFile = join(__dirname, '.webtop_session.json');
  if (existsSync(sessionFile)) {
    try {
      const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
      webToken = session.webToken || null;
      if (webToken) console.log('✅ Found existing webToken in .webtop_session.json');
    } catch {
      console.warn('⚠️  Could not parse .webtop_session.json — continuing without webToken');
    }
  } else {
    console.warn('⚠️  .webtop_session.json not found — creating user without webToken');
  }

  // Create admin user
  const passwordHash = await hashPassword(PASSWORD);
  const user = createUser({
    name: process.env.ADMIN_NAME || 'מנהל',
    phone: PHONE,
    passwordHash,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
    role: 'admin',
    status: 'active',
    children: JSON.parse(process.env.ADMIN_CHILDREN || '[]'),
    webTokenEncrypted: webToken ? encryptToken(webToken) : null,
    webTokenUpdatedAt: webToken ? new Date().toISOString() : null,
  });
  console.log(`✅ Admin user created: ${user.name} (${user.phone}) — id: ${user.id}`);

  // Copy old data cache
  const oldCache = join(__dirname, 'data_cache.json');
  const newCache = join(__dirname, `data_cache_${user.id}.json`);
  if (existsSync(oldCache)) {
    copyFileSync(oldCache, newCache);
    console.log(`✅ Copied data_cache.json → data_cache_${user.id}.json`);
  } else {
    console.log('ℹ️  No existing data_cache.json — user will get fresh data on next push');
  }

  console.log('\n✅ Migration complete!');
  console.log(`   User ID: ${user.id}`);
  console.log(`   Login: ${PHONE} + your password`);
  console.log(`   Next: node server.js to start the server`);

} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
}
