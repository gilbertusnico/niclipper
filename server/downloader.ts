import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadsDir = path.resolve(__dirname, '..', 'downloads');

/** Cari executable yt-dlp yang tersedia — prefer python module over binary */
function findYtDlp(): { cmd: string; args: string[] } {
  // Coba python3 -m yt_dlp dulu (gak pake PyInstaller binary, lebih stabil di macOS)
  try {
    execSync('python3 -m yt_dlp --version 2>/dev/null', { stdio: 'pipe', timeout: 5000 });
    return { cmd: 'python3', args: ['-m', 'yt_dlp'] };
  } catch {
    // Fallback ke binary
    return { cmd: 'yt-dlp', args: [] };
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

/** Validate that an mp4 file is playable using ffprobe */
function isValidMp4(filePath: string): boolean {
  try {
    execSync(`ffprobe -v quiet -print_format json -show_format "${filePath}"`, {
      stdio: 'pipe',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

export function getVideoInfo(url: string): Promise<{ title: string; duration: number; videoId: string }> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return Promise.reject(new Error('Invalid YouTube URL. Periksa URL dan coba lagi.'));
  }

  const { cmd, args } = findYtDlp();

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, [
      ...args,
      '--print', '%(title)s',
      '--print', '%(duration)s',
      '--no-warnings',
      url,
    ]);

    let stdout = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Gagal mendapatkan info video (exit code ${code})`));
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

  const { cmd, args } = findYtDlp();

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, [
      ...args,
      '-f', 'best[ext=mp4]/best',
      '-o', finalPath,
      '--no-warnings',
      '--newline',
      '--progress-template', 'download:%(progress._percent_str)s',
      url,
    ]);

    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      // yt-dlp outputs progress lines like "download: 45.3%"
      const match = text.match(/download:\s*([\d.]+)%/);
      if (match && onProgress) {
        const pct = Math.round(parseFloat(match[1]));
        onProgress(Math.min(pct, 99));
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

      // Verify the downloaded file is valid
      if (!isValidMp4(finalPath)) {
        reject(new Error('File hasil download corrupt, coba lagi.'));
        return;
      }

      console.log(`[Downloader] Download complete: ${finalPath}`);
      onProgress?.(100);
      resolve(finalPath);
    });
  });
}