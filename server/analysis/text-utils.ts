/**
 * Text utilities for the Analysis Engine
 * N-gram similarity, TF scoring, sentence tokenization, etc.
 */

import { STOP_WORDS } from './constants.js';

/**
 * Tokenize text: lowercase, remove punctuation, split by whitespace, remove stop words
 */
export function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(w => w.length > 1 && !STOP_WORDS.has(w));
  return words;
}

/**
 * Tokenize text but preserve stop words (for full text analysis)
 */
export function tokenizeFull(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').filter(w => w.length > 0);
}

/**
 * Split text into sentences using punctuation and newlines
 */
export function splitSentences(text: string): string[] {
  // Split by sentence-ending punctuation, respecting common abbreviations
  const sentences = text
    .replace(/\n+/g, '. ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return sentences;
}

/**
 * Compute term frequency vector for a list of tokens
 */
export function termFrequency(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }
  // Normalize by total count
  const total = tokens.length || 1;
  for (const key of Object.keys(tf)) {
    tf[key] /= total;
  }
  return tf;
}

/**
 * Cosine similarity between two term frequency vectors
 */
export function cosineSimilarity(
  vecA: Record<string, number>,
  vecB: Record<string, number>,
): number {
  const allKeys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (const key of allKeys) {
    const aVal = vecA[key] || 0;
    const bVal = vecB[key] || 0;
    dotProduct += aVal * bVal;
    magA += aVal * aVal;
    magB += bVal * bVal;
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Generate n-grams from tokens
 */
export function ngrams(tokens: string[], n: number): string[] {
  const result: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    result.push(tokens.slice(i, i + n).join(' '));
  }
  return result;
}

/**
 * Jaccard similarity between two sets of n-grams
 */
export function jaccardSimilarity(gramsA: string[], gramsB: string[]): number {
  const setA = new Set(gramsA);
  const setB = new Set(gramsB);

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Detect if text starts with a question
 */
export function startsWithQuestion(text: string): boolean {
  const questionWords = ['kenapa', 'mengapa', 'bagaimana', 'apakah', 'apa',
                         'siapa', 'kapan', 'dimana', 'tahukah', 'pernahkah',
                         'gimana', 'why', 'how', 'what', 'who', 'when', 'where'];
  const trimmed = text.toLowerCase().trim();
  for (const word of questionWords) {
    if (trimmed.startsWith(word)) return true;
  }
  // Check for question mark at end
  return trimmed.endsWith('?');
}

/**
 * Detect if text starts with an exclamation or high-emotion statement
 */
export function startsWithExclamation(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('!') || trimmed.endsWith('!');
}

/**
 * Count exclamation marks
 */
export function exclamationCount(text: string): number {
  return (text.match(/!/g) || []).length;
}

/**
 * Count question marks
 */
export function questionCount(text: string): number {
  return (text.match(/\?/g) || []).length;
}

/**
 * Detect if text refers to earlier context (not self-contained)
 */
export function hasContextDependency(text: string): boolean {
  const deps = [
    'tadi', 'seperti yang', 'sebelumnya', 'seperti tadi',
    'yang barusan', 'yang sudah', 'yang telah', 'diatas',
    'diatas tadi', 'seperti yang saya', 'seperti yang gue',
    'as i said', 'as mentioned', 'as we discussed',
    'kembali ke', 'lanjutan', 'seperti yang sudah',
    'seperti yang gue bilang', 'seperti yang aku bilang',
    'kayak yang gue', 'kayak yang aku',
  ];
  const lower = text.toLowerCase();
  for (const dep of deps) {
    if (lower.includes(dep)) return true;
  }
  return false;
}

/**
 * Detect if text contains CTA (call to action)
 */
export function hasCTA(text: string): boolean {
  const ctaPatterns = [
    'subscribe', 'like', 'share', 'comment', 'follow',
    'langganan', 'dukung channel', 'support', 'bell',
    'lonceng', 'nonton juga', 'tonton juga', 'cek juga',
    'jangan lupa', 'klik', 'subscribe dulu',
  ];
  const lower = text.toLowerCase();
  let matchCount = 0;
  for (const pattern of ctaPatterns) {
    if (lower.includes(pattern)) {
      matchCount++;
      if (matchCount >= 2) return true; // At least 2 CTA signals
    }
  }
  return false;
}

/**
 * Detect introduction/greeting patterns
 */
export function isGreeting(text: string): boolean {
  const greetings = [
    'halo', 'hai', 'hi', 'hey', 'selamat datang', 'welcome',
    'hello everyone', 'apa kabar', 'good morning', 'good evening',
    'assalamualaikum', 'halo semuanya', 'halo guys', 'hai guys',
    'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam',
    'kenalin', 'perkenalkan', 'let me introduce',
  ];
  const lower = text.toLowerCase().trim();
  return greetings.some(g => lower.startsWith(g));
}

/**
 * Detect outro/sign-off patterns
 */
export function isOutro(text: string): boolean {
  const outros = [
    'sampai jumpa', 'see you', 'terima kasih', 'makasih',
    'sekian', 'byebye', 'bye bye', 'see you next',
    'sampai ketemu', 'daftar pustaka', 'referensi',
    'terima kasih sudah nonton', 'makasih udah nonton',
    'thanks for watching', 'see ya', 'salam',
  ];
  const lower = text.toLowerCase().trim();
  return outros.some(o => lower.includes(o));
}

/**
 * Detect sponsor/advertisement content
 */
export function hasSponsorContent(text: string): boolean {
  const sponsorPatterns = [
    'sponsor', 'sponsored by', 'brought to you by',
    'didukung oleh', 'disponsori', 'iklan', 'advertisement',
    'promo', 'discount', 'diskon', 'kode promo', 'promo code',
    'gunakan kode', 'pakai kode',
  ];
  const lower = text.toLowerCase();
  const matches = sponsorPatterns.filter(p => lower.includes(p));
  return matches.length >= 2; // Need multiple signals
}

/**
 * Detect dead air / silence description
 */
export function isDeadAir(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  // Check if it's just filler sounds
  const fillers = ['[musik]', '[musik]', '...', 'umm', 'uhh', 'emm', 'ah', 'oh'];
  return fillers.some(f => trimmed.toLowerCase() === f);
}

/**
 * Count emotional / high-impact words
 */
export function countEmotionalWords(text: string): number {
  const emotional = [
    'gila', 'gokil', 'luar biasa', 'mengejutkan', 'wow', 'keren',
    'mantap', 'fantastis', 'spektakuler', 'dahsyat', 'sakit',
    'parah', 'edan', 'brilian', 'jenius', 'which', 'kece',
    'najis', 'anjay', 'astaga', 'astagfirullah', 'masyaallah',
    'subhanallah', 'alhamdulillah', 'incredible', 'amazing',
    'awesome', 'brilliant', 'fantastic', 'horor', 'ngeri',
    'sadis', 'brutal', 'epic', 'legend', 'legendary',
  ];
  const lower = text.toLowerCase();
  return emotional.filter(w => lower.includes(w)).length;
}

/**
 * Detect if text contains a story/narrative pattern
 */
export function hasNarrativePattern(text: string): boolean {
  const patterns = [
    /(waktu itu|dulu|saat itu|pada suatu|ceritanya)\s.+/i,
    /(tiba-tiba|mendadak|tanpa diduga)\s.+/i,
    /(ternyata|akhirnya|pada akhirnya)\s.+/i,
    /(yang paling|hal yang paling|yang bikin)\s.+/i,
  ];
  return patterns.some(p => p.test(text));
}

/**
 * Compute speaking rate from text (words per minute estimate)
 * Roughly: word count / duration_minutes
 */
export function estimateSpeakingRate(wordCount: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return (wordCount / durationSec) * 60;
}

/**
 * Check if clip has a strong ending (resolution, punchline, conclusion)
 */
export function hasStrongEnding(sentences: string[]): boolean {
  if (sentences.length === 0) return false;
  const lastSentence = sentences[sentences.length - 1].toLowerCase();

  const strongEndings = [
    'jadi', 'kesimpulannya', 'akhirnya', 'intinya',
    'ternyata', 'gitu', 'begitu', 'that\'s', 'so',
    'that is', 'itulah', "it's", 'makanya',
  ];

  // Check if last sentence starts with a conclusion signal
  const startsStrong = strongEndings.some(w => lastSentence.startsWith(w));

  // Check if last sentence is short and punchy (< 10 words)
  const wordCount = lastSentence.split(/\s+/).length;
  const isPunchy = wordCount <= 8;

  // Check if ends with punchline indicator
  const hasPunchline = /[!?]$/.test(lastSentence.trim());

  // Check if last sentence has a natural resolution feel
  const resolutionWords = ['jadi', 'gitu', 'begitu', 'ok', 'oke', 'setuju', 'sepakat'];
  const endsWithResolution = resolutionWords.some(w => {
    const words = lastSentence.split(/\s+/);
    return words[words.length - 1] === w;
  });

  return startsStrong || isPunchy || hasPunchline || endsWithResolution;
}

/**
 * Compute information density: ratio of unique meaningful words to total words
 */
export function informationDensity(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;
  const unique = new Set(tokens);
  return unique.size / tokens.length;
}

/**
 * Detect question-answer pattern within text
 */
export function hasQuestionAnswerPattern(text: string): boolean {
  const sentences = splitSentences(text);
  let questionCount = 0;
  for (const s of sentences) {
    if (s.trim().endsWith('?')) questionCount++;
  }
  return questionCount >= 1 && sentences.length >= 2;
}