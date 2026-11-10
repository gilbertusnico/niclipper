/**
 * Title, on-screen hook and description for a clip — extractive, no AI.
 *
 * Title: the strongest line actually said in the clip (an opener, question,
 * strong claim, concrete number…), cleaned of fillers, as a headline, followed
 * by the people / show from the source video's title when it fits.
 * Hook: a short (≤ ~8 words) line from the clip, burned in big at the start.
 * Description: the clip's most informative lines, a timestamped link to the
 * full video, and hashtags (people from the source title + the clip's
 * distinctive topic words).
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
/** On-screen hook: short enough to read in ~2 seconds. */
const HOOK_MAX_WORDS = 9;
const HOOK_MAX_CHARS = 56;
const HOOK_MIN_WORDS = 4;
/** Topic hashtags per clip (people hashtags come on top of these). */
const TOPIC_TAGS = 2;
const PEOPLE_TAGS = 3;

/**
 * Common verbs / adjectives / adverbs that recur in a clip but nobody searches
 * for as a hashtag ("#coba", "#masuk", "#ketemu").
 */
const HASHTAG_SKIP = new Set([
  'coba', 'cobain', 'masuk', 'keluar', 'ketemu', 'ketemuan', 'temu', 'kencang', 'kenceng', 'berhasil',
  'gagal', 'selesai', 'buka', 'tutup', 'bawa', 'kirim', 'cari', 'tunggu', 'dengar', 'denger', 'dengerin',
  'jalan', 'duduk', 'berdiri', 'main', 'minta', 'beli', 'bayar', 'dapat', 'dapet', 'punya', 'taruh',
  'pegang', 'tarik', 'dorong', 'angkat', 'pindah', 'balik', 'sampai', 'sampe', 'lewat', 'ikut', 'ajak',
  'bantu', 'tolong', 'suruh', 'boleh', 'bisa', 'harus', 'perlu', 'kepengen', 'ngerti', 'paham', 'inget',
  'ingat', 'lupa', 'rasa', 'merasa', 'kenal', 'tau', 'ketawa', 'tertawa', 'nangis', 'marah', 'takut',
  'senang', 'seneng', 'sedih', 'capek', 'cape', 'lucu', 'keren', 'parah', 'gila', 'aneh', 'serius',
  'beneran', 'bener', 'salah', 'susah', 'gampang', 'mudah', 'cepat', 'cepet', 'lama', 'pelan', 'jauh',
  'deket', 'dekat', 'tinggi', 'rendah', 'panjang', 'pendek', 'ramai', 'rame', 'sepi', 'penuh', 'kosong',
  'pokok', 'kayak', 'langsung', 'terakhir', 'pertama', 'kedua', 'berapa', 'semua', 'setiap', 'tiap',
  'abis', 'habis', 'udah', 'sudah', 'belum', 'masih', 'doang', 'banget', 'kok', 'enggak', 'nggak',
  'gak', 'ngga', 'tidak', 'bukan', 'gimana', 'sesuatu', 'semuanya', 'pokoknya', 'beda', 'sama', 'baik',
  'jelek', 'mahal', 'murah', 'penting', 'biasanya', 'kadang', 'sering', 'jarang', 'pasti', 'mungkin',
  'tiba', 'tiba-tiba', 'kemudian', 'akhirnya', 'ternyata', 'emang', 'memang', 'sebenarnya', 'sebenernya',
  'goyang', 'nunggu', 'nyampe', 'nanya', 'ngasih', 'ngomong', 'tempat', 'usah', 'awal', 'awalnya',
  'sini', 'situ', 'sana', 'akhir', 'cara', 'hal', 'bagian', 'sisi', 'kali', 'orang', 'barang', 'masalah', 'contoh', 'jenis',
]);

