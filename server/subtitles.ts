/**
 * Subtitle utilities for Niclipper
 *
 * Parses the timestamped transcript format and generates ASS (Advanced
 * SubStation Alpha) subtitle files with TikTok-style captions where the
 * word being spoken is highlighted.
 */

import fs from 'fs';
import {
  SUBTITLE_STYLE,
  wrapSubtitleLines,
  layoutCardLines,
  fitFontSize,
  toDisplayText,
} from './subtitle-style.js';

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

// ─── Word-level cards (yellow highlight on the spoken word) ─────────

/** One spoken word with its time span (seconds). */
export interface WordTiming {
  start: number;
  end: number;
  text: string;
}

/** One on-screen caption card (≤ maxLines lines) and the words in it. */
export interface SubtitleCard {
  start: number;
  end: number;
  words: WordTiming[];
}

/** Start a new card after a silence this long (seconds). */
const CARD_PAUSE_BREAK = 0.8;
/** Keep a card on screen this long after its last word, unless the next card starts. */
const CARD_HOLD_AFTER = 0.5;

/** Sound tags like "[tertawa]" / "[Musik]" stay in the transcript but aren't drawn. */
function stripSoundTags(text: string): string {
  return text.replace(/\[[^\]]*\]/g, ' ');
}

/** Split each word's text on whitespace so every WordTiming is a single token. */
function splitWordTokens(words: WordTiming[]): WordTiming[] {
  const out: WordTiming[] = [];
  for (const w of words) {
    const tokens = stripSoundTags(w.text).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const step = (w.end - w.start) / tokens.length;
    tokens.forEach((text, i) => out.push({ start: w.start + i * step, end: w.start + (i + 1) * step, text }));
  }
  return out;
}

/**
 * Group real word timings (e.g. from YouTube json3 auto-captions) into cards:
 * a new card starts when the text would exceed maxLines, after a pause, or
 * after a sentence end.
 */
function cardsFromWords(input: WordTiming[]): SubtitleCard[] {
  const words = splitWordTokens([...input].sort((a, b) => a.start - b.start));
  // A caption line's last word "lasts" until the line ends, overlapping the next
  // line; end every word no later than the next word starts.
  for (let i = 0; i < words.length - 1; i++) {
    words[i].end = Math.max(words[i].start, Math.min(words[i].end, words[i + 1].start));
  }
  const cards: SubtitleCard[] = [];
  let current: WordTiming[] = [];

  const flush = () => {
    if (current.length === 0) return;
    cards.push({ start: current[0].start, end: current[current.length - 1].end, words: current });
    current = [];
  };

  for (const word of words) {
    const prev = current[current.length - 1];
    if (prev) {
      const text = [...current, word].map((w) => w.text).join(' ');
      const tooLong = wrapSubtitleLines(text).length > SUBTITLE_STYLE.maxLines;
      const pause = word.start - prev.end > CARD_PAUSE_BREAK;
      const sentenceEnd = /[.?!…]$/.test(prev.text) && current.length >= 2;
      if (tooLong || pause || sentenceEnd) flush();
    }
    current.push(word);
  }
  flush();

  // Hold each card briefly after its last word, but never into the next card.
  for (let i = 0; i < cards.length; i++) {
    const next = cards[i + 1];
    const held = cards[i].end + CARD_HOLD_AFTER;
    cards[i].end = next ? Math.min(held, next.start) : held;
  }
  return cards;
}

/**
 * Turn normalized segments into cards, estimating each word's timing from its
 * length (used for manual subtitles, Whisper, and edited transcripts).
 */
function cardsFromSegments(segments: SubtitleSegment[]): SubtitleCard[] {
  return segments.map((seg) => {
    const tokens = stripSoundTags(seg.text).split(/\s+/).filter(Boolean);
    // +2 per word approximates the pause between words
    const weights = tokens.map((t) => t.length + 2);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const duration = seg.end - seg.start;
    let t = seg.start;
    const words = tokens.map((text, i) => {
      const end = i === tokens.length - 1 ? seg.end : t + duration * (weights[i] / total);
      const word = { start: t, end, text };
      t = end;
      return word;
    });
    return { start: seg.start, end: seg.end, words };
  });
}

/**
 * Build caption cards for a clip window, with times offset so the clip starts at 0.
 * Uses real word timings when available, otherwise estimates them from the transcript.
 */
