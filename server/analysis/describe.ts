/**
 * Title + description for a clip — extractive, no AI.
 *
 * Title: the strongest line actually said in the clip (an opener, question,
 * strong claim, concrete number…), cleaned of fillers and framed as a quote,
 * optionally followed by the source video's title.
 * Description: the clip's most informative lines, a timestamped link to the
 * full video, and hashtags from the clip's distinctive keywords.
 */

import type { Analysis } from './features.js';
import { STOP_WORDS, FILLER_WORDS, BAD_START_WORDS, GENERIC_WORDS, REACTION_MARKERS } from './lexicon.js';
import { stem } from './features.js';

export interface SourceInfo {
  title?: string;
  url?: string;
  videoId?: string;
}

const TITLE_MAX = 100;
const QUOTE_MAX = 70;

/** Leading words that make a weak start for a quoted line. */
const LEADING_JUNK = new Set([
  ...BAD_START_WORDS, 'jadi', 'nah', 'oke', 'ok', 'iya', 'ya', 'yah', 'eh', 'em', 'emm', 'hmm',
  'ee', 'eee', 'terus', 'trus', 'gitu', 'kayak', 'pokoknya', 'soalnya', 'gini',
]);

interface Span { from: number; to: number; text: string; score: number; }

/** Remove fillers and stutters ("gue gue"), tidy spacing and casing. */
function cleanLine(text: string): string {
  let words = text
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !FILLER_WORDS.has(w.toLowerCase().replace(/[^\p{L}]/gu, '')));
  words = words.filter((w, i) => i === 0 || w.toLowerCase() !== words[i - 1].toLowerCase());
  while (words.length > 3 && LEADING_JUNK.has(words[0].toLowerCase().replace(/[^\p{L}]/gu, ''))) words.shift();
  while (words.length > 3 && /^(gitu|kan|sih|ya|deh|dong|tuh)[,.!?]*$/i.test(words[words.length - 1])) words.pop();
  let s = words.join(' ').replace(/\s+([,.!?])/g, '$1').replace(/[,;:]+$/, '').trim();
  if (!s) return s;
  s = s[0].toLocaleUpperCase('id-ID') + s.slice(1);
  return s;
}

function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[,.;:!?\s]+$/, '')}…`;
}

/** Group consecutive units into sentence-like spans (end at punctuation or ~90 chars). */
function spansOf(analysis: Analysis, s: number, e: number): Span[] {
  const spans: Span[] = [];
  let from = s;
  let text = '';
  for (let k = s; k <= e; k++) {
    const u = analysis.units[k];
    text = text ? `${text} ${u.text}` : u.text;
    const longEnough = text.length >= 90;
    const pauseAfter = analysis.breakAfter[k] >= 0.6;
    if (u.terminal || longEnough || pauseAfter || k === e) {
      spans.push({ from, to: k, text, score: 0 });
      from = k + 1;
      text = '';
    }
  }
  return spans;
}

function scoreSpan(analysis: Analysis, sp: Span, clipStart: number, clipEnd: number): number {
  const fs = analysis.features.slice(sp.from, sp.to + 1);
  const max = (key: 'opener' | 'question' | 'opinion' | 'reaction' | 'specificity' | 'story' | 'insight') =>
    Math.max(...fs.map((f) => f[key]));
  const interest = fs.reduce((a, f) => a + f.interest, 0) / fs.length;
  // Prefer lines made of words that recur in the video or are common words —
  // one-off words are mostly caption/recognition errors and make ugly titles.
  const words = analysis.units.slice(sp.from, sp.to + 1).flatMap((u) => u.words);
  const known = words.filter((w) => STOP_WORDS.has(w) || w.length <= 3 || (analysis.df.get(w) ?? 0) >= 2).length;
  const knownRatio = words.length ? known / words.length : 0;
  const theme = Math.max(...fs.map((f) => f.theme));
  const len = cleanLine(sp.text).length;
  const lenFit = len < 20 ? 0.2 : len <= 80 ? 1 : 0.6;
  const pos = (analysis.units[sp.from].start - clipStart) / Math.max(1, clipEnd - clipStart);
  return (
    1.0 * interest +
    0.6 * max('opener') +
    0.5 * max('question') +
    0.5 * max('opinion') +
    0.35 * max('specificity') +
    0.3 * max('story') +
    0.25 * max('insight') +
    0.2 * max('reaction') +
    0.8 * knownRatio +
    0.4 * theme +
    0.3 * (1 - pos) - // lines near the start are the hook
    0.6 * Math.max(...fs.map((f) => f.fillerRatio)) +
    0.4 * lenFit
  );
}

const REACTION = new Set(REACTION_MARKERS.filter((r) => !r.includes(' ')));

function hashtagsOf(analysis: Analysis, s: number, e: number): string[] {
  const counts = new Map<string, number>();
  for (let k = s; k <= e; k++) {
    for (const w of analysis.features[k].keywords) {
      if (w.length < 4 || STOP_WORDS.has(w) || !/^\p{L}+$/u.test(w)) continue;
      // Only real topic words: recur in the video (not a mishearing), not generic, not "hahaha".
      if ((analysis.df.get(w) ?? 0) < 3 || GENERIC_WORDS.has(stem(w)) || REACTION.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + (analysis.idf.get(w) ?? 0));
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => `#${w}`);
}

function youtubeLink(source: SourceInfo, seconds: number): string | null {
  const id = source.videoId ?? source.url?.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/)?.[1];
  return id ? `https://youtu.be/${id}?t=${Math.max(0, Math.floor(seconds))}` : null;
}

export function describeClip(
  analysis: Analysis,
  s: number,
  e: number,
  source: SourceInfo = {},
): { title: string; description: string } {
  const clipStart = analysis.units[s].start;
  const clipEnd = analysis.units[e].end;
  const spans = spansOf(analysis, s, e).map((sp) => ({ ...sp, score: scoreSpan(analysis, sp, clipStart, clipEnd) }));
  const ranked = [...spans].sort((a, b) => b.score - a.score);

  // ── Title ──
  const best = ranked.find((sp) => cleanLine(sp.text).length >= 25) ?? ranked[0];
  let quote = truncateWords(cleanLine(best?.text ?? ''), QUOTE_MAX);
  if (!quote) quote = 'Momen menarik';
  let title = `"${quote}"`;
  const sourceTitle = source.title?.trim();
  if (sourceTitle && title.length + 3 + sourceTitle.length <= TITLE_MAX) title += ` | ${sourceTitle}`;

  // ── Description ──
  const summary = ranked
    .filter((sp) => sp !== best && cleanLine(sp.text).length >= 20)
    .slice(0, 2)
    .sort((a, b) => a.from - b.from)
    .map((sp) => truncateWords(cleanLine(sp.text), 140))
    .map((line) => (/[.!?…]$/.test(line) ? line : `${line}.`));
  const lines: string[] = [];
  if (summary.length) lines.push(summary.join(' '));
  const link = youtubeLink(source, clipStart);
  if (sourceTitle || link) {
    lines.push('');
    if (sourceTitle) lines.push(`Cuplikan dari: ${sourceTitle}`);
    if (link) lines.push(`Video lengkap: ${link}`);
  }
  const tags = [...hashtagsOf(analysis, s, e), '#shorts'];
  lines.push('', tags.join(' '));

  return { title, description: lines.join('\n').trim() };
}