/** Words in a source title that are not part of a person's name. */
const NOT_NAME_WORDS = new Set([
  'podcast', 'eps', 'episode', 'part', 'full', 'video', 'official', 'live', 'the', 'show', 'ketika',
  'saat', 'bareng', 'bersama', 'with', 'feat', 'ft', 'vs', 'dan', 'and', 'di', 'ke', 'dari', 'yang',
  'shorts', 'short', 'vlog', 'reaction', 'trailer', 'ketemu', 'bertemu',
]);

/** Honorifics: part of a name ("Dokter Ihsan"), never a hashtag on their own. */
const HONORIFICS = new Set([
  'dokter', 'dr', 'prof', 'bang', 'abang', 'kak', 'kakak', 'mas', 'mbak', 'pak', 'bapak', 'bu', 'ibu',
  'om', 'tante', 'coach', 'ustadz', 'ustad', 'habib', 'kang', 'teh', 'cik', 'koh', 'ci',
]);

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
      if (!isTopicWord(w)) continue;
      // Only real topic words: recur in the video (not a mishearing), not generic, not "hahaha".
      if ((analysis.df.get(w) ?? 0) < 3 || GENERIC_WORDS.has(stem(w)) || REACTION.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + (analysis.idf.get(w) ?? 0));
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOPIC_TAGS).map(([w]) => `#${w}`);
}

/**
 * Likely a topic noun rather than a verb/adjective. Indonesian morphology is
 * too irregular for a real tagger, so: a skip list of common verbs/adjectives,
 * colloquial verb forms (ng-/ny- prefix: "ngomong", "nyari") and affixed verbs
 * ("dikasihin", "bayangkan", "nungguin").
 */
function isTopicWord(w: string): boolean {
  if (HASHTAG_SKIP.has(w) || HASHTAG_SKIP.has(stem(w))) return false;
  if (/^(ng|ny)/.test(w)) return false;
  if (w.length > 5 && w.endsWith('nya')) return false;
  if (/^(di|me|mem|men|meng|meny|ber|ter|nge)\p{L}{3,}(in|kan)$/u.test(w)) return false;
  if (w.length >= 7 && /(in|kan)$/.test(w) && /^(di|ng|ny|me|ke)/.test(w)) return false;
  return true;
}

/**
 * The part of a source title that says who/what it is, e.g.
 * "Ketika Halda Ketemu Dokter | Podcast Raditya Dika" → kept whole (fits),
 * "Raditya Dika x Fadil Jaidi - Cerita Paling Absurd Soal Kucing ..." → "Raditya Dika x Fadil Jaidi".
 */
function shortSourceTitle(sourceTitle: string): string {
  const clean = sourceTitle.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 40) return clean;
  const parts = clean.split(/\s+[|•\-–—:]\s+/).map((p) => p.trim()).filter(Boolean);
  const people = parts.find((p) => PEOPLE_SEP.test(p));
  return truncateWords(people ?? parts[0] ?? clean, 40);
}

const PEOPLE_SEP = /\s(?:x|ft\.?|feat\.?|&|bareng|bersama|with|vs\.?)\s/i;

