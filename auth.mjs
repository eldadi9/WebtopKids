// auth.mjs — ESM, Node.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Lazy env: push_loop on the home PC imports this module for decryptToken only.
// It may run without JWT_SECRET / TOKEN_ENC_KEY when using PUSH_USER_ID + session/API only.

function requireJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Missing env var: JWT_SECRET');
  return s;
}

let tokenEncKeyCache = null;
function requireTokenEncKey() {
  if (tokenEncKeyCache) return tokenEncKeyCache;
  const TOKEN_ENC_KEY_RAW = process.env.TOKEN_ENC_KEY;
  if (!TOKEN_ENC_KEY_RAW) throw new Error('Missing env var: TOKEN_ENC_KEY');
  if (TOKEN_ENC_KEY_RAW.length === 64 && /^[0-9a-fA-F]+$/.test(TOKEN_ENC_KEY_RAW)) {
    tokenEncKeyCache = Buffer.from(TOKEN_ENC_KEY_RAW, 'hex');
  } else if (TOKEN_ENC_KEY_RAW.length === 32) {
    tokenEncKeyCache = Buffer.from(TOKEN_ENC_KEY_RAW, 'utf8');
  } else {
    throw new Error('TOKEN_ENC_KEY must be 64 hex chars (32 bytes) or exactly 32 UTF-8 chars');
  }
  return tokenEncKeyCache;
}

// --- Password hashing ---
export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

export async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// --- JWT ---
export function signJwt(payload) {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: '90d' });
}

export function verifyJwt(token) {
  try {
    return jwt.verify(token, requireJwtSecret());
  } catch {
    return null;
  }
}

// --- AES-256-CBC webToken encryption ---
export function encryptToken(plain) {
  const TOKEN_ENC_KEY = requireTokenEncKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', TOKEN_ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(stored) {
  if (!stored || typeof stored !== 'string') return null;
  try {
    const TOKEN_ENC_KEY = requireTokenEncKey();
    const [ivHex, encHex] = stored.split(':');
    if (!ivHex || !encHex) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', TOKEN_ENC_KEY, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (e) {
    if (e && typeof e.message === 'string' && e.message.startsWith('Missing env var')) throw e;
    return null;
  }
}

// --- Express middleware ---
// requireAuth must precede requireAdmin in route chains
export function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = header.slice(7);
  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = payload;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  });
}
