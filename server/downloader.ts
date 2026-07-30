import path from 'path';
import fs from 'fs';
import { spawnSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getFfmpegPath } from './ffmpeg.js';
import { getYtDlpPath } from './ytdlp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadsDir = path.resolve(__dirname, '..', 'downloads');

/**
 * Lightweight MP4 header check — reads the first 12 bytes to verify it's an ftyp box.
 * Works without ffmpeg, so it never throws on missing binaries.
 */
function hasMp4Header(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    // mp4 should have at least 8 bytes + "ftyp" at offset 4
    if (bytesRead < 12) return false;
    return buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70; // 'ftyp'
  } catch {
    return false;
  }
}

/** Validate that an mp4 file is playable using ffmpeg (if available) */
function validateWithFfmpeg(filePath: string): boolean {
  const ffmpegBin = getFfmpegPath();
  if (!ffmpegBin) return false;

  // Quick probe with -t 1 — only decodes 1 second, very fast
  const result = spawnSync(ffmpegBin, ['-v', 'error', '-i', filePath, '-f', 'null', '-t', '1', '-'], {
    stdio: 'pipe',
    timeout: 30_000,
  });

  return result.status === 0;
}

/** Validate a downloaded video file — uses mp4 header check + ffmpeg if available */
function isValidVideo(filePath: string): boolean {
  // Step 1: Check file exists and has content
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 1024) {
      console.warn(`[Downloader] File too small or missing: ${filePath} (${stat.size} bytes)`);
      return false;
    }
  } catch (err) {
    console.warn(`[Downloader] Cannot stat file: ${filePath}`, err);
    return false;
  }

  // Step 2: Check MP4 header
  if (!hasMp4Header(filePath)) {
    console.warn(`[Downloader] No MP4 header found: ${filePath}`);
    return false;
  }

  // Step 3: Optional ffmpeg deep validation (if binary available)
  const ffmpegBin = getFfmpegPath();
  if (ffmpegBin) {
    const ffmpegOk = validateWithFfmpeg(filePath);
    if (!ffmpegOk) {
      console.warn(`[Downloader] ffmpeg validation failed but header OK, continuing anyway: ${filePath}`);
      // Don't fail just because ffmpeg isn't available — header check is sufficient
    }
  } else {
    console.log(`[Downloader] ffmpeg not available, relying on header check only`);
  }

  return true;
}

/** Extract YouTube video ID from various URL formats */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function getVideoInfo(url: string): Promise<{ title: string; duration: number; videoId: string }> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return Promise.reject(new Error('Invalid YouTube URL. Periksa URL dan coba lagi.'));
  }

  return new Promise((resolve, reject) => {
    const ytDlpBin = getYtDlpPath();
    const ffmpegBin = getFfmpegPath() || '/usr/local/bin/ffmpeg';
    const proc = spawn(ytDlpBin, [
      '--print', '%(title)s',
      '--print', '%(duration)s',
      '--ffmpeg-location', ffmpegBin,
      '--extractor-args', 'youtube:player_client=web;skip=webpage',
      '--no-warnings',
      '--ignore-errors',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      url,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}. Pastikan yt-dlp terinstall dengan benar.`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.trim().split('\n').filter(l => !l.startsWith('[debug]') && !l.startsWith('[info]')).pop() || stderr.trim();
        reject(new Error(`Gagal mendapatkan info video: ${msg || `exit code ${code}`}`));
        return;
      }
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) {
        reject(new Error('Gagal membaca info video'));
        return;
      }
      resolve({
        title: lines[0],
        duration: parseInt(lines[1], 10) || 0,
        videoId,
      });
    });
  });
}

export async function downloadVideo(
  url: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL. Periksa URL dan coba lagi.');
  }

  // Pastikan folder downloads ada
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const finalPath = path.join(downloadsDir, `${videoId}.mp4`);

  // Skip jika sudah pernah di-download dan file valid
  if (fs.existsSync(finalPath)) {
    if (isValidVideo(finalPath)) {
      console.log(`[Downloader] Valid file already exists: ${finalPath}`);
      onProgress?.(100);
      return finalPath;
    }
    console.log(`[Downloader] Corrupt file found, re-downloading: ${finalPath}`);
    fs.unlinkSync(finalPath);
  }

  console.log(`[Downloader] Starting download for video ${videoId}...`);

  return new Promise((resolve, reject) => {
    // Download best quality mp4 with both audio and video
    const outputTemplate = path.join(downloadsDir, `${videoId}.%(ext)s`);
    const ytDlpBin = getYtDlpPath();
    const ffmpegBin = getFfmpegPath() || '/usr/local/bin/ffmpeg';
    const proc = spawn(ytDlpBin, [
      '-f', 'bv*+ba/b/best',
      '--format-sort', 'res:1080,ext:mp4:m4a',
      '-o', outputTemplate,
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', ffmpegBin,
      '--extractor-args', 'youtube:player_client=web;skip=webpage',
      '--retries', '10',
      '--extractor-retries', '10',
      '--no-warnings',
      '--newline',
      '--ignore-errors',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      url,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    // Parse progress from yt-dlp's default output format
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (onProgress) {
        const match = text.match(/\[download\]\s+([\d.]+)%/);
        if (match) {
          const pct = Math.round(parseFloat(match[1]));
          onProgress(Math.min(pct, 99));
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}. Pastikan yt-dlp terinstall dengan benar.`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.trim().split('\n').filter(l => !l.startsWith('[debug]') && !l.startsWith('[info]')).pop() || stderr;
        reject(new Error(`Download gagal: ${msg}`));
        return;
      }

      // Cari file dengan ekstensi apapun yang cocok dengan videoId
      const findFile = (retries: number): void => {
        try {
          const files = fs.readdirSync(downloadsDir);
          const videoFile = files.find(f => f.startsWith(videoId) && (f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm')));
          if (!videoFile) {
            if (retries > 0) {
              setTimeout(() => findFile(retries - 1), 1000);
              return;
            }
            reject(new Error('File hasil download tidak ditemukan, coba lagi.'));
            return;
          }

          const actualPath = path.join(downloadsDir, videoFile);

          // Verify the downloaded file is valid (header check + optional ffmpeg)
          if (!isValidVideo(actualPath)) {
            // Coba rename ke .mp4 jika belum
            if (actualPath !== finalPath) {
              try {
                fs.renameSync(actualPath, finalPath);
                if (isValidVideo(finalPath)) {
                  console.log(`[Downloader] Download complete (after rename): ${finalPath}`);
                  onProgress?.(100);
                  resolve(finalPath);
                  return;
                }
              } catch { /* ok */ }
            }
            if (retries > 0) {
              console.log(`[Downloader] File invalid, retrying... (${retries} retries left)`);
              setTimeout(() => findFile(retries - 1), 1000);
            } else {
              reject(new Error('File hasil download corrupt, coba lagi.'));
            }
            return;
          }

          // Rename ke format baku .mp4 jika perlu
          if (actualPath !== finalPath) {
            try {
              fs.renameSync(actualPath, finalPath);
            } catch { /* ok */ }
          }

          console.log(`[Downloader] Download complete: ${finalPath}`);
          onProgress?.(100);
          resolve(finalPath);
        } catch (err) {
          if (retries > 0) {
            setTimeout(() => findFile(retries - 1), 1000);
          } else {
            reject(new Error(`Gagal memverifikasi download: ${err instanceof Error ? err.message : 'unknown error'}`));
          }
        }
      };

      // Tunggu sebentar lalu cari file
      setTimeout(() => findFile(5), 1000);
    });
  });
}