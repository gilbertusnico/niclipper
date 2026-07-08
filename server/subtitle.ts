import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { ViralMoment } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const subtitlesDir = path.resolve(__dirname, '..', 'subtitles');

interface TranscriptSegment {
  startTime: number;
  endTime: number;
  text: string;
}

/**
 * Generate an SRT subtitle file for a specific clip.
 * @param transcript - The full video transcript text
 * @param moment - The viral moment with start/end times
 * @param clipIndex - 1-based index of the clip
 */
export async function generateSubtitles(
  transcript: string,
  moment: ViralMoment,
  clipIndex: number,
): Promise<void> {
  // Ensure subtitles directory exists
  if (!fs.existsSync(subtitlesDir)) {
    fs.mkdirSync(subtitlesDir, { recursive: true });
  }

  // Parse the transcript into segments
  const segments = parseTranscript(transcript);

  // Filter segments that fall within the clip's time range
  const clipStart = moment.startTime;
  const clipEnd = moment.endTime;

  const relevantSegments = segments.filter((seg) => {
    return seg.startTime < clipEnd && seg.endTime > clipStart;
  });

  if (relevantSegments.length === 0) {
    console.log(`[Subtitles] No transcript segments found for clip ${clipIndex} (${clipStart}s - ${clipEnd}s)`);
    // Create an empty subtitle file (no subtitles)
    const srtContent = '1\n00:00:01,000 --> 00:00:02,000\n...\n\n';
    const outputPath = path.join(subtitlesDir, `clip_${clipIndex}.srt`);
    fs.writeFileSync(outputPath, srtContent, 'utf-8');
    return;
  }

  // Build SRT content with timestamps relative to the clip start
  const srtLines: string[] = [];
  let counter = 1;

  for (const seg of relevantSegments) {
    // Adjust timestamps relative to clip start
    const relativeStart = Math.max(0, seg.startTime - clipStart);
    const relativeEnd = Math.min(clipEnd - clipStart, seg.endTime - clipStart);

    // Skip very short segments
    if (relativeEnd - relativeStart < 0.5) continue;

    srtLines.push(String(counter));
    srtLines.push(formatSrtTime(relativeStart) + ' --> ' + formatSrtTime(relativeEnd));
    srtLines.push(seg.text);
    srtLines.push(''); // Empty line separator
    counter++;
  }

  const srtContent = srtLines.join('\n');
  const outputPath = path.join(subtitlesDir, `clip_${clipIndex}.srt`);
  fs.writeFileSync(outputPath, srtContent, 'utf-8');

  console.log(`[Subtitles] Generated ${counter - 1} subtitle entries for clip ${clipIndex}`);
}

/**
 * Parse transcript text into timed segments.
 * Expects format from transcriber:
 * [TIMESTAMP: 0.0 -> 3.5]
 * Spoken text here
 */
function parseTranscript(transcript: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = transcript.split('\n');

  let currentStart = 0;
  let currentEnd = 0;
  let currentTextLines: string[] = [];
  let inSegment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match timestamp line: [TIMESTAMP: 0.0 -> 3.5]
    const tsMatch = trimmed.match(/\[TIMESTAMP:\s*([\d.]+)\s*->\s*([\d.]+)\]/i);

    if (tsMatch) {
      // Save previous segment if exists
      if (inSegment && currentTextLines.length > 0) {
        segments.push({
          startTime: currentStart,
          endTime: currentEnd,
          text: currentTextLines.join(' '),
        });
      }

      currentStart = parseFloat(tsMatch[1]);
      currentEnd = parseFloat(tsMatch[2]);
      currentTextLines = [];
      inSegment = true;
    } else if (inSegment && trimmed.length > 0 && !trimmed.startsWith('[')) {
      // Accumulate text lines
      currentTextLines.push(trimmed);
    }
  }

  // Save last segment
  if (inSegment && currentTextLines.length > 0) {
    segments.push({
      startTime: currentStart,
      endTime: currentEnd,
      text: currentTextLines.join(' '),
    });
  }

  return segments;
}

/**
 * Format seconds to SRT timestamp format: HH:MM:SS,mmm
 */
function formatSrtTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad3(millis)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}