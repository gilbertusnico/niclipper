/**
 * YouTube Subtitle Downloader
 *
 * Downloads existing subtitles/captions from YouTube via yt-dlp.
 * Much faster than Whisper transcription (usually well under a minute).
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
import type { WordTiming } from './subtitles.js';

/** A transcript plus, when the source has them, per-word timings (absolute seconds). */
export interface TranscriptResult {
  transcript: string;
  words?: WordTiming[];
}

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
 * @returns Transcript in `[TIMESTAMP: start -> end]\ntext` format (plus word timings
 *          when YouTube provides them), or null
 */
export async function downloadYouTubeSubtitles(url: string): Promise<TranscriptResult | null> {
  const videoId = extractVideoId(url);
  if (!videoId) return null;

  // Ensure temp dir exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Languages in priority order: id (Indonesian) → en (English)
  const languages = ['id', 'en', 'in']; // 'in' is old ISO code for Indonesian

  // Strategy 1: Manual subtitles (--write-subs)
  const manual = await tryDownloadSubs(url, videoId, languages, false);
  if (manual) {
    console.log(`[SubtitleDownloader] Got manual subtitles (${manual.lang})${wordTimingLabel(manual)}`);
    return manual.result;
  }

  // Strategy 2: Auto-generated captions (--write-auto-subs)
  // The default (web) client returns the raw ASR track with per-word offsets;
  // the android client only returns line-level captions. Try web first, keep
  // android as a fallback in case the web client is blocked.
  const auto = await tryDownloadSubs(url, videoId, languages, true, 'web')
    ?? await tryDownloadSubs(url, videoId, languages, true, 'android');
  if (auto) {
    console.log(`[SubtitleDownloader] Got auto-generated captions (${auto.lang})${wordTimingLabel(auto)}`);
    return auto.result;
  }

  console.log('[SubtitleDownloader] No subtitles available for this video');
  return null;
}

function wordTimingLabel(found: { result: TranscriptResult }): string {
  return found.result.words ? `, ${found.result.words.length} timed words` : ', no word timing';
}

/**
 * Download subtitles for all given languages in a single yt-dlp call
 * (metadata extraction is the slow part, so we only do it once per strategy).
 * Returns the transcript for the highest-priority language that parsed, or null.
 */