export function buildCardsForClip(
  transcript: string,
  words: WordTiming[] | undefined,
  clipStart: number,
  clipEnd: number,
): SubtitleCard[] {
  const clipWords = words?.filter((w) => w.end > clipStart && w.start < clipEnd);
  const cards = clipWords && clipWords.length > 0
    ? cardsFromWords(clipWords)
    : cardsFromSegments(filterSegmentsForClip(parseTranscriptToSegments(transcript), clipStart, clipEnd));
  // cardsFromSegments already works on clip-relative segments
  const offset = clipWords && clipWords.length > 0 ? clipStart : 0;
  const duration = clipEnd - clipStart;

  return cards
    .map((card) => ({
      start: Math.max(0, card.start - offset),
      end: Math.min(duration, card.end - offset),
      words: card.words.map((w) => ({
        start: Math.max(0, w.start - offset),
        end: Math.min(duration, w.end - offset),
        text: w.text,
      })),
    }))
    .filter((card) => card.end > card.start && card.words.length > 0);
}

/** Format seconds to ASS time: H:MM:SS.cc */
function formatAssTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Make speech text safe inside an ASS Dialogue line ({} start override tags). */
function escapeAssText(text: string): string {
  return text.replace(/\\/g, '/').replace(/\{/g, '(').replace(/\}/g, ')');
}

/** "#RRGGBB" → ASS inline colour "&HBBGGRR&" */
function toAssColor(hex: string): string {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  return `&H${b}${g}${r}&`.toUpperCase();
}

/**
 * Generate ASS content for word-highlight captions (style: subtitle-style.ts).
 *
 * Each card is drawn as one event per line per highlight state, so the word
 * being spoken is yellow and the rest white. Lines get an explicit \pos with
 * the same layout as the old drawtext renderer (balanced lines, per-line
 * font fit, bottom-anchored block).
 */
export function generateHighlightAss(
  cards: SubtitleCard[],
  width: number = 1080,
  height: number = 1920,
): string {
  const scale = width / 1080;
  const lineHeight = SUBTITLE_STYLE.fontSize * SUBTITLE_STYLE.lineHeightRatio * scale;
  const bottomMargin = height * SUBTITLE_STYLE.bottomMarginRatio;
  const shadow = Math.max(1, Math.round(SUBTITLE_STYLE.shadowOffset * scale));
  // ASS alpha is transparency (00 = opaque)
  const shadowAlpha = Math.round((1 - SUBTITLE_STYLE.shadowOpacity) * 255).toString(16).padStart(2, '0').toUpperCase();
  const white = toAssColor('#FFFFFF');
  const highlight = toAssColor(SUBTITLE_STYLE.highlightColor);

  const out: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 2', // lines are pre-wrapped; never let libass re-wrap
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${SUBTITLE_STYLE.fontFamily},${Math.round(SUBTITLE_STYLE.fontSize * SUBTITLE_STYLE.assSizeRatio * scale)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H${shadowAlpha}000000,0,0,0,0,100,100,0,0,1,0,${shadow},8,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const card of cards) {
    const words = card.words.map((w) => ({ ...w, display: toDisplayText(w.text) }));
    const lines = layoutCardLines(words.map((w) => w.display).join(' '));

    // Map each layout line back to the word indexes it contains
    const lineWords: number[][] = [];
    let cursor = 0;
    for (const line of lines) {
      const count = line.split(' ').filter(Boolean).length;
      lineWords.push(words.slice(cursor, cursor + count).map((_, k) => cursor + k));
      cursor += count;
    }

    // Highlight state k runs until word k+1 starts; the first state starts with the card
    for (let k = 0; k < words.length; k++) {
      const start = k === 0 ? card.start : words[k].start;
      const end = k === words.length - 1 ? card.end : words[k + 1].start;
      if (end <= start) continue;

      lines.forEach((line, j) => {
        const fontPx = fitFontSize(line) * scale;
        const border = Math.max(2, Math.round(fontPx * SUBTITLE_STYLE.borderRatio));
        const slotTop = height - bottomMargin - (lines.length - j) * lineHeight;
        const y = Math.round(
          slotTop
          + (lineHeight - fontPx * SUBTITLE_STYLE.lineHeightRatio) / 2
          - fontPx * SUBTITLE_STYLE.assTopOffsetRatio,
        );
        const text = lineWords[j]
          .map((idx) => {
            const word = escapeAssText(words[idx].display);
            return idx === k ? `{\\c${highlight}}${word}{\\c${white}}` : word;
          })
          .join(' ');
        const tags = `{\\an8\\pos(${Math.round(width / 2)},${y})\\fs${Math.round(fontPx * SUBTITLE_STYLE.assSizeRatio)}\\bord${border}}`;
        out.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Caption,,0,0,0,,${tags}${text}`);
      });
    }
  }

  return out.join('\n') + '\n';
}

/** Write word-highlight captions for a clip to an .ass file. */
export function writeHighlightAssFile(
  cards: SubtitleCard[],
  outputPath: string,
  width: number = 1080,
  height: number = 1920,
): void {
  fs.writeFileSync(outputPath, generateHighlightAss(cards, width, height), 'utf-8');
  console.log(`[Subtitles] ASS file written: ${outputPath} (${cards.length} cards)`);
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