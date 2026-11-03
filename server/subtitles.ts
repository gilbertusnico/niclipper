/**
 * Subtitle utilities for Niclipper
 *
 * Parses the Whisper timestamped transcript format and generates
 * ASS (Advanced SubStation Alpha) subtitle files with TikTok-style
 * formatting: bold white text with black outline, centered.
 */

import fs from 'fs';
import { SUBTITLE_STYLE, wrapSubtitleLines } from './subtitle-style.js';

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
  const lines = transcript.split(/\r?\n/);

  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let currentTextLines: string[] = [];

  const flushCurrentSegment = () => {
    if (currentStart === null || currentTextLines.length === 0) return;

    const text = currentTextLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) return;

    segments.push({
      start: currentStart,
      end: currentEnd ?? currentStart + 2,
      text,
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const bracketMatch = line.match(/\[TIMESTAMP:\s*([\d.]+)\s*->\s*([\d.]+)\s*\]/i);
    if (bracketMatch) {
      flushCurrentSegment();
      currentStart = parseFloat(bracketMatch[1]);
      currentEnd = parseFloat(bracketMatch[2]);
      currentTextLines = [];
      continue;
    }

    const timeTextMatch = line.match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.*)$/);
    if (timeTextMatch) {
      const nextStart = parseClockToSeconds(timeTextMatch[1]);
      const text = timeTextMatch[2].trim();

      if (currentStart !== null && currentTextLines.length > 0) {
        currentEnd = nextStart;
        flushCurrentSegment();
      }

      currentStart = nextStart;
      currentEnd = nextStart + 3;
      currentTextLines = text ? [text] : [];
      continue;
    }

    if (currentStart !== null) {
      currentTextLines.push(line);
    }
  }

  flushCurrentSegment();
  return normalizeSegments(segments);
}

// ─── Segment normalization ──────────────────────────────────────────
// Raw transcripts often contain cues that overlap in time:
//  - YouTube auto-captions are "rolling": every cue repeats the previous
//    line and starts before the previous cue ends.
//  - Whisper chunks can overlap slightly or have a missing end time.
// Because every segment is drawn at the same screen position, any overlap
// shows up as stacked / tumpang tindih text. normalizeSegments makes the
// list strictly sequential, de-duplicated, and short enough per card.

/** Segments shorter than this are merged into the next one. */
const MIN_SEGMENT_DURATION = 0.2;

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Number of words at the end of `prev` that are repeated at the start of `cur`.
 * Only counts as a repeat when ≥2 words match, or the whole previous text repeats
 * (avoids stripping coincidental single words like "the"/"yang").
 */
function repeatedPrefixLength(prev: string[], cur: string[]): number {
  const p = prev.map(normalizeWord);
  const c = cur.map(normalizeWord);
  const max = Math.min(p.length, c.length);
  for (let k = max; k >= 1; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      if (p[p.length - k + i] !== c[i]) { match = false; break; }
    }
    if (match && (k >= 2 || k === p.length)) return k;
  }
  return 0;
}

/** Split text into cards that each fit in SUBTITLE_STYLE.maxLines lines. */
function splitIntoCards(text: string): string[] {
  const lines = wrapSubtitleLines(text);
  const cards: string[] = [];
  for (let i = 0; i < lines.length; i += SUBTITLE_STYLE.maxLines) {
    cards.push(lines.slice(i, i + SUBTITLE_STYLE.maxLines).join(' '));
  }
  // Avoid a lonely 1–2 word card at the end: pull it into the previous card
  // when the combined text still fits.
  if (cards.length >= 2) {
    const merged = `${cards[cards.length - 2]} ${cards[cards.length - 1]}`;
    if (wrapSubtitleLines(merged).length <= SUBTITLE_STYLE.maxLines) {
      cards.splice(cards.length - 2, 2, merged);
    }
  }
  return cards;
}

export function normalizeSegments(input: SubtitleSegment[]): SubtitleSegment[] {
  // 1. Clean + fix missing/invalid end times, then sort by start.
  const sorted = input
    .filter((s) => Number.isFinite(s.start) && s.text.trim().length > 0)
    .map((s) => {
      const text = s.text.replace(/\s+/g, ' ').trim();
      let end = Number.isFinite(s.end) ? s.end : s.start;
      if (end <= s.start) {
        // Estimate ~0.4s per word, at least 1s
        end = s.start + Math.max(1, text.split(' ').length * 0.4);
      }
      return { start: s.start, end, text };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // 2. Strip text repeated from the previous cue (rolling captions).
  const deduped: SubtitleSegment[] = [];
  for (const seg of sorted) {
    const prev = deduped[deduped.length - 1];
    if (!prev) { deduped.push(seg); continue; }

    const prevWords = prev.text.split(' ');
    const curWords = seg.text.split(' ');
    const k = repeatedPrefixLength(prevWords, curWords);
    const remaining = curWords.slice(k).join(' ').trim();

    if (!remaining) {
      // Pure repeat of the previous cue → just extend its display time.
      prev.end = Math.max(prev.end, seg.end);
      continue;
    }
    // New words start no earlier than the previous cue's start.
    deduped.push({ start: Math.max(seg.start, prev.start), end: seg.end, text: remaining });
  }

  // 3. Remove time overlap: each segment ends when the next one starts.
  for (let i = 0; i < deduped.length - 1; i++) {
    if (deduped[i].end > deduped[i + 1].start) {
      deduped[i].end = deduped[i + 1].start;
    }
  }

  // 4. Merge segments that became too short to read into the next one.
  const merged: SubtitleSegment[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const seg = deduped[i];
    const next = deduped[i + 1];
    if (next && seg.end - seg.start < MIN_SEGMENT_DURATION) {
      next.text = `${seg.text} ${next.text}`;
      next.start = seg.start;
      continue;
    }
    merged.push(seg);
  }

  // 5. Split long segments into ≤2-line cards, timing proportional to length.
  const result: SubtitleSegment[] = [];
  for (const seg of merged) {
    const cards = splitIntoCards(seg.text);
    if (cards.length <= 1) { result.push(seg); continue; }

    const totalChars = cards.reduce((sum, c) => sum + c.length, 0);
    const duration = seg.end - seg.start;
    let t = seg.start;
    cards.forEach((card, idx) => {
      const end = idx === cards.length - 1
        ? seg.end
        : t + duration * (card.length / totalChars);
      result.push({
        start: Math.round(t * 1000) / 1000,
        end: Math.round(end * 1000) / 1000,
        text: card,
      });
      t = end;
    });
  }

  return result;
}

function parseClockToSeconds(value: string): number {
  const parts = value.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
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
 * Uses Plus Jakarta Sans Bold — a modern geometric sans-serif font
 * that's widely used in social media content.
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
  // TikTok-style: Plus Jakarta Sans Bold, white fill, thick black outline, no shadow.
  // Plus Jakarta Sans is a modern geometric sans-serif, popular in social media content.
  // Color format in ASS: AABBGGRR (hex)
  // PrimaryColour: &H00FFFFFF  = white
  // OutlineColour: &H00000000  = black
  // Bold: -1 = yes
  // BorderStyle: 1 = outline
  // Outline: 3.5 = thickness
  // Shadow: 0
  // Alignment: 2 = bottom center
  // MarginV: ~640 = position text at about 1/3 from bottom of a 1920-height video
  // (1920 / 3 ≈ 640px from bottom edge — gives a nice elevated look)
  lines.push(
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: TikTok,Plus Jakarta Sans,68,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,1,3.5,0,2,50,50,640,1',
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