async function tryDownloadSubs(
  url: string,
  videoId: string,
  languages: string[],
  auto: boolean,
  client: 'android' | 'web' = 'android',
): Promise<{ lang: string; result: TranscriptResult } | null> {
  const ytDlpBin = getYtDlpPath();
  const prefix = `subs_${videoId}_${auto ? 'auto' : 'manual'}`;
  const outputBase = path.join(tempDir, prefix);

  // Clean up any previous subtitle files for this video/strategy
  cleanupSubtitleFiles(prefix);

  const args: string[] = [
    auto ? '--write-auto-subs' : '--write-subs',
    '--sub-lang', languages.join(','),
    '--skip-download',        // Don't download the video — just subs
    // json3 carries per-word timing for auto-captions (word highlight); VTT as fallback.
    // No --convert-subs: it cannot convert json3 and would replace it with VTT.
    '--sub-format', 'json3/vtt/srt/best',
    '--ignore-no-formats-error', // subtitles only — don't fail on video format checks
    '--output', `${outputBase}.%(ext)s`,
    '--no-warnings',
    '--ignore-errors',
    ...(client === 'android'
      ? [
          '--extractor-args', 'youtube:player_client=android',
          '--user-agent', 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        ]
      : []), // web: yt-dlp's default client and user agent
    url,
  ];

  return new Promise((resolve) => {
    const proc = spawn(ytDlpBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Subtitle files are tiny, but YouTube metadata extraction can take ~1 min
      timeout: 90_000,
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', () => {
      resolve(null); // yt-dlp not available
    });

    proc.on('close', (code, signal) => {
      const kind = `${auto ? 'auto' : 'manual'}, ${client}`;
      if (code === null) {
        console.log(`[SubtitleDownloader] yt-dlp timed out (${kind}, signal ${signal})`);
      } else if (code !== 0) {
        // --ignore-errors: some languages may still have been written, so keep going
        const logMsg = stderr.trim().split('\n').filter(l =>
          !l.startsWith('[debug]') && !l.startsWith('[info]')
        ).pop() || stderr.trim();
        console.log(`[SubtitleDownloader] yt-dlp exit code ${code} (${kind}): ${logMsg.slice(0, 200)}`);
      }

      // Pick the downloaded subtitle file by language priority
      try {
        const files = fs.readdirSync(tempDir).filter(f =>
          f.startsWith(`${prefix}.`) && /\.(json3|vtt|srt)$/.test(f),
        );

        let found: { lang: string; result: TranscriptResult } | null = null;
        for (const lang of languages) {
          const subFile = files.find(f => f.startsWith(`${prefix}.${lang}.`));
          if (!subFile) continue;
          const result = parseSubtitleFile(path.join(tempDir, subFile), subFile);
          if (result) {
            found = { lang, result };
            break;
          }
        }

        // Clean up the subtitle files (we have the transcript in memory)
        cleanupSubtitleFiles(prefix);

        resolve(found);
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
function parseSubtitleFile(filePath: string, filename: string): TranscriptResult | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.json3') {
    return parseJson3(content);
  }
  const transcript = ext === '.vtt' ? parseVtt(content) : ext === '.srt' ? parseSrt(content) : null;
  return transcript ? { transcript } : null;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: { utf8?: string; tOffsetMs?: number }[];
}

/**
 * Parse YouTube's json3 caption format.
 *
 * Each event is one caption line; for auto-captions every seg is one word with
 * `tOffsetMs` relative to the event start:
 * ```
 * { "tStartMs": 120760, "dDurationMs": 1600,
 *   "segs": [{ "utf8": "gua" }, { "utf8": " paham.", "tOffsetMs": 160 }] }
 * ```
 * Manual subtitles have one seg per line and no offsets → no word timing.
 */
function parseJson3(content: string): TranscriptResult | null {
  let events: Json3Event[];
  try {
    events = (JSON.parse(content) as { events?: Json3Event[] }).events ?? [];
  } catch {
    return null;
  }

  const segments: string[] = [];
  const words: WordTiming[] = [];
  let lineCount = 0;
  let timedLineCount = 0;

  for (const ev of events) {
    if (!ev.segs || ev.aAppend || ev.tStartMs === undefined) continue;
    const text = ev.segs.map(s => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const start = ev.tStartMs / 1000;
    const end = (ev.tStartMs + (ev.dDurationMs ?? 0)) / 1000;
    segments.push(`[TIMESTAMP: ${start.toFixed(1)} -> ${end.toFixed(1)}]\n${text}`);

    lineCount++;
    if (ev.segs.some(s => s.tOffsetMs !== undefined)) timedLineCount++;

    // A word lasts until the next word in the line starts; the last one until the line ends
    const lineWords = ev.segs
      .map(s => ({ text: (s.utf8 ?? '').trim(), start: (ev.tStartMs! + (s.tOffsetMs ?? 0)) / 1000 }))
      .filter(w => w.text);
    lineWords.forEach((w, i) => {
      const next = lineWords[i + 1];
      words.push({ start: w.start, end: next ? next.start : Math.max(end, w.start), text: w.text });
    });
  }

  if (segments.length === 0) return null;
  // Only trust word timing when most lines actually have per-word offsets
  const hasWordTiming = timedLineCount > 0 && timedLineCount >= lineCount * 0.5;
  return { transcript: segments.join('\n\n'), ...(hasWordTiming ? { words } : {}) };
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
 * @returns Transcript in timestamped format (plus word timings from YouTube
 *          auto-captions), or null if both methods fail
 */
export async function getTranscriptForYouTube(
  url: string,
  videoPath: string,
  onProgress: (progress: number, detail?: string) => void,
  startTime?: number,
  endTime?: number,
): Promise<TranscriptResult | null> {
  // Step 1: Try YouTube subtitles (super fast — 1-2 seconds)
  onProgress(5, 'Checking YouTube subtitles...');
  console.log('[Transcript] Trying YouTube subtitles first (lightning fast)...');

  try {
    const youtubeSubs = await downloadYouTubeSubtitles(url);
    if (youtubeSubs) {
      const segmentCount = youtubeSubs.transcript.split('[TIMESTAMP:').length - 1;
      console.log(`[Transcript] Got YouTube subtitles! ${segmentCount} segments, ${youtubeSubs.transcript.length} chars`);
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
    return { transcript };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Transcription failed';
    console.warn(`[Transcript] Whisper transcription also failed: ${msg}`);
    return null;
  }
}

/**
 * Clean up any leftover subtitle files for a video.
 */
function cleanupSubtitleFiles(prefix: string): void {
  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      if (file.startsWith(`${prefix}.`)) {
        try { fs.unlinkSync(path.join(tempDir, file)); } catch { /* ignore */ }
      }
    }
  } catch {
    // temp dir may not exist
  }
}