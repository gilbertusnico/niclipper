/**
 * Subtitle style for burned-in TikTok/Reels-style captions.
 *
 * Font: Anton (SIL Open Font License, free for commercial use) —
 * assets/fonts/Anton-Regular.ttf. A tall, condensed display face, so it fits
 * more words per line than wide fonts while staying very readable on mobile.
 *
 * Line wrapping is done by measured pixel width (using Anton's real glyph
 * advance widths below) instead of a character count, so lines never run past
 * the frame edge regardless of which letters a sentence contains.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const ANTON_PATH = path.join(projectRoot, 'assets', 'fonts', 'Anton-Regular.ttf');
const FALLBACK_FONTS = [
  '/System/Library/Fonts/Supplemental/Impact.ttf',           // macOS
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',       // macOS
  'C:/Windows/Fonts/impact.ttf',                             // Windows
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',     // Linux
];

/** Rendering parameters, in pixels for a 1080×1920 frame. */
export const SUBTITLE_STYLE = {
  /** Base font size. Anton caps are ~0.86em tall → ~82px capitals. */
  fontSize: 95,
  /** Never shrink a line below this when auto-fitting a very long word. */
  minFontSize: 64,
  /** Max line width: 1080 minus ~90px safe margin on each side. */
  maxLineWidth: 900,
  /** Lines shown at once. */
  maxLines: 2,
  /** Baseline-to-baseline distance as a multiple of fontSize (caps only → tight). */
  lineHeightRatio: 1.14,
  /** Outline: Anton has small counters, so keep the stroke moderate (~7% of size). */
  borderRatio: 0.07,
  /** Soft drop shadow for contrast on bright backgrounds. */
  shadowOffset: 4,
  shadowColor: 'black@0.55',
  shadowOpacity: 0.55,
  /** Colour of the word being spoken. */
  highlightColor: '#FFE600',
  /** Font family name inside Anton-Regular.ttf (used by the ASS renderer). */
  fontFamily: 'Anton',
  /**
   * ASS font size per drawtext pixel size. libass sizes a font by
   * winAscent + winDescent (Anton: (2876 + 674) / 2048 em), drawtext by the em.
   */
  assSizeRatio: (2876 + 674) / 2048,
  /**
   * libass draws a top-anchored (\an8) line this much lower than drawtext at
   * the same y, as a fraction of the font's pixel size (measured: 54px @ 100px).
   */
  assTopOffsetRatio: 0.54,
  /**
   * Distance from the bottom edge to the last line. 0.37 puts the block at
   * ~52–63% from the top (around the speaker's chest), clear of the
   * TikTok/Reels caption and button UI.
   */
  bottomMarginRatio: 0.37,
} as const;

/** Anton advance widths in em (from the font's hmtx table). */
const ANTON_ADVANCE: Record<string, number> = {
  " ": 0.234, "!": 0.229, "\"": 0.429, "#": 0.546, "$": 0.462, "%": 1.057, "&": 0.52, "'": 0.214,
  "(": 0.291, ")": 0.291, "*": 0.452, "+": 0.355, ",": 0.236, "-": 0.311, ".": 0.229, "/": 0.405,
  "0": 0.494, "1": 0.331, "2": 0.494, "3": 0.494, "4": 0.494, "5": 0.494, "6": 0.494, "7": 0.494,
  "8": 0.494, "9": 0.494, ":": 0.242, ";": 0.245, "<": 0.321, "=": 0.311, ">": 0.321, "?": 0.492,
  "@": 0.864, "A": 0.485, "B": 0.479, "C": 0.474, "D": 0.493, "E": 0.412, "F": 0.399, "G": 0.485,
  "H": 0.499, "I": 0.227, "J": 0.466, "K": 0.472, "L": 0.397, "M": 0.746, "N": 0.498, "O": 0.486,
  "P": 0.472, "Q": 0.494, "R": 0.477, "S": 0.461, "T": 0.396, "U": 0.474, "V": 0.469, "W": 0.712,
  "X": 0.484, "Y": 0.446, "Z": 0.41, "[": 0.318, "\\": 0.405, "]": 0.318, "^": 0.474, "_": 0.365,
  "`": 0.317, "a": 0.483, "b": 0.501, "c": 0.491, "d": 0.498, "e": 0.488, "f": 0.28, "g": 0.504,
  "h": 0.505, "i": 0.243, "j": 0.263, "k": 0.491, "l": 0.248, "m": 0.758, "n": 0.499, "o": 0.497,
  "p": 0.501, "q": 0.498, "r": 0.347, "s": 0.475, "t": 0.305, "u": 0.499, "v": 0.461, "w": 0.696,
  "x": 0.459, "y": 0.461, "z": 0.386, "{": 0.34, "|": 0.216, "}": 0.34, "~": 0.493, "À": 0.485,
  "Á": 0.485, "Â": 0.485, "Ã": 0.485, "Ä": 0.485, "Å": 0.485, "È": 0.412, "É": 0.412, "Ê": 0.412,
  "Ë": 0.412, "Ì": 0.227, "Í": 0.227, "Î": 0.227, "Ï": 0.227, "Ò": 0.486, "Ó": 0.486, "Ô": 0.486,
  "Õ": 0.486, "Ö": 0.486, "Ù": 0.474, "Ú": 0.474, "Û": 0.474, "Ü": 0.474, "Ñ": 0.498, "Ç": 0.474,
  "‘": 0.235, "’": 0.232, "“": 0.464, "”": 0.463, "…": 0.708, "–": 0.311, "—": 0.563,
};
const DEFAULT_ADVANCE = 0.5;

