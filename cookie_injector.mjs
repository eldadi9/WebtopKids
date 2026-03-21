#!/usr/bin/env node
/**
 * cookie_injector.mjs — Save/load a pending session cookie for Webtop
 *
 * When the user sends /cookie <value> via Telegram:
 *   1. VPS stores it via pendingCookie state
 *   2. push_loop polls /api/poll-cookie and calls savePendingCookie()
 *   3. On next scrape, webtop_scrape.mjs reads the file and injects via addCookies()
 */
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PENDING_COOKIE_FILE = join(__dirname, '.webtop_cookie_pending.json');

/**
 * Save a received cookie value to disk for webtop_scrape to pick up.
 * @param {string} cookieValue — raw cookie value (not "name=value", just the value)
 * @param {string} [cookieName] — cookie name (default: 'session')
 */
export function savePendingCookie(cookieValue, cookieName = 'session') {
  const payload = {
    name:     cookieName,
    value:    cookieValue,
    domain:   'webtop.smartschool.co.il',
    path:     '/',
    httpOnly: true,
    secure:   true,
    savedAt:  new Date().toISOString(),
  };
  writeFileSync(PENDING_COOKIE_FILE, JSON.stringify(payload, null, 2));
  console.log('[cookie_injector] Saved pending cookie to', PENDING_COOKIE_FILE);
}

/**
 * Load the pending cookie and delete the file.
 * Returns null if no pending cookie exists.
 */
export function loadAndClearPendingCookie() {
  if (!existsSync(PENDING_COOKIE_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(PENDING_COOKIE_FILE, 'utf8'));
    unlinkSync(PENDING_COOKIE_FILE);
    return data;
  } catch {
    return null;
  }
}
