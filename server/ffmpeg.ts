/**
 * Raw FFmpeg utility — no dependency on fluent-ffmpeg (which needs ffprobe).
 * Uses spawn() directly with the ffmpeg binary.
 *
 * Priority: system FFmpeg (from PATH) → ffmpeg-static (npm fallback)
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

let _ffmpegPath: string | null = null;

/** Resolve ffmpeg binary path — system FFmpeg first, then ffmpeg-static as fallback */
export function getFfmpegPath(): string | null {
  if (_ffmpegPath !== null) return _ffmpegPath;

  // Try 1: System FFmpeg (dari PATH)
  try {
    const whichPath = execSync('which ffmpeg 2>/dev/null || where ffmpeg 2>nul', {
      timeout: 3000,
      encoding: 'utf-8',
    }).trim();
    if (whichPath) {
      // Sanity check: run -version
      execSync(`"${whichPath}" -version 2>&1`, { timeout: 5000, stdio: 'pipe' });
      _ffmpegPath = whichPath;
      console.log(`[FFmpeg] Using system FFmpeg: ${_ffmpegPath}`);
      return _ffmpegPath;
    }
  } catch {
    // Not in PATH, fall through
  }

  // Try 2: Common install locations (Linux/macOS)
  const commonPaths = [
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
  ];
  for (const p of commonPaths) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      execSync(`"${p}" -version 2>&1`, { timeout: 5000, stdio: 'pipe' });
      _ffmpegPath = p;
      console.log(`[FFmpeg] Using system FFmpeg: ${_ffmpegPath}`);
      return _ffmpegPath;
    } catch {
      continue;
    }
  }

  // Try 3: ffmpeg-static (npm fallback) — synchronous via createRequire
  try {
    const ffmpegStatic = _require('ffmpeg-static');
    // ffmpeg-static exports the binary path as a string (default export)
    const staticPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : (ffmpegStatic.default || ffmpegStatic);
    if (staticPath && typeof staticPath === 'string' && staticPath.length > 0) {
      _ffmpegPath = staticPath.replace(/\\/g, '/');
      console.log(`[FFmpeg] ffmpeg-static fallback: ${_ffmpegPath}`);
      return _ffmpegPath;
    }
  } catch {
    // ffmpeg-static not available
  }

  // Give up
  console.warn('[FFmpeg] Binary not found via any method');
  _ffmpegPath = 'ffmpeg'; // last resort — will likely fail with clear error
  return _ffmpegPath;
}

/**
 * Check if FFmpeg is available.
 */
export function isFfmpegAvailable(): boolean {
  try {
    return getFfmpegPath() !== null;
  } catch {
    return false;
  }
}

/**
 * Check whether the current FFmpeg build exposes a specific filter.
 * Some minimal macOS installs omit subtitle/drawtext filters entirely.
 */
export function hasFfmpegFilter(filterName: string): boolean {
  try {
    const ffmpegBin = getFfmpegPath();
    if (!ffmpegBin) return false;
    const output = execSync(`"${ffmpegBin}" -hide_banner -filters 2>&1`, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.toLowerCase().includes(filterName.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Run FFmpeg with the given arguments and track progress.
 *
 * Progress is calculated by parsing the `time=HH:MM:SS.MS` lines ffmpeg
 * writes to stderr. Pass `totalDuration` (in seconds) to get percentage
 * callbacks. If totalDuration is omitted, no progress is reported.
 *
 * @param args      - FFmpeg CLI arguments (e.g. ['-i', 'in.mp4', '-c:v', 'libx264', 'out.mp4'])
 * @param options   - Optional config
 * @param options.totalDuration - Total duration in seconds (for progress calculation)
 * @param options.onProgress   - Callback receiving 0-100 progress
 * @param options.timeout     - Max runtime in ms (default: none)
 */
export function runFfmpeg(
  args: string[],
  options?: {
    totalDuration?: number;
    onProgress?: (percent: number) => void;
    timeout?: number;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffmpegBin = getFfmpegPath();
    if (!ffmpegBin) {
      reject(new Error('FFmpeg binary not found. Install ffmpeg via apt/brew/choco.'));
      return;
    }

    const proc = spawn(ffmpegBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let timedOut = false;

    const timer = options?.timeout
      ? setTimeout(() => {
          timedOut = true;
          proc.kill('SIGTERM');
          reject(new Error(`FFmpeg timed out after ${(options.timeout! / 1000).toFixed(0)}s`));
        }, options.timeout)
      : null;

    proc.stderr?.on('data', (chunk: Buffer) => {
      const output = chunk.toString();
      stderr += output;

      // Parse time=HH:MM:SS.MS for progress tracking
      if (options?.onProgress && options.totalDuration && options.totalDuration > 0) {
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseInt(timeMatch[3], 10);
          const centi = parseInt(timeMatch[4], 10);
          const currentTime = hours * 3600 + minutes * 60 + seconds + centi / 100;
          const pct = Math.round((currentTime / options.totalDuration) * 100);
          options.onProgress(Math.min(pct, 99));
        }
      }
    });

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return;

      if (code === 0) {
        options?.onProgress?.(100);
        resolve(stderr);
      } else {
        // ffmpeg -i with no output file exits with code 1 — that's expected
        // Only treat it as an error if we actually had arguments beyond -i
        const hasOutput = args.some((a) => !a.startsWith('-') && !a.startsWith('http'));
        if (code === 1 && !hasOutput) {
          // This is just a probe (-i without output), not a real error
          options?.onProgress?.(100);
          resolve(stderr);
        } else {
          reject(new Error(stderr.slice(-500).trim()));
        }
      }
    });

    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`FFmpeg not found: ${err.message}. Install ffmpeg via apt/brew/choco.`));
    });
  });
}