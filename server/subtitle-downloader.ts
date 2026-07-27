/**
 * YouTube Subtitle Downloader
 *
 * Downloads existing subtitles/captions from YouTube via yt-dlp.
 * Much faster than Whisper transcription (1-2 seconds instead of 10+ minutes).
 * Falls back gracefully if no subtitles are available.
 *
 * Priority order: manual subtitles > auto-generated captions
 * Language priority: id (Indonesian) > en (English)
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getYtDlpPath } from './ytdlp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = path.resolve(__dirname, '..', 'temp');

/**
 * Try to download YouTube subtitles and return a timestamped transcript.
 *
 * Strategy:
 *  1. Try manual subtitles first (better quality) — id, then en
 *  2. Try auto-generated captions — id, then en
 *  3. If all fail, return null (caller falls back to Whisper)
 *
 * @returns Transcript string in `[TIMESTAMP: start -> end]\ntext` format, or null
 */
export async function downloadYouTubeSubtitles(url: string): Promise<string | null> {
  const videoId = extractVideoId(url);
  if (!videoId) return null;

  // Ensure temp dir exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Try languages in priority order: id (Indonesian) → en (English)
  const languages = ['id', 'en', 'in']; // 'in' is old ISO code for Indonesian

  // Strategy 1: Manual subtitles (--write-subs)
  for (const lang of languages) {
    try {
      const result = await tryDownloadSubs(url, videoId, lang, false);
      if (result) {
        console.log(`[SubtitleDownloader] Got manual subtitles (${lang})`);
        return result;
      }
    } catch {
      // continue to next language
    }
  }

  // Strategy 2: Auto-generated captions (--write-auto-subs)
  for (const lang of languages) {
    try {
      const result = await tryDownloadSubs(url, videoId, lang, true);
      if (result) {
        console.log(`[SubtitleDownloader] Got auto-generated captions (${lang})`);
        return result;
      }
    } catch {
      // continue to next language
    }
  }

  console.log('[SubtitleDownloader] No subtitles available for this video');
  return null;
}

/**
 * Attempt to download subtitles with specific parameters.
 * Returns parsed transcript string or null.
 */
async function tryDownloadSubs(
  url: string,
  videoId: string,
  lang: string,
  auto: boolean,
): Promise<string | null> {
  const ytDlpBin = getYtDlpPath();
  const outputBase = path.join(tempDir, `subs_${videoId}_${lang}${auto ? '_auto' : ''}`);

  // Clean up any previous subtitle files for this video/lang
  cleanupSubtitleFiles(videoId, lang, auto);

  const args: string[] = [
    auto ? '--write-auto-subs' : '--write-subs',
    '--sub-lang', lang,
    '--skip-download',        // Don't download the video — just subs
    '--sub-format', 'vtt',    // WebVTT format (easy to parse)
    '--convert-subs', 'vtt',  // Convert to VTT if needed
    '--output', `${outputBase}.%(ext)s`,
    '--no-warnings',
    '--ignore-errors',
    '--extractor-args', 'youtube:player_client=android',
    '--user-agent', 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    url,
  ];

  return new Promise((resolve) => {
    const proc = spawn(ytDlpBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000, // Should be fast — just downloading a few KB
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', () => {
      resolve(null); // yt-dlp not available
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const logMsg = stderr.trim().split('\n').filter(l =>
          !l.startsWith('[debug]') && !l.startsWith('[info]')
        ).pop() || stderr.trim();
        console.log(`[SubtitleDownloader] yt-dlp exit code ${code} for ${lang}: ${logMsg.slice(0, 200)}`);
        resolve(null);
        return;
      }

      // Find the downloaded subtitle file
      try {
        const files = fs.readdirSync(tempDir);
        const subFile = files.find(f =>
          f.startsWith(`subs_${videoId}_${lang}${auto ? '_auto' : ''}`) &&
          (f.endsWith('.vtt') || f.endsWith('.srt')),
        );

        if (!subFile) {
          resolve(null);
          return;
        }

        const subPath = path.join(tempDir, subFile);
        const transcript = parseSubtitleFile(subPath, subFile);

        // Clean up the subtitle file (we have the transcript in memory)
        try { fs.unlinkSync(subPath); } catch { /* ignore */ }

        resolve(transcript);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Parse a subtitle file (VTT or SRT) into the timestamped transcript format.
 * Format: `[TIMESTAMP: start -> end]\ntext`
 */
function parseSubtitleFile(filePath: string, filename: string): string | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.vtt') {
    return parseVtt(content);
  } else if (ext === '.srt') {
    return parseSrt(content);
  }

  return null;
}

/**
 * Parse WebVTT format into timestamped transcript segments.
 *
 * VTT format:
 * ```
 * WEBVTT
 * Kind: captions
 * Language: en
 *
 * 00:00:00.000 --> 00:00:02.500
 * <v Speaker>Hello everyone</v>
 *
 * 00:00:02.500 --> 00:00:05.000
 * Welcome to my channel
 * ```
 */
function parseVtt(content: string): string | null {
  // Remove header (everything before first timestamp line)
  const lines = content.split('\n');
  const segments: string[] = [];
  let currentStart = '';
  let currentEnd = '';
  let currentText: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header and metadata
    if (trimmed === 'WEBVTT' || trimmed.startsWith('Kind:') || trimmed.startsWith('Language:') || trimmed === '') {
      continue;
    }

    // Check for timestamp line: 00:00:00.000 --> 00:00:02.500
    const timestampMatch = trimmed.match(
      /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/,
    );

    if (timestampMatch) {
      // Save previous segment if exists
      if (currentStart && currentText.length > 0) {
        const text = currentText
          .join(' ')
          .replace(/<[^>]+>/g, '')  // Remove VTT tags like <v Speaker>
          .replace(/\s+/g, ' ')
          .trim();
        if (text) {
          const startSec = vttTimestampToSeconds(currentStart);
          const endSec = vttTimestampToSeconds(currentEnd);
          segments.push(`[TIMESTAMP: ${startSec.toFixed(1)} -> ${endSec.toFixed(1)}]\n${text}`);
        }
      }

      currentStart = timestampMatch[1];
      currentEnd = timestampMatch[2];
      currentText = [];
    } else if (currentStart && trimmed) {
      // Skip cue identifiers (numbers like "1", "2", etc.)
      if (!/^\d+$/.test(trimmed)) {
        currentText.push(trimmed);
      }
    }
  }

  // Save last segment
  if (currentStart && currentText.length > 0) {
    const text = currentText
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      const startSec = vttTimestampToSeconds(currentStart);
      const endSec = vttTimestampToSeconds(currentEnd);
      segments.push(`[TIMESTAMP: ${startSec.toFixed(1)} -> ${endSec.toFixed(1)}]\n${text}`);
    }
  }

  if (segments.length === 0) return null;
  return segments.join('\n\n');
}

