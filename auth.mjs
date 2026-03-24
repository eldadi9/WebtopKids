// auth.mjs — ESM, Node.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// --- Env validation ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Missing env var: JWT_SECRET');

const TOKEN_ENC_KEY_RAW = process.env.TOKEN_ENC_KEY;
if (!TOKEN_ENC_KEY_RAW) throw new Error('Missing env var: TOKEN_ENC_KEY');

let TOKEN_ENC_KEY;
if (TOKEN_ENC_KEY_RAW.length === 64 && /^[0-9a-fA-F]+$/.test(TOKEN_ENC_KEY_RAW)) {
  TOKEN_ENC_KEY = Buffer.from(TOKEN_ENC_KEY_RAW, 'hex');
} else if (TOKEN_ENC_KEY_RAW.length === 32) {
  TOKEN_ENC_KEY = Buffer.from(TOKEN_ENC_KEY_RAW, 'utf8');
} else {
  throw new Error('TOKEN_ENC_KEY must be 64 hex chars (32 bytes) or exactly 32 UTF-8 chars');
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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyJwt(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// --- AES-256-CBC webToken encryption ---
export function encryptToken(plain) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', TOKEN_ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(stored) {
  const [ivHex, encHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', TOKEN_ENC_KEY, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// --- Express middleware ---
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
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}
