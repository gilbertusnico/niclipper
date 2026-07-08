import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadsDir = path.resolve(__dirname, '..', 'downloads');

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

  const outputTemplate = path.join(downloadsDir, `${videoId}.%(ext)s`);
  const finalPath = path.join(downloadsDir, `${videoId}.mp4`);

  // Skip jika sudah pernah di-download
  if (fs.existsSync(finalPath)) {
    console.log(`[Downloader] File already exists: ${finalPath}`);
    onProgress?.(100);
    return finalPath;
  }

  console.log(`[Downloader] Starting yt-dlp for video ${videoId}...`);

  return new Promise((resolve, reject) => {
    const args = [
      url,
      '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      '--no-warnings',
      '--progress', '--newline',
    ];

    const proc = spawn('yt-dlp', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', () => {
      // yt-dlp uses stdout for --print output only; we don't need it
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const output = chunk.toString();

      // yt-dlp outputs progress on stderr: "[download]  45.2% of ..."
      const progressMatch = output.match(/(\d+\.?\d*)%/);
      if (progressMatch && onProgress) {
        const pct = parseFloat(progressMatch[1]);
        onProgress(Math.min(pct, 99));
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[Downloader] Download complete: ${finalPath}`);
        onProgress?.(100);
        resolve(finalPath);
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}. Pastikan yt-dlp sudah terinstall.`));
    });
  });
}