/**
 * Parse SRT format (less common, but may be returned by yt-dlp).
 * SRT format:
 * ```
 * 1
 * 00:00:00,000 --> 00:00:02,500
 * Hello everyone
 *
 * 2
 * 00:00:02,500 --> 00:00:05,000
 * Welcome to my channel
 * ```
 */
function parseSrt(content: string): string | null {
  const blocks = content.trim().split(/\n\n+/);
  const segments: string[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // Line 1: cue number (skip)
    // Line 2: timestamp
    const timestampLine = lines[0].includes('-->') ? lines[0] : lines[1];
    const textLines = lines.filter(l => !l.includes('-->') && !/^\d+$/.test(l.trim()));

    const timestampMatch = timestampLine.match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    );

    if (!timestampMatch) continue;

    const start = timestampMatch[1].replace(',', '.');
    const end = timestampMatch[2].replace(',', '.');
    const text = textLines.join(' ').replace(/\s+/g, ' ').trim();

    if (text) {
      const startSec = vttTimestampToSeconds(start);
      const endSec = vttTimestampToSeconds(end);
      segments.push(`[TIMESTAMP: ${startSec.toFixed(1)} -> ${endSec.toFixed(1)}]\n${text}`);
    }
  }

  if (segments.length === 0) return null;
  return segments.join('\n\n');
}

/**
 * Convert a VTT timestamp (HH:MM:SS.mmm) to seconds.
 */
function vttTimestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    return m * 60 + s;
  }
  return 0;
}

/**
 * Extract YouTube video ID from various URL formats.
 */
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

/**
 * Get transcript for a YouTube video — tries YouTube subtitles first (1-2 seconds),
 * falls back to Whisper transcription (takes longer).
 *
 * @param url - YouTube URL
 * @param videoPath - Path to downloaded video file (for Whisper fallback)
 * @param onProgress - Progress callback
 * @param startTime - Optional start time in seconds (for Whisper segment transcription)
 * @param endTime - Optional end time in seconds
 * @returns Transcript string in timestamped format, or null if both methods fail
 */
export async function getTranscriptForYouTube(
  url: string,
  videoPath: string,
  onProgress: (progress: number, detail?: string) => void,
  startTime?: number,
  endTime?: number,
): Promise<string | null> {
  // Step 1: Try YouTube subtitles (super fast — 1-2 seconds)
  onProgress(5, 'Checking YouTube subtitles...');
  console.log('[Transcript] Trying YouTube subtitles first (lightning fast)...');

  try {
    const youtubeSubs = await downloadYouTubeSubtitles(url);
    if (youtubeSubs) {
      const segmentCount = youtubeSubs.split('[TIMESTAMP:').length - 1;
      console.log(`[Transcript] Got YouTube subtitles! ${segmentCount} segments, ${youtubeSubs.length} chars`);
      onProgress(100, `YouTube subtitles loaded (${segmentCount} segments)`);
      return youtubeSubs;
    }
    console.log('[Transcript] No YouTube subtitles available, falling back to Whisper...');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.log(`[Transcript] YouTube subtitle download failed: ${msg}. Falling back to Whisper...`);
  }

  // Step 2: Fall back to Whisper transcription
  onProgress(10, 'YouTube subtitles not available, using AI transcription...');
  console.log('[Transcript] Falling back to Whisper AI transcription...');

  // Dynamic import to avoid loading the heavy module if not needed
  const { transcribeAudio } = await import('./transcriber.js');
  try {
    const transcript = await transcribeAudio(videoPath, onProgress, startTime, endTime);
    return transcript;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Transcription failed';
    console.warn(`[Transcript] Whisper transcription also failed: ${msg}`);
    return null;
  }
}

/**
 * Clean up any leftover subtitle files for a video.
 */
function cleanupSubtitleFiles(videoId: string, lang: string, auto: boolean): void {
  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      if (file.startsWith(`subs_${videoId}_${lang}${auto ? '_auto' : ''}`)) {
        try { fs.unlinkSync(path.join(tempDir, file)); } catch { /* ignore */ }
      }
    }
  } catch {
    // temp dir may not exist
  }
}