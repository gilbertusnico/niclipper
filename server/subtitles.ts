/**
 * Subtitle utilities for Niclipper
 *
 * Parses the Whisper timestamped transcript format and generates
 * ASS (Advanced SubStation Alpha) subtitle files with TikTok-style
 * formatting: bold white text with black outline, centered.
 */

import fs from 'fs';
import path from 'path';

export interface SubtitleSegment {
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

/**
 * Parse the transcript string into timed subtitle segments.
 *
 * Expected input format:
 *   [TIMESTAMP: 0.0 -> 2.5]
 *   Halo semuanya
 *
 *   [TIMESTAMP: 2.5 -> 5.0]
 *   Selamat datang di channel saya
 *
 * @param transcript - Raw transcript from the transcriber
 * @returns Array of parsed subtitle segments
 */
export function parseTranscriptToSegments(transcript: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  const lines = transcript.split('\n');

  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let currentTextLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Check for timestamp marker
    const tsMatch = line.match(/\[TIMESTAMP:\s*([\d.]+)\s*->\s*([\d.]+)\s*\]/);
    if (tsMatch) {
      // If we were building a previous segment, push it
      if (currentStart !== null && currentTextLines.length > 0) {
        segments.push({
          start: currentStart,
          end: currentEnd ?? currentStart,
          text: currentTextLines.join(' ').replace(/\s+/g, ' ').trim(),
        });
      }

      currentStart = parseFloat(tsMatch[1]);
      currentEnd = parseFloat(tsMatch[2]);
      currentTextLines = [];
      continue;
    }

    // Skip empty lines and non-text lines
    if (line === '' || line.startsWith('[')) continue;

    // Accumulate text
    if (currentStart !== null) {
      currentTextLines.push(line);
    }
  }

  // Don't forget the last segment
  if (currentStart !== null && currentTextLines.length > 0) {
    segments.push({
      start: currentStart,
      end: currentEnd ?? currentStart,
      text: currentTextLines.join(' ').replace(/\s+/g, ' ').trim(),
    });
  }

  return segments;
}

/**
 * Format seconds to ASS time format: H:MM:SS.cc (centiseconds)
 */
function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds - Math.floor(seconds)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Escape text for ASS format.
 * ASS uses braces {} for tags and curly braces \{ to escape.
 * We need to escape: {, }, and newlines.
 */
function escapeAssText(text: string): string {
  return text
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');
}

/**
 * Generate an ASS subtitle file content for TikTok-style subtitles.
 *
 * TikTok style = bold white text with thick black outline, centered.
 * Uses Arial Bold which is available on virtually every system.
 *
 * @param segments - Timed subtitle segments
 * @param width - Video width (default 1080)
 * @param height - Video height (default 1920)
 * @returns ASS file content as a string
 */
export function generateAssContent(
  segments: SubtitleSegment[],
  width: number = 1080,
  height: number = 1920,
): string {
  // ─── Script Info ──────────────────────────────────────────────
  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    '',
  ];

  // ─── Styles ───────────────────────────────────────────────────
  // TikTok-style: Arial Bold, white fill, thick black outline, no shadow
  // Color format in ASS: AABBGGRR (hex)
  // PrimaryColour: &H00FFFFFF  = white
  // OutlineColour: &H00000000  = black
  // Bold: -1 = yes
  // BorderStyle: 1 = outline
  // Outline: 4.0 = thickness
  // Shadow: 0
  // Alignment: 2 = bottom center
  // MarginV: ~640 = position text at about 1/3 from bottom of a 1920-height video
  // (1920 / 3 ≈ 640px from bottom edge — gives a nice elevated look)
  lines.push(
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: TikTok,Arial,68,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,1,3.5,0,2,50,50,640,1',
    '',
  );

  // ─── Events (Dialogue) ────────────────────────────────────────
  lines.push('[Events]');
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  for (const seg of segments) {
    const start = formatAssTime(seg.start);
    const end = formatAssTime(seg.end);
    const text = escapeAssText(seg.text);
    lines.push(`Dialogue: 0,${start},${end},TikTok,,0,0,0,,${text}`);
  }

  return lines.join('\n');
}

/**
 * Write an ASS subtitle file to disk from transcript segments.
 *
 * @param segments - Timed subtitle segments (already filtered & offset for the clip)
 * @param outputPath - Path where the .ass file should be written
 * @param width - Video width
 * @param height - Video height
 */
export function writeAssFile(
  segments: SubtitleSegment[],
  outputPath: string,
  width: number = 1080,
  height: number = 1920,
): void {
  const content = generateAssContent(segments, width, height);
  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`[Subtitles] ASS file written: ${outputPath} (${segments.length} segments)`);
}

/**
 * Filter segments to those within a given time window and offset them
 * so the window starts at 0.
 *
 * Example: clip from 10s to 20s
 *   A segment at 12.5s→14.0s becomes 2.5s→4.0s
 *   A segment at 9.0s→11.0s becomes 0s→1.0s (clamped)
 *
 * @param segments - All transcript segments
 * @param clipStart - Clip start time in seconds
 * @param clipEnd - Clip end time in seconds
 * @returns Filtered and offset segments
 */
export function filterSegmentsForClip(
  segments: SubtitleSegment[],
  clipStart: number,
  clipEnd: number,
): SubtitleSegment[] {
  const clipDuration = clipEnd - clipStart;

  return segments
    .filter((seg) => seg.end > clipStart && seg.start < clipEnd)
    .map((seg) => ({
      start: Math.max(0, seg.start - clipStart),
      end: Math.min(clipDuration, seg.end - clipStart),
      text: seg.text,
    }))
    .filter((seg) => seg.end > seg.start && seg.text.length > 0);
}