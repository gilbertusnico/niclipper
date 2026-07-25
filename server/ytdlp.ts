/**
 * yt-dlp binary path resolver.
 * Prioritizes the bundled binary from youtube-dl-exec (npm package),
 * falls back to 'yt-dlp' in PATH.
 */
import { constants } from 'youtube-dl-exec';
import { execSync } from 'child_process';
import fs from 'fs';

let cachedPath: string | null = null;

/** Get the path to yt-dlp binary, checking bundled first, then PATH */
export function getYtDlpPath(): string {
  if (cachedPath) return cachedPath;

  // Try 1: Bundled binary from youtube-dl-exec
  try {
    const bundledPath = constants.YOUTUBE_DL_PATH;
    if (bundledPath) {
      fs.accessSync(bundledPath, fs.constants.X_OK);
      // Quick sanity check: run --version
      execSync(`"${bundledPath}" --version 2>&1`, { timeout: 5000, stdio: 'pipe' });
      cachedPath = bundledPath;
      console.log(`[yt-dlp] Using bundled binary: ${bundledPath}`);
      return bundledPath;
    }
  } catch {
    // Bundled binary not available, fall through
  }

  // Try 2: yt-dlp in PATH
  try {
    const whichPath = execSync('which yt-dlp 2>/dev/null || where yt-dlp 2>nul', {
      timeout: 3000,
      encoding: 'utf-8',
    }).trim();
    if (whichPath) {
      execSync(`"${whichPath}" --version 2>&1`, { timeout: 5000, stdio: 'pipe' });
      cachedPath = whichPath;
      console.log(`[yt-dlp] Using system binary: ${whichPath}`);
      return whichPath;
    }
  } catch {
    // Not in PATH, fall through
  }

  // Try 3: Common install locations
  const commonPaths = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/opt/yt-dlp/bin/yt-dlp',
  ];
  for (const p of commonPaths) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      execSync(`"${p}" --version 2>&1`, { timeout: 5000, stdio: 'pipe' });
      cachedPath = p;
      console.log(`[yt-dlp] Using common path: ${p}`);
      return p;
    } catch {
      continue;
    }
  }

  // Give up
  console.warn('[yt-dlp] Binary not found via any method');
  return 'yt-dlp'; // last resort — will likely fail with clear error
}

/** Check if yt-dlp is available */
export function isYtDlpAvailable(): boolean {
  try {
    getYtDlpPath();
    return true;
  } catch {
    return false;
  }
}