/** Hashtags for the people/show named in the source title (#RadityaDika). */
function peopleTags(sourceTitle?: string): string[] {
  if (!sourceTitle) return [];
  const clean = sourceTitle.replace(/#[\p{L}\p{N}_]+/gu, ' ');
  const tags: string[] = [];
  for (const part of clean.split(/\s*[|•,()\[\]]\s*|\s+[-–—:]\s+|\s(?:x|ft\.?|feat\.?|&|bareng|bersama|with|vs\.?|dan|and)\s/i)) {
    // Runs of capitalised words = names ("Raditya Dika", "Dokter Ihsan").
    let run: string[] = [];
    const flush = () => {
      if (run.length === 1 && HONORIFICS.has(run[0].toLowerCase())) run = [];
      if (run.length >= 1 && run.length <= 3) {
        const tag = run.join('');
        if (tag.length >= 4 && tag.length <= 24) tags.push(`#${tag}`);
      }
      run = [];
    };
    for (const raw of part.split(/\s+/)) {
      const word = raw.replace(/[^\p{L}\p{N}]/gu, '');
      if (word && /^\p{Lu}/u.test(word) && !NOT_NAME_WORDS.has(word.toLowerCase())) run.push(word);
      else flush();
    }
    flush();
  }
  return tags.slice(0, PEOPLE_TAGS);
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A line that says something (for the description), not a reaction or a short reply. */
function isContentLine(analysis: Analysis, sp: Span): boolean {
  const line = cleanLine(sp.text);
  if (line.length < 30 || line.split(' ').length < 6) return false;
  if (/\[(tertawa|ketawa|laughter|laughs|berteriak|tepuk tangan|applause)[^\]]*\]/i.test(sp.text)) return false;
  const fs = analysis.features.slice(sp.from, sp.to + 1);
  if (Math.max(...fs.map((f) => f.reaction)) >= 0.6) return false;
  if (Math.max(...fs.map((f) => f.fillerRatio)) > 0.25) return false;
  return true;
}

/**
 * Short hook for the on-screen text. Same message as the title when that line
 * is already short; else its first clause; else another strong line from the
 * top of the ranking (not a reaction); else the title line's first words.
 */
function hookOf(analysis: Analysis, candidates: Span[], best: Span | undefined): string {
  const fits = (line: string) => {
    const n = line.split(' ').filter(Boolean).length;
    return n >= HOOK_MIN_WORDS && n <= HOOK_MAX_WORDS && line.length <= HOOK_MAX_CHARS;
  };
  const line = cleanLine(best?.text ?? '');
  if (!line) return '';
  if (fits(line)) return line;
  for (const clause of line.split(/(?<=[,.!?])\s+/)) {
    const c = clause.replace(/[,;:]+$/, '');
    if (fits(c)) return c;
  }
  for (const sp of candidates) {
    if (sp === best) continue;
    const fs = analysis.features.slice(sp.from, sp.to + 1);
    if (Math.max(...fs.map((f) => f.reaction)) >= 0.5) continue;
    const c = cleanLine(sp.text);
    if (fits(c)) return c;
  }
  const words = line.split(' ').slice(0, HOOK_MAX_WORDS);
  while (words.length > HOOK_MIN_WORDS && words.join(' ').length > HOOK_MAX_CHARS) words.pop();
  return `${words.join(' ').replace(/[,.;:!?]+$/, '')}…`;
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
): { title: string; hook: string; description: string } {
  const clipStart = analysis.units[s].start;
  const clipEnd = analysis.units[e].end;
  const spans = spansOf(analysis, s, e).map((sp) => ({ ...sp, score: scoreSpan(analysis, sp, clipStart, clipEnd) }));
  const ranked = [...spans].sort((a, b) => b.score - a.score);

  // ── Title (headline from the strongest line) ──
  const best = ranked.find((sp) => cleanLine(sp.text).length >= 25) ?? ranked[0];
  const headline = truncateWords(cleanLine(best?.text ?? ''), QUOTE_MAX) || 'Momen menarik';
  let title = headline;
  const sourceTitle = source.title?.trim();
  const show = sourceTitle ? shortSourceTitle(sourceTitle) : '';
  if (show && title.length + 3 + show.length <= TITLE_MAX) title += ` | ${show}`;

  // ── On-screen hook (short line, read in ~2 s) ──
  const hook = hookOf(analysis, ranked.slice(0, 4), best);

  // ── Description ──
  // Only lines that say something: no reactions/laughter, no 3-word replies.
  const summary = ranked
    .filter((sp) => sp !== best && isContentLine(analysis, sp))
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
  const tags = dedupeTags([...peopleTags(sourceTitle), ...hashtagsOf(analysis, s, e), '#shorts']);
  lines.push('', tags.join(' '));

  return { title, hook, description: lines.join('\n').trim() };
}
