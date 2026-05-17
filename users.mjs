import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_FILE = process.env.USERS_FILE_OVERRIDE
  ? (process.env.USERS_FILE_OVERRIDE.match(/^([A-Za-z]:)?[\\/]/) ? process.env.USERS_FILE_OVERRIDE : join(__dirname, process.env.USERS_FILE_OVERRIDE))
  : join(__dirname, 'users.json');

const ALLOWED_FIELDS = ['name', 'phone', 'chatId', 'children', 'role', 'status',
  'passwordHash', 'webTokenEncrypted', 'webTokenUpdatedAt', 'isOwner', 'expectsTelegram'];

// ─── Owner-admin invariant ────────────────────────────────────────────────────
// The app owner (Eldad, phone 054-4956647, chatId 7773889743) MUST always
// receive Telegram alerts. This is a hard product invariant: the owner is the
// person who built and operates the system, and a regression that silently
// drops their alerts (as happened on 2026-05-17 when the parent user had
// chatId=null) is unacceptable. loadUsers() self-heals on every read.
const OWNER_PHONE = '054-4956647';
const OWNER_CHAT_ID = '7773889743';
const OWNER_CHILDREN = ['יולי', 'אמי'];

function enforceOwnerInvariant(users) {
  if (!Array.isArray(users) || users.length === 0) return users;
  const ownerNorm = OWNER_PHONE.replace(/[\s-]/g, '');
  const owner = users.find(u =>
    u?.isOwner === true ||
    (u?.role === 'admin' && String(u?.phone || '').replace(/[\s-]/g, '') === ownerNorm)
  );
  if (!owner) {
    console.error('[users] OWNER INVARIANT VIOLATION: no admin user matches OWNER_PHONE — alerts will not reach the app owner.');
    return users;
  }
  let changed = false;
  if (owner.chatId !== OWNER_CHAT_ID) {
    console.warn(`[users] Restoring owner chatId (was ${JSON.stringify(owner.chatId)})`);
    owner.chatId = OWNER_CHAT_ID;
    changed = true;
  }
  if (!Array.isArray(owner.children) || owner.children.length === 0) {
    console.warn('[users] Restoring owner children list');
    owner.children = [...OWNER_CHILDREN];
    changed = true;
  }
  if (owner.status !== 'active') {
    console.warn(`[users] Reactivating owner (status was ${JSON.stringify(owner.status)})`);
    owner.status = 'active';
    changed = true;
  }
  if (owner.expectsTelegram !== true) {
    owner.expectsTelegram = true;
    changed = true;
  }
  if (owner.isOwner !== true) {
    owner.isOwner = true;
    changed = true;
  }
  if (changed) {
    try {
      writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
      console.warn('[users] Owner invariant restored and persisted to users.json');
    } catch (e) {
      console.error('[users] Failed to persist owner invariant restore:', e.message);
    }
  }
  return users;
}

let cache = null;

export function loadUsers() {
  if (cache !== null) return cache;
  if (!existsSync(USERS_FILE)) { cache = []; return cache; }
  try {
    cache = JSON.parse(readFileSync(USERS_FILE, 'utf8')).users || [];
  } catch (e) {
    console.warn('[users] Failed to parse users.json, starting empty:', e.message);
    cache = [];
  }
  cache = enforceOwnerInvariant(cache);
  return cache;
}

function normalizePhone(p) {
  return String(p || '').replace(/[\s-]/g, '');
}

export function saveUsers(users) {
  cache = users;
  writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

export function findUserById(id) {
  return loadUsers().find(u => u.id === id) || null;
}

export function findUserByPhone(phone) {
  const n = normalizePhone(phone);
  return loadUsers().find(u => normalizePhone(u.phone) === n) || null;
}

export function findUserByChatId(chatId) {
  return loadUsers().find(u => u.chatId === chatId) || null;
}

export function updateUser(id, patch) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('User not found: ' + id);
  users[idx] = { ...users[idx], ...patch };
  saveUsers(users);
  return users[idx];
}

export function createUser(data) {
  if (data.phone && findUserByPhone(data.phone)) {
    throw new Error('User with this phone already exists');
  }
  const allowed = Object.fromEntries(
    ALLOWED_FIELDS.filter(k => k in data).map(k => [k, data[k]])
  );
  const user = {
    id: randomUUID(),
    loginCount: 0,
    createdAt: new Date().toISOString(),
    lastLogin: null,
    lastLoginIp: null,
    tokenPendingApproval: null,
    ...allowed,
  };
  const users = loadUsers();
  users.push(user);
  saveUsers(users);
  return user;
}
