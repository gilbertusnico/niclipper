import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getFfmpegPath } from './ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadsDir = path.resolve(__dirname, '..', 'downloads');

/** Validate that an mp4 file is playable using ffmpeg (not ffprobe — may not be installed) */
function isValidMp4(filePath: string): boolean {
  try {
    const ffmpegBin = getFfmpegPath();
    // ffmpeg -i reads the file header and exits with code 1 (no output file specified)
    // but if the file is truly invalid, it will error out with a codec error
    execSync(`"${ffmpegBin}" -v error -i "${filePath}" -f null - 2>&1 || true`, {
      stdio: 'pipe',
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
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
    const proc = spawn('yt-dlp', [
      '--print', '%(title)s',
      '--print', '%(duration)s',
      '--no-warnings',
      '--ignore-errors',
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
      reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}`));
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
    if (isValidMp4(finalPath)) {
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
    // Gunakan %(ext)s di output template agar yt-dlp handle extension sendiri
    const outputTemplate = path.join(downloadsDir, `${videoId}.%(ext)s`);
    const proc = spawn('yt-dlp', [
      '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
      '-o', outputTemplate,
      '--no-warnings',
      '--newline',
      url,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    // Parse progress from yt-dlp's default output format
    // yt-dlp outputs lines like: "[download]  45.3% of 133.34MiB at 52.60MiB/s ETA 00:00"
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (onProgress) {
        // Match percentage from yt-dlp's default progress output
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
      reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}`));
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

          // Verify the downloaded file is valid
          if (!isValidMp4(actualPath)) {
            // Coba rename ke .mp4 jika belum
            if (actualPath !== finalPath) {
              try {
                fs.renameSync(actualPath, finalPath);
              } catch { /* ok */ }
            }
            if (!isValidMp4(finalPath)) {
              reject(new Error('File hasil download corrupt, coba lagi.'));
              return;
            }
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