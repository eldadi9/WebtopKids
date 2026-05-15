#!/usr/bin/env node
/**
 * set_admin_password.mjs — Interactive CLI to set/reset admin password.
 *
 * Improvements over root-level set_password.mjs:
 *   - Hidden password prompt (not in shell history)
 *   - Confirms password (typed twice)
 *   - Validates min length (8) and not whitespace-only
 *   - Refuses to lower role from admin to parent accidentally
 *   - Sets status=active automatically
 *   - Supports DEV: pass --users-file=users.dev.json
 *   - Can create a NEW admin if not found, with --create
 *
 * Usage:
 *   node scripts/set_admin_password.mjs                     # interactive — prompts for phone, password
 *   node scripts/set_admin_password.mjs <phone>             # interactive password only
 *   node scripts/set_admin_password.mjs <phone> --create    # create new admin if not found
 *   node scripts/set_admin_password.mjs <phone> --users-file=users.dev.json
 *
 * On the VPS:
 *   cd /root/webtop && node scripts/set_admin_password.mjs 054-4956647
 *
 * In DEV:
 *   USERS_FILE_OVERRIDE=users.dev.json node scripts/set_admin_password.mjs 050-1111111 --create
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ─── Args parsing ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = new Set();
const positional = [];
let usersFile = null;

for (const a of args) {
  if (a === '--create') { flags.add('create'); continue; }
  if (a === '--help' || a === '-h') { flags.add('help'); continue; }
  if (a.startsWith('--users-file=')) { usersFile = a.slice('--users-file='.length); continue; }
  if (a.startsWith('--')) {
    console.error(`Unknown flag: ${a}`);
    process.exit(2);
  }
  positional.push(a);
}

if (flags.has('help')) {
  console.log(`Usage: node scripts/set_admin_password.mjs [phone] [--create] [--users-file=path]

  phone           Optional phone to set password for (will prompt if absent).
  --create        Create a new admin user if phone doesn't exist.
  --users-file=X  Path to users.json (default: env USERS_FILE_OVERRIDE or users.json).
`);
  process.exit(0);
}

// Resolve users.json path
const resolvedUsersFile = usersFile
  ? (usersFile.match(/^([A-Za-z]:)?[\\/]/) ? usersFile : join(REPO_ROOT, usersFile))
  : (process.env.USERS_FILE_OVERRIDE
      ? (process.env.USERS_FILE_OVERRIDE.match(/^([A-Za-z]:)?[\\/]/)
          ? process.env.USERS_FILE_OVERRIDE
          : join(REPO_ROOT, process.env.USERS_FILE_OVERRIDE))
      : join(REPO_ROOT, 'users.json'));

console.log(`[users-file] ${resolvedUsersFile}`);
if (!existsSync(resolvedUsersFile)) {
  console.error(`❌ users.json not found at ${resolvedUsersFile}`);
  if (flags.has('create')) {
    console.log('   --create flag set → will create empty file.');
    writeFileSync(resolvedUsersFile, JSON.stringify({ users: [] }, null, 2));
  } else {
    process.exit(1);
  }
}

// ─── Prompt helpers ────────────────────────────────────────────────────────────
const IS_TTY = !!process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';

// When stdin is piped (CI / tests), pre-buffer all lines for sequential consumption
let _pipedLines = null;
let _pipedIdx = 0;
async function readPipedLines() {
  if (_pipedLines !== null) return;
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  _pipedLines = data.split(/\r?\n/);
}

let _rl = null;
function rl() {
  if (!_rl) _rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return _rl;
}
function closeRl() { if (_rl) { _rl.close(); _rl = null; } }

async function prompt(question) {
  if (!IS_TTY) {
    await readPipedLines();
    const line = _pipedLines[_pipedIdx++] || '';
    process.stdout.write(question + line + '\n');
    return line.trim();
  }
  return new Promise(resolve => rl().question(question, ans => resolve(ans.trim())));
}

async function promptPassword(question) {
  // Piped: just read next line (no masking, but echoed for transcript)
  if (!IS_TTY) {
    await readPipedLines();
    const line = _pipedLines[_pipedIdx++] || '';
    process.stdout.write(question + '*'.repeat(line.length) + '\n');
    return line;
  }
  // Close readline before raw mode (readline owns stdin in line mode)
  closeRl();
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    function onData(ch) {
      ch = String(ch);
      if (ch === '\r' || ch === '\n' ) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(buf);
      } else if (ch === '') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit(130);
      } else if (ch === '\b' || ch === '\x7f') {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        buf += ch;
        process.stdout.write('*');
      }
    }
    stdin.on('data', onData);
  });
}

function normalizePhone(p) { return String(p || '').replace(/[\s-]/g, ''); }

// ─── Load users.json ──────────────────────────────────────────────────────────
function loadUsers() {
  try {
    const j = JSON.parse(readFileSync(resolvedUsersFile, 'utf8'));
    return Array.isArray(j.users) ? j.users : [];
  } catch (e) {
    console.error(`❌ Failed to parse ${resolvedUsersFile}:`, e.message);
    process.exit(1);
  }
}

function saveUsers(users) {
  writeFileSync(resolvedUsersFile, JSON.stringify({ users }, null, 2));
}

// ─── Main flow ────────────────────────────────────────────────────────────────
async function main() {
  let phone = positional[0];
  if (!phone) {
    phone = await prompt('Phone (e.g. 054-4956647): ');
  }
  const normalized = normalizePhone(phone);
  if (normalized.length < 9) {
    console.error('❌ Phone too short.');
    process.exit(1);
  }

  const users = loadUsers();
  let user = users.find(u => normalizePhone(u.phone) === normalized);

  if (!user) {
    if (!flags.has('create')) {
      console.error(`❌ No user with phone ${phone}. Use --create to make a new admin.`);
      console.log('   Existing users:');
      for (const u of users) console.log(`     ${u.phone} | ${u.role} | ${u.status} | ${u.name}`);
      process.exit(1);
    }
    const name = await prompt('Full name for new admin: ');
    if (!name) { console.error('❌ Name required.'); process.exit(1); }
    user = {
      id: randomUUID(),
      name,
      phone,
      chatId: null,
      children: [],
      role: 'admin',
      status: 'active',
      passwordHash: null,
      webTokenEncrypted: null,
      webTokenUpdatedAt: null,
      tokenPendingApproval: null,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      lastLoginIp: null,
      loginCount: 0,
    };
    users.push(user);
    console.log(`✓ Will create new admin: ${name} | ${phone}`);
  } else {
    console.log(`✓ Found user: ${user.name} | ${user.role} | ${user.status}`);
    if (user.role !== 'admin') {
      const yn = await prompt(`⚠️  Current role is "${user.role}", not "admin". Upgrade to admin? (y/n): `);
      if (yn.toLowerCase() === 'y') user.role = 'admin';
    }
  }

  const password = await promptPassword('New password (min 8 chars, hidden): ');
  if (password.length < 8) { console.error('❌ Password must be at least 8 characters.'); process.exit(1); }
  if (!password.trim()) { console.error('❌ Password cannot be only whitespace.'); process.exit(1); }
  const confirm = await promptPassword('Confirm password: ');
  if (password !== confirm) { console.error('❌ Passwords do not match.'); process.exit(1); }

  user.passwordHash = await bcrypt.hash(password, 12);
  user.status = 'active';

  // Save
  saveUsers(users);
  console.log(`\n✅ Password set successfully.`);
  console.log(`   User: ${user.name}`);
  console.log(`   Phone: ${user.phone}`);
  console.log(`   Role: ${user.role}`);
  console.log(`   Status: ${user.status}`);
  console.log(`   File: ${resolvedUsersFile}`);
}

main()
  .then(() => { closeRl(); })
  .catch(e => {
    console.error('❌ Error:', e.message);
    closeRl();
    process.exit(1);
  });
