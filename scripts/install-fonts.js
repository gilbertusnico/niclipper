/**
 * Font installer for Niclipper
 *
 * Downloads Plus Jakarta Sans from Google Fonts and installs it
 * so libass can use it for subtitle rendering.
 * Runs automatically via `npm run postinstall`.
 *
 * Uses user-local ~/.fonts/ directory to avoid EPERM issues
 * on systems where npm postinstall runs as non-root.
 */

import { execSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { get } from 'https';
import { homedir } from 'os';
import { join } from 'path';

// System-wide install path (may require root — we check it first)
const SYSTEM_FONT_DIR = '/usr/share/fonts/truetype/plus-jakarta-sans';
// User-local fallback (always writable)
const USER_FONT_DIR = join(homedir(), '.fonts', 'plus-jakarta-sans');

const FONTS = [
  {
    name: 'PlusJakartaSans-Bold.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/plusjakartasans/static/PlusJakartaSans-Bold.ttf',
  },
  {
    name: 'PlusJakartaSans-Regular.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/plusjakartasans/static/PlusJakartaSans-Regular.ttf',
  },
];

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
 * Check if font files exist in a directory (quick check without fc-list).
 */
function fontFilesExist(dir) {
  return FONTS.every((f) => existsSync(join(dir, f.name)));
}

async function main() {
  console.log('[Fonts] Checking Plus Jakarta Sans...');

  // ── 1. Already available to fontconfig? ──
  if (isFontInstalled()) {
    console.log('[Fonts] Plus Jakarta Sans already installed. Skipping.');
    return;
  }

  // ── 2. Files exist in system dir (from a prior root install)? ──
  if (fontFilesExist(SYSTEM_FONT_DIR)) {
    console.log('[Fonts] Found font files in system dir. Running fc-cache...');
    try {
      execSync('fc-cache -f', { stdio: 'inherit' });
      console.log('[Fonts] ✅ Plus Jakarta Sans activated.');
    } catch (e) {
      console.log('[Fonts] ⚠ fc-cache skipped (non-root). Fonts will still work.');
    }
    return;
  }

  // ── 3. Files exist in user-local dir? ──
  if (fontFilesExist(USER_FONT_DIR)) {
    console.log('[Fonts] Found font files in ~/.fonts. Running fc-cache...');
    execSync('fc-cache -f', { stdio: 'inherit' });
    console.log('[Fonts] ✅ Plus Jakarta Sans activated.');
    return;
  }

  // ── 4. Not installed anywhere — download to user-local dir ──
  console.log('[Fonts] Downloading to ~/.fonts/plus-jakarta-sans/...');

  if (!existsSync(USER_FONT_DIR)) {
    mkdirSync(USER_FONT_DIR, { recursive: true });
  }

  for (const font of FONTS) {
    const dest = join(USER_FONT_DIR, font.name);
    if (existsSync(dest)) {
      console.log(`[Fonts] ${font.name} already exists.`);
      continue;
    }
    console.log(`[Fonts] Downloading ${font.name}...`);
    await download(font.url, dest);
    console.log(`[Fonts] ${font.name} saved.`);
  }

  console.log('[Fonts] Running fc-cache...');
  execSync('fc-cache -f', { stdio: 'inherit' });
  console.log('[Fonts] ✅ Plus Jakarta Sans installed successfully.');
}

main().catch((err) => {
  console.error('[Fonts] ❌ Failed to install fonts:', err.message);
  process.exit(1);
});