/**
 * Font installer for Niclipper
 *
 * Downloads Plus Jakarta Sans from Google Fonts and installs it
 * so libass can use it for subtitle rendering.
 * Runs automatically via `npm run postinstall`.
 *
 * Uses user-local ~/.fonts/ directory to avoid EPERM issues
 * on systems where npm postinstall runs as non-root.
 *
 * Google Fonts only ships the variable-weight version for this font,
 * so we download PlusJakartaSans[wght].ttf which covers all weights.
 */

import { execSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { get } from 'https';
import { homedir } from 'os';
import { join } from 'path';

// System-wide install path (may need root — we check it first)
const SYSTEM_DIR = '/usr/share/fonts/truetype/plus-jakarta-sans';
// User-local fallback (always writable)
const USER_DIR = join(homedir(), '.fonts', 'plus-jakarta-sans');

const FONT_FILENAME = 'PlusJakartaSans%5Bwght%5D.ttf';
const FONT_URL = `https://raw.githubusercontent.com/google/fonts/main/ofl/plusjakartasans/${FONT_FILENAME}`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(dest);
    get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        resolve();
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if Plus Jakarta Sans is already available to fontconfig.
 */
function isFontInstalled() {
  try {
    execSync(
      'fc-list 2>/dev/null | grep -qi "Plus Jakarta Sans"',
      { stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the font file exists in a directory.
 */
function fontFileExists(dir) {
  return existsSync(join(dir, 'PlusJakartaSans[wght].ttf')) ||
         existsSync(join(dir, 'PlusJakartaSans%5Bwght%5D.ttf'));
}

async function main() {
  console.log('[Fonts] Checking Plus Jakarta Sans...');

  // ── 1. Already available to fontconfig? ──
  if (isFontInstalled()) {
    console.log('[Fonts] Plus Jakarta Sans already installed. Skipping.');
    return;
  }

  // ── 2. Files exist in system dir (from a prior root install)? ──
  if (fontFileExists(SYSTEM_DIR)) {
    console.log('[Fonts] Found font files in system dir. Running fc-cache...');
    try {
      execSync('fc-cache -f', { stdio: 'inherit' });
      console.log('[Fonts] ✅ Plus Jakarta Sans activated.');
    } catch {
      console.log('[Fonts] ⚠ fc-cache skipped (non-root). Fonts will still work.');
    }
    return;
  }

  // ── 3. Files exist in user-local dir? ──
  if (fontFileExists(USER_DIR)) {
    console.log('[Fonts] Found font files in ~/.fonts. Running fc-cache...');
    execSync('fc-cache -f', { stdio: 'inherit' });
    console.log('[Fonts] ✅ Plus Jakarta Sans activated.');
    return;
  }

  // ── 4. Not installed anywhere — download to user-local dir ──
  console.log('[Fonts] Downloading to ~/.fonts/plus-jakarta-sans/...');

  if (!existsSync(USER_DIR)) {
    mkdirSync(USER_DIR, { recursive: true });
  }

  const dest = join(USER_DIR, 'PlusJakartaSans[wght].ttf');
  if (existsSync(dest)) {
    console.log('[Fonts] Font file already exists.');
  } else {
    console.log('[Fonts] Downloading variable font (covers all weights)...');
    await download(FONT_URL, dest);
    console.log('[Fonts] Font saved.');
  }

  console.log('[Fonts] Running fc-cache...');
  execSync('fc-cache -f', { stdio: 'inherit' });
  console.log('[Fonts] ✅ Plus Jakarta Sans installed successfully.');
}

main().catch((err) => {
  console.error('[Fonts] ❌ Failed to install fonts:', err.message);
  process.exit(1);
});