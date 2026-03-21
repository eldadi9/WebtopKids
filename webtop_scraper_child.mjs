/**
 * Shared: spawn webtop_api_fetch.py or webtop_scrape.mjs with timeout + spawn error handling.
 * Used by push_loop.mjs, server.js (local scrape), scrape_and_push.mjs.
 */
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync, unlinkSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const KILL_GRACE_MS = parseInt(process.env.SCRAPER_KILL_GRACE_MS || '8000', 10);

/**
 * @param {{ log?: (s: string) => void, useScrapingLock?: boolean, scrapingLockPath?: string }} opts
 */
export function runWebtopScraperChild(opts = {}) {
  const log = opts.log || (() => {});
  const timeoutMs = parseInt(process.env.SCRAPER_TIMEOUT_MS || '600000', 10);
  const scrapingLockPath = opts.scrapingLockPath || join(__dirname, '.scraping_lock');
  const useScrapingLock = Boolean(opts.useScrapingLock);

  const pyScript = join(__dirname, 'webtop_api_fetch.py');
  const jsScript = join(__dirname, 'webtop_scrape.mjs');
  const usePython = existsSync(pyScript) && process.env.USE_API_FETCHER !== 'false';

  return new Promise((resolve, reject) => {
    (async () => {
      if (!usePython && useScrapingLock) {
        writeFileSync(scrapingLockPath, String(Date.now()));
        await new Promise((r) => setTimeout(r, 3000));
      }

      let proc;
      if (usePython) {
        const pythonBin = process.env.PYTHON_BIN || 'python';
        log(`Using Python API fetcher (${pythonBin})`);
        proc = spawn(pythonBin, [pyScript], { env: { ...process.env }, cwd: __dirname });
    } else {
      log(
        'Using Playwright scraper (fallback) — יופיע Chromium. למניעה: ודא ש־webtop_api_fetch.py קיים ו־USE_API_FETCHER לא false',
      );
        const env = { ...process.env, WEBTOP_SESSION: join(__dirname, '.webtop_session.json') };
        proc = spawn(process.execPath, [jsScript], { env, cwd: __dirname });
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let timeoutId = null;
      let killFollowUpId = null;
      let settled = false;

      const releaseLock = () => {
        if (!usePython && useScrapingLock) {
          try {
            unlinkSync(scrapingLockPath);
          } catch { /* ignore */ }
        }
      };

      const hardKill = () => {
        try {
          proc.kill('SIGTERM');
        } catch { /* ignore */ }
        killFollowUpId = setTimeout(() => {
          try {
            if (!proc.killed) proc.kill('SIGKILL');
          } catch { /* ignore */ }
        }, KILL_GRACE_MS);
      };

      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          log(`[scraper] Timeout ${timeoutMs}ms — terminating child`);
          hardKill();
        }, timeoutMs);
      }

      proc.stdout.on('data', (d) => {
        stdout += d;
      });
      proc.stderr.on('data', (d) => {
        stderr += d;
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (killFollowUpId) clearTimeout(killFollowUpId);
        releaseLock();
        reject(new Error(`Scraper spawn failed: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (killFollowUpId) clearTimeout(killFollowUpId);
        releaseLock();
        if (stderr.trim()) log(`[scraper-stderr] ${stderr.trim().slice(0, 500)}`);
        if (timedOut) {
          reject(new Error(`Scraper timeout after ${timeoutMs}ms`));
          return;
        }
        if (code === 2) {
          reject(new Error('Session expired'));
          return;
        }
        if (code !== 0) {
          reject(new Error(`Scraper exited ${code}: ${stderr.slice(0, 400)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`JSON parse error: ${stdout.slice(0, 200)}`));
        }
      });
    })().catch(reject);
  });
}
