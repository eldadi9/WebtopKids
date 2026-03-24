import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_FILE = join(__dirname, 'users.json');

const ALLOWED_FIELDS = ['name', 'phone', 'chatId', 'children', 'role', 'status',
  'passwordHash', 'webTokenEncrypted', 'webTokenUpdatedAt'];

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
  return cache;
}

export function saveUsers(users) {
  cache = users;
  writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

export function findUserById(id) {
  return loadUsers().find(u => u.id === id) || null;
}

export function findUserByPhone(phone) {
  return loadUsers().find(u => u.phone === phone) || null;
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
