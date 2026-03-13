#!/usr/bin/env node
/**
 * push_scrape.mjs — Entry point for scheduled task / push_scrape.bat
 *
 * One-shot: scrape Webtop + push to VPS.
 * Spawns scrape_and_push.mjs (avoids module import timing issues).
 */
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = join(__dirname, 'scrape_and_push.mjs');

const proc = spawn(process.execPath, [target], {
  cwd: __dirname,
  stdio: 'inherit',
  env: process.env,
});
proc.on('close', (code) => process.exit(code ?? 0));
proc.on('error', (err) => {
  console.error('[push_scrape] Failed to start:', err.message);
  process.exit(1);
});
