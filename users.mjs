import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_FILE = join(__dirname, 'users.json');

export function loadUsers() {
  if (!existsSync(USERS_FILE)) return [];
  return JSON.parse(readFileSync(USERS_FILE, 'utf8')).users || [];
}

export function saveUsers(users) {
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
  const users = loadUsers();
  const user = {
    id: randomUUID(),
    loginCount: 0,
    createdAt: new Date().toISOString(),
    lastLogin: null,
    lastLoginIp: null,
    tokenPendingApproval: null,
    ...data
  };
  users.push(user);
  saveUsers(users);
  return user;
}
