/**
 * Raw FFmpeg utility — no dependency on fluent-ffmpeg (which needs ffprobe).
 * Uses spawn() directly with the ffmpeg binary from ffmpeg-static or system.
 */

import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

let _ffmpegPath: string | null = null;

/** Resolve ffmpeg binary path — tries ffmpeg-static first, then system ffmpeg */
export function getFfmpegPath(): string | null {
  if (_ffmpegPath !== null) return _ffmpegPath;

  // Try 1: ffmpeg-static (npm package) — static import
  if (ffmpegPath && typeof ffmpegPath === 'string' && ffmpegPath.length > 0) {
    _ffmpegPath = ffmpegPath.replace(/\\/g, '/');
    console.log(`[FFmpeg] Using ffmpeg-static: ${_ffmpegPath}`);
    return _ffmpegPath;
  }

  // Try 2: System ffmpeg
  _ffmpegPath = 'ffmpeg';
  console.log(`[FFmpeg] ffmpeg-static not found, using system ffmpeg`);
  return _ffmpegPath;
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
      reject(new Error('FFmpeg binary not found. Install ffmpeg or ffmpeg-static.'));
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
      reject(new Error(`FFmpeg not found: ${err.message}. Install ffmpeg or ffmpeg-static.`));
    });
  });
}