import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import ytdl from '@distube/ytdl-core';

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

  const finalPath = path.join(downloadsDir, `${videoId}.mp4`);

  // Skip jika sudah pernah di-download
  if (fs.existsSync(finalPath)) {
    console.log(`[Downloader] File already exists: ${finalPath}`);
    onProgress?.(100);
    return finalPath;
  }

  console.log(`[Downloader] Starting download for video ${videoId}...`);

  return new Promise((resolve, reject) => {
    const stream = ytdl(url, {
      quality: 'highest',
      filter: 'audioandvideo',
    });

    let infoEmitted = false;

    stream.on('info', (info, format) => {
      infoEmitted = true;
      console.log(`[Downloader] Title: "${info.videoDetails.title}"`);
      console.log(`[Downloader] Format: ${format.qualityLabel || 'N/A'} ${format.container}`);
    });

    stream.on('progress', (_chunkLen: number, downloaded: number, total: number) => {
      if (total > 0 && onProgress) {
        const pct = Math.round((downloaded / total) * 100);
        onProgress(Math.min(pct, 99));
      }
    });

    stream.on('error', (err: Error) => {
      // If info hasn't been emitted yet, the video might be unavailable
      if (!infoEmitted) {
        reject(new Error(`Tidak bisa mengakses video. YouTube mungkin memblokir request.\n${err.message}`));
      } else {
        reject(new Error(`Download gagal: ${err.message}`));
      }
    });

    const writeStream = fs.createWriteStream(finalPath);

    writeStream.on('error', (err) => {
      reject(new Error(`Gagal menulis file: ${err.message}`));
    });

    writeStream.on('finish', () => {
      console.log(`[Downloader] Download complete: ${finalPath}`);
      onProgress?.(100);
      resolve(finalPath);
    });

    stream.pipe(writeStream);
  });
}