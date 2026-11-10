/**
 * Big hook text burned in at the start of a clip (AI mode).
 *
 * The first 1–2 seconds decide whether a viewer swipes away, so the clip opens
 * with its hook line in large Anton caps on a solid box near the top of the
 * frame (clear of the captions, which sit around the speaker's chest).
 *
 * Rendered with libass (one Dialogue per line, each with its own box). When
 * FFmpeg has no libass, a drawtext fallback draws the same layout without the
 * pop-in animation.
 */

import fs from 'fs';
import path from 'path';
import { SUBTITLE_STYLE, measureTextWidth, toDisplayText } from './subtitle-style.js';
import { escapeAssText, formatAssTime, toAssColor } from './subtitles.js';

/** Layout in pixels for a 1080×1920 frame. */
export const HOOK_STYLE = {
  /** How long the hook stays on screen (seconds). */
  duration: 3.5,
  fadeInMs: 120,
  fadeOutMs: 250,
  /** Largest font size; shrinks (down to minFontSize) until the text fits in maxLines. */
  fontSize: 108,
  minFontSize: 76,
  /** Text width per line (box padding comes on top of this). */
  maxLineWidth: 860,
  maxLines: 3,
  lineHeightRatio: 1.22,
  /** Top of the first line, as a fraction of the frame height (below the Shorts top bar). */
  topRatio: 0.135,
  /** Padding of the box around each line, as a fraction of the font size. */
  boxPaddingRatio: 0.16,
  textColor: '#111111',
  boxColor: SUBTITLE_STYLE.highlightColor,
} as const;

export interface HookLayout {
  fontSize: number;
  lines: string[];
}

/** Greedy wrap of display text at a font size. */
function wrapAt(text: string, fontSize: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measureTextWidth(candidate, fontSize) > HOOK_STYLE.maxLineWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Even out line lengths for the chosen line count, e.g.
 * "KENAPA GUA JADI DOKTER / CINTA" → "KENAPA GUA JADI / DOKTER CINTA".
 */
function balance(words: string[], lineCount: number, fontSize: number): string[] {
  if (lineCount <= 1) return [words.join(' ')];
  const target = measureTextWidth(words.join(' '), fontSize) / lineCount;
  const lines: string[] = [];
  let current: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const remainingLines = lineCount - lines.length;
    const remainingWords = words.length - i;
    const next = [...current, words[i]];
    const tooWide = measureTextWidth(next.join(' '), fontSize) > HOOK_STYLE.maxLineWidth;
    const pastTarget = current.length > 0
      && measureTextWidth(next.join(' '), fontSize) > target * 1.08
      && remainingLines > 1;
    if (current.length > 0 && (tooWide || pastTarget || remainingWords < remainingLines)) {
      lines.push(current.join(' '));
      current = [words[i]];
    } else {
      current = next;
    }
  }
  if (current.length) lines.push(current.join(' '));
  return lines;
}

/** Font size and lines for a hook: as large as fits in maxLines. */
export function layoutHook(hook: string): HookLayout | null {
  const text = toDisplayText(hook);
  if (!text) return null;
  for (let size = HOOK_STYLE.fontSize; size >= HOOK_STYLE.minFontSize; size -= 4) {
    const greedy = wrapAt(text, size);
    if (greedy.length <= HOOK_STYLE.maxLines) {
      const balanced = balance(text.split(' '), greedy.length, size);
      const ok = balanced.length === greedy.length
        && balanced.every((l) => measureTextWidth(l, size) <= HOOK_STYLE.maxLineWidth);
      return { fontSize: size, lines: ok ? balanced : greedy };
    }
  }
  // Very long hook: smallest size, first maxLines lines, ellipsis on the last.
  const lines = wrapAt(text, HOOK_STYLE.minFontSize).slice(0, HOOK_STYLE.maxLines);
  lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[,.;:!?…]+$/, '')}…`;
  return { fontSize: HOOK_STYLE.minFontSize, lines };
}

/** y (top of the text) of each line, in a frame of the given height. */
function lineTops(layout: HookLayout, width: number, height: number): number[] {
  const scale = width / 1080;
  const fontPx = layout.fontSize * scale;
  const lineHeight = fontPx * HOOK_STYLE.lineHeightRatio;
  const top = height * HOOK_STYLE.topRatio;
  return layout.lines.map((_, j) => Math.round(top + j * lineHeight));
}

/** ASS file content for the hook (one event per line, each on its own box). */
export function generateHookAss(hook: string, clipDuration: number, width = 1080, height = 1920): string | null {
  const layout = layoutHook(hook);
  if (!layout) return null;
  const scale = width / 1080;
  const fontPx = layout.fontSize * scale;
  const assSize = Math.round(fontPx * SUBTITLE_STYLE.assSizeRatio);
  const pad = Math.max(4, Math.round(fontPx * HOOK_STYLE.boxPaddingRatio));
  const end = Math.max(0.5, Math.min(HOOK_STYLE.duration, clipDuration));
  const text = toAssColor(HOOK_STYLE.textColor).replace(/&$/, '').replace('&H', '&H00');
  const box = toAssColor(HOOK_STYLE.boxColor).replace(/&$/, '').replace('&H', '&H00');

  const out = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 2',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Boxes (layer 0) and text (layer 1) are separate events, so a line's box
    // never covers the line above it; overlapping boxes merge into one block.
    // BorderStyle 3 = opaque box in OutlineColour; its text is fully transparent.
    `Style: HookBox,${SUBTITLE_STYLE.fontFamily},${assSize},&HFF000000,&HFF000000,${box},&HFF000000,0,0,0,0,100,100,0,0,3,${pad},0,8,0,0,0,1`,
    `Style: HookText,${SUBTITLE_STYLE.fontFamily},${assSize},${text},${text},&HFF000000,&HFF000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const tops = lineTops(layout, width, height);
  layout.lines.forEach((line, j) => {
    const y = Math.round(tops[j] - fontPx * SUBTITLE_STYLE.assTopOffsetRatio);
    // Quick pop-in: 88% → 100% over 160 ms, plus fades.
    const anim = `\\an8\\pos(${Math.round(width / 2)},${y})`
      + `\\fad(${HOOK_STYLE.fadeInMs},${HOOK_STYLE.fadeOutMs})`
      + `\\fscx88\\fscy88\\t(0,160,\\fscx100\\fscy100)`;
    const t0 = formatAssTime(0);
    const t1 = formatAssTime(end);
    const body = escapeAssText(line);
    // Wide side padding, little vertical padding (Anton's line box is already tall).
    out.push(`Dialogue: 0,${t0},${t1},HookBox,,0,0,0,,{${anim}\\xbord${pad}\\ybord${Math.round(pad * 0.15)}}${body}`);
    out.push(`Dialogue: 1,${t0},${t1},HookText,,0,0,0,,{${anim}}${body}`);
  });
  return out.join('\n') + '\n';
}

/** Quote a value for use as a single-quoted ffmpeg filter option. */
function quoteFilterValue(value: string): string {
  return `'${value.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

/**
 * drawtext fallback (no libass): same boxes and layout, no animation.
 * Text goes through temp files so quotes/colons/% need no escaping.
 */
export function buildHookDrawText(
  hook: string,
  clipDuration: number,
  width: number,
  height: number,
  fontFile: string | null,
  tempDir: string,
  clipIndex: number,
): { filter: string; files: string[] } | null {
  const layout = layoutHook(hook);
  if (!layout) return null;
  const scale = width / 1080;
  const fontPx = Math.round(layout.fontSize * scale);
  const pad = Math.max(4, Math.round(fontPx * HOOK_STYLE.boxPaddingRatio));
  const end = Math.max(0.5, Math.min(HOOK_STYLE.duration, clipDuration));
  const tops = lineTops(layout, width, height);
  const files: string[] = [];
  const filters = layout.lines.map((line, j) => {
    const file = path.join(tempDir, `hook_${clipIndex}_${j}.txt`);
    fs.writeFileSync(file, line, 'utf-8');
    files.push(file);
    return [
      `drawtext=textfile=${quoteFilterValue(file)}`,
      'expansion=none',
      ...(fontFile ? [`fontfile=${quoteFilterValue(fontFile)}`] : []),
      `fontcolor=${HOOK_STYLE.textColor}`,
      `fontsize=${fontPx}`,
      'box=1',
      `boxcolor=${HOOK_STYLE.boxColor}`,
      `boxborderw=${pad}`,
      'x=(w-text_w)/2',
      `y=${tops[j]}`,
      `enable='lt(t,${end})'`,
    ].join(':');
  });
  return { filter: filters.join(','), files };
}