let resolvedFontPath: string | null | undefined;

/** Path to the subtitle font file (Anton, or a system fallback with a warning). */
export function getSubtitleFontPath(): string | null {
  if (resolvedFontPath !== undefined) return resolvedFontPath;
  if (fs.existsSync(ANTON_PATH)) {
    resolvedFontPath = ANTON_PATH;
  } else {
    resolvedFontPath = FALLBACK_FONTS.find((p) => fs.existsSync(p)) ?? null;
    console.warn(`[Subtitles] Anton font not found at ${ANTON_PATH}; using ${resolvedFontPath ?? 'ffmpeg default font'}.`);
  }
  return resolvedFontPath;
}

/** Text exactly as it is drawn on screen (Anton captions are all-caps). */
export function toDisplayText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLocaleUpperCase('id-ID');
}

/** Rendered width in px of `text` (display form) at `fontSize`. */
export function measureTextWidth(text: string, fontSize: number = SUBTITLE_STYLE.fontSize): number {
  let em = 0;
  for (const ch of toDisplayText(text)) {
    em += ANTON_ADVANCE[ch] ?? DEFAULT_ADVANCE;
  }
  return em * fontSize;
}

/** Greedy word wrap to `maxLineWidth`. Returns every line (no truncation). */
export function wrapSubtitleLines(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measureTextWidth(candidate) > SUBTITLE_STYLE.maxLineWidth) {
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
 * Lay out text that fits in one card (≤ maxLines) with balanced line lengths,
 * e.g. "AKU MAU CERITA SOAL / KANTOR" → "AKU MAU CERITA / SOAL KANTOR".
 */
export function layoutCardLines(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const greedy = wrapSubtitleLines(text);
  if (greedy.length !== 2 || words.length < 2) return greedy.slice(0, SUBTITLE_STYLE.maxLines);

  let best = greedy;
  let bestScore = Math.max(...greedy.map((l) => measureTextWidth(l)));
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const wa = measureTextWidth(a);
    const wb = measureTextWidth(b);
    if (wa > SUBTITLE_STYLE.maxLineWidth || wb > SUBTITLE_STYLE.maxLineWidth) continue;
    const score = Math.max(wa, wb);
    if (score < bestScore) { best = [a, b]; bestScore = score; }
  }
  return best;
}

/** Font size for one line: shrinks only if a single long word overflows. */
export function fitFontSize(line: string): number {
  const width = measureTextWidth(line);
  if (width <= SUBTITLE_STYLE.maxLineWidth) return SUBTITLE_STYLE.fontSize;
  const scaled = Math.floor(SUBTITLE_STYLE.fontSize * (SUBTITLE_STYLE.maxLineWidth / width));
  return Math.max(SUBTITLE_STYLE.minFontSize, scaled);
}
