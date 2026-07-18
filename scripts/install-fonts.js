/**
 * Font installer for Niclipper
 *
 * Downloads Plus Jakarta Sans from Google Fonts and installs it
 * on the system so libass can use it for subtitle rendering.
 * Runs automatically via `npm run postinstall`.
 */

import { execSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { get } from 'https';

const FONT_DIR = '/usr/share/fonts/truetype/plus-jakarta-sans';
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

async function main() {
  console.log('[Fonts] Checking Plus Jakarta Sans...');

  // Check if already installed
  try {
    execSync('fc-list :lang=en | grep -i "Plus Jakarta Sans"', { stdio: 'pipe' });
    console.log('[Fonts] Plus Jakarta Sans already installed. Skipping.');
    return;
  } catch {
    // Not installed, proceed
  }

  if (!existsSync(FONT_DIR)) {
    mkdirSync(FONT_DIR, { recursive: true });
  }

  for (const font of FONTS) {
    const dest = `${FONT_DIR}/${font.name}`;
    if (existsSync(dest)) {
      console.log(`[Fonts] ${font.name} already exists.`);
      continue;
    }
    console.log(`[Fonts] Downloading ${font.name}...`);
    await download(font.url, dest);
    console.log(`[Fonts] ${font.name} saved.`);
  }

  // Refresh font cache
  console.log('[Fonts] Running fc-cache...');
  execSync('fc-cache -f', { stdio: 'inherit' });
  console.log('[Fonts] ✅ Plus Jakarta Sans installed successfully.');
}

main().catch((err) => {
  console.error('[Fonts] ❌ Failed to install fonts:', err.message);
  process.exit(1);
});