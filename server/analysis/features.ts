/**
 * Features — per-unit "is this interesting?" signals, per-edge "is this a
 * clean place to cut?" scores, and per-edge topic-boundary strength.
 *
 * Everything here is computed once for the whole video, so scoring every
 * possible clip window afterwards is cheap (prefix sums / running maxima).
 */

import type { Unit } from './units.js';
import type { AudioFeatures, PauseSegment } from './types.js';
import {
  STOP_WORDS, STORY_MARKERS, STORY_OPENERS, OPINION_MARKERS, INSIGHT_MARKERS, REACTION_MARKERS,
  LAUGHTER_TAGS, NON_SPEECH_TAGS, QUESTION_MARKERS, CONCLUSION_MARKERS, INTRO_MARKERS,
  OUTRO_MARKERS, CTA_MARKERS, SPONSOR_MARKERS, FILLER_WORDS, FILLER_PHRASES,
  CONTEXT_DEPENDENT_STARTS, SENTENCE_STARTERS, BAD_START_WORDS, BAD_END_WORDS,
  NUMBER_WORDS, QUANTITY_UNITS,
} from './lexicon.js';

export interface UnitFeatures {
  story: number;
  /** Unit opens a story / claim / question (a natural first line). */
  opener: number;
  opinion: number;
  insight: number;
  reaction: number;
  question: number;
  conclusion: number;
  specificity: number;
  /** 0..1 percentile of how rare/specific this unit's vocabulary is in the video. */
  salience: number;
  /** 0..1 percentile of speech loudness (null when no audio). */
  energy: number | null;
  /** 0..1 percentile of words per second. */
  pace: number;
  fillerRatio: number;
  nonSpeech: boolean;
  intro: boolean;
  outro: boolean;
  cta: boolean;
  sponsor: boolean;
  contextStart: boolean;
  /** Combined 0..1 interest score. */
  interest: number;
  /** Top content words (for diversity checks and the reason text). */
  keywords: string[];
}

export interface Analysis {
  units: Unit[];
  features: UnitFeatures[];
  /** breakAfter[i]: 0..1 how cleanly speech pauses between unit i and i+1 (last = 1). */
  breakAfter: number[];
  /** topicAfter[i]: 0..1 how strongly the topic changes between unit i and i+1. */
  topicAfter: number[];
  /** startOk[i]: 0..1 how good unit i is as the first unit of a clip. */
  startQuality: number[];
  /** endOk[i]: 0..1 how good unit i is as the last unit of a clip. */
  endQuality: number[];
  idf: Map<string, number>;
  silences: PauseSegment[];
  totalDuration: number;
}

function countPhrases(norm: string, phrases: readonly string[]): number {
  let n = 0;
  for (const p of phrases) if (norm.includes(` ${p} `)) n++;
  return n;
}

function startsWithAny(norm: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => norm.startsWith(` ${p} `));
}

function percentileRanks(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  const n = Math.max(1, values.length - 1);
  idx.forEach(([, i], r) => { ranks[i] = r / n; });
  return ranks;
}

function contentWords(words: string[]): string[] {
  return words.filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !FILLER_WORDS.has(w) && !/^\d+$/.test(w));
}

function specificityOf(words: string[]): number {
  let score = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const isNum = /\d/.test(w) || NUMBER_WORDS.has(w);
    if (!isNum) continue;
    const next = words[i + 1] ?? '';
    score += QUANTITY_UNITS.has(next) || w.endsWith('%') ? 1 : 0.5;
  }
  return Math.min(1, score / 2);
}

/** Mean RMS of the audio seconds covered by [start, end). */
function rmsBetween(rms: number[], start: number, end: number): number {
  const a = Math.max(0, Math.floor(start));
  const b = Math.min(rms.length, Math.max(a + 1, Math.ceil(end)));
  let sum = 0;
  for (let i = a; i < b; i++) sum += rms[i];
  return b > a ? sum / (b - a) : 0;
}

/** Longest silence overlapping [from, to] (binary search on sorted silences). */
function silenceNear(silences: PauseSegment[], from: number, to: number): number {
  let lo = 0, hi = silences.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (silences[mid].endTime < from) lo = mid + 1; else hi = mid; }
  let best = 0;
  for (let i = lo; i < silences.length && silences[i].startTime <= to; i++) {
    best = Math.max(best, silences[i].duration);
  }
  return best;
}

export function analyzeUnits(units: Unit[], audio: AudioFeatures | null): Analysis {
  const n = units.length;
  const totalDuration = n ? units[n - 1].end : 0;
  const silences = audio ? [...audio.silenceSegments].sort((a, b) => a.startTime - b.startTime) : [];

  // ── IDF over units ───────────────────────────────────────────────
  const df = new Map<string, number>();
  const unitContent = units.map((u) => contentWords(u.words));
  for (const cw of unitContent) for (const w of new Set(cw)) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [w, d] of df) idf.set(w, Math.log((n + 1) / (d + 0.5)));

  // ── Raw per-unit signals ─────────────────────────────────────────
  const rawSalience = unitContent.map((cw, i) => {
    const total = units[i].words.length || 1;
    if (cw.length === 0) return 0;
    const meanIdf = cw.reduce((s, w) => s + (idf.get(w) ?? 0), 0) / cw.length;
    return meanIdf * Math.sqrt(cw.length / total); // specific words AND not mostly chatter
  });
  const salience = percentileRanks(rawSalience);

  const paceRaw = units.map((u) => u.words.length / Math.max(0.5, u.end - u.start));
  const pace = percentileRanks(paceRaw);

  let energy: (number | null)[] = units.map(() => null);
  if (audio && audio.rmsPerSecond.length > 0) {
    const raw = units.map((u) => rmsBetween(audio.rmsPerSecond, u.start, u.end));
    energy = percentileRanks(raw);
  }

  const introZone = Math.min(120, totalDuration * 0.06);
  const outroZone = totalDuration - Math.min(120, totalDuration * 0.06);

  const features: UnitFeatures[] = units.map((u, i) => {
    const norm = u.norm;
    const fillerCount = u.words.filter((w) => FILLER_WORDS.has(w)).length + countPhrases(norm, FILLER_PHRASES);
    const tagText = ` ${u.tags.join(' ')} `;
    const laughter = LAUGHTER_TAGS.some((t) => tagText.includes(t)) ? 1 : 0;
    const nonSpeech = u.words.length === 0 || (NON_SPEECH_TAGS.some((t) => tagText.includes(t)) && u.words.length < 3);
    const question = Math.min(1, countPhrases(norm, QUESTION_MARKERS) * 0.5 + (u.text.includes('?') ? 0.6 : 0));

    const opensWith = (list: readonly string[]) => startsWithAny(norm, list) || startsWithAny(` ${u.words.slice(1).join(' ')} `, list);
    const f: UnitFeatures = {
      story: Math.min(1, countPhrases(norm, STORY_MARKERS) * 0.6),
      opener: opensWith(STORY_OPENERS) || opensWith(OPINION_MARKERS) || opensWith(QUESTION_MARKERS) ||
        opensWith(['nah kalau', 'nah kalo', 'kalau kalian', 'kalo kalian', 'ada tiga', 'ada dua', 'ada lima', 'caranya'])
        ? 1 : 0,
      opinion: Math.min(1, countPhrases(norm, OPINION_MARKERS) * 0.7),
      insight: Math.min(1, countPhrases(norm, INSIGHT_MARKERS) * 0.5),
      reaction: Math.min(1, countPhrases(norm, REACTION_MARKERS) * 0.5 + laughter + (u.text.includes('!') ? 0.3 : 0)),
      question,
      conclusion: Math.min(1, countPhrases(norm, CONCLUSION_MARKERS) * 0.7 + (u.words[0] === 'jadi' ? 0.4 : 0)),
      specificity: specificityOf(u.words),
      salience: salience[i],
      energy: energy[i],
      pace: pace[i],
      fillerRatio: u.words.length ? fillerCount / u.words.length : 0,
      nonSpeech,
      intro: u.start < introZone && countPhrases(norm, INTRO_MARKERS) > 0,
      outro: u.end > outroZone && countPhrases(norm, OUTRO_MARKERS) > 0,
      cta: countPhrases(norm, CTA_MARKERS) > 0,
      sponsor: countPhrases(norm, SPONSOR_MARKERS) > 0,
      contextStart: startsWithAny(norm, CONTEXT_DEPENDENT_STARTS),
      interest: 0,
      keywords: [...new Set(unitContent[i])].sort((a, b) => (idf.get(b) ?? 0) - (idf.get(a) ?? 0)).slice(0, 4),
    };

    const hasAudio = f.energy !== null;
    let interest =
      0.26 * f.salience +
      0.12 * f.specificity +
      0.14 * f.story +
      0.16 * f.opinion +
      0.12 * f.insight +
      0.14 * f.reaction +
      0.08 * f.question +
      (hasAudio ? 0.14 * (f.energy as number) + 0.04 * f.pace : 0.10 * f.pace);
    interest -= Math.min(0.3, f.fillerRatio * 2.5);
    if (f.nonSpeech) interest = 0;
    f.interest = Math.max(0, Math.min(1, interest / 0.6));
    return f;
  });

  // ── Edge quality: is there a natural pause between unit i and i+1? ──
  const breakAfter = units.map((u, i) => {
    if (i === n - 1) return 1;
    const next = units[i + 1];
    let s = 0.15; // caption cues often (not always) end on a phrase boundary
    if (u.terminal) s += 0.45;
    else if (u.comma) s += 0.15;
    const gap = next.start - u.end;
    if (gap >= 0.6) s += 0.4; else if (gap >= 0.25) s += 0.25;
    if (silences.length) {
      const pause = silenceNear(silences, u.end - 0.35, next.start + 0.35);
      if (pause >= 0.5) s += 0.45; else if (pause >= 0.25) s += 0.25;
    }
    const nextFirst = next.words[0] ?? '';
    const lastWord = u.words[u.words.length - 1] ?? '';
    if (SENTENCE_STARTERS.includes(nextFirst) || startsWithAny(next.norm, STORY_MARKERS) ||
        startsWithAny(next.norm, OPINION_MARKERS) || startsWithAny(next.norm, QUESTION_MARKERS)) s += 0.2;
    if (BAD_END_WORDS.has(lastWord)) s -= 0.55;
    if (BAD_START_WORDS.has(nextFirst)) s -= 0.3;
    return Math.max(0, Math.min(1, s));
  });

  // ── Topic boundaries (TextTiling-style depth on IDF-weighted vectors) ──
  const TOPIC_WINDOW = 45; // seconds on each side
  const sims = new Array<number>(Math.max(0, n - 1)).fill(1);
  const vec = (from: number, to: number) => {
    const v = new Map<string, number>();
    for (let k = from; k <= to; k++) {
      for (const w of unitContent[k]) v.set(w, (v.get(w) ?? 0) + (idf.get(w) ?? 0));
    }
    return v;
  };
  const MIN_TOPIC_WORDS = 15; // too little text on a side → no reliable topic signal
  const cosine = (a: Map<string, number>, b: Map<string, number>) => {
    let dot = 0, na = 0, nb = 0;
    for (const [, x] of a) na += x * x;
    for (const [, y] of b) nb += y * y;
    for (const [w, x] of a) { const y = b.get(w); if (y) dot += x * y; }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  };
  let left = 0;
  let right = 0;
  for (let i = 0; i < n - 1; i++) {
    const t = units[i].end;
    while (units[left].start < t - TOPIC_WINDOW) left++;
    if (right < i + 1) right = i + 1;
    while (right + 1 < n && units[right + 1].end <= t + TOPIC_WINDOW) right++;
    const lv = vec(left, i), rv = vec(i + 1, right);
    let lw = 0, rw = 0;
    for (let k = left; k <= i; k++) lw += unitContent[k].length;
    for (let k = i + 1; k <= right; k++) rw += unitContent[k].length;
    sims[i] = lw < MIN_TOPIC_WORDS || rw < MIN_TOPIC_WORDS ? NaN : cosine(lv, rv);
  }
  // Sides without enough words: treat as "same topic" (median similarity).
  const finite = sims.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const medianSim = finite.length ? finite[Math.floor(finite.length / 2)] : 1;
  for (let i = 0; i < sims.length; i++) if (!Number.isFinite(sims[i])) sims[i] = medianSim;
  // Light smoothing, then depth score.
  const smooth = sims.map((_, i) => {
    const a = sims[Math.max(0, i - 1)], b = sims[i], c = sims[Math.min(sims.length - 1, i + 1)];
    return (a + 2 * b + c) / 4;
  });
  const depth = smooth.map((s, i) => {
    let lp = s; for (let k = i - 1; k >= 0 && smooth[k] >= lp; k--) lp = smooth[k];
    let rp = s; for (let k = i + 1; k < smooth.length && smooth[k] >= rp; k++) rp = smooth[k];
    return (lp - s) + (rp - s);
  });
  // A topic boundary is a depth well above the video's typical depth
  // (mean + 2σ → 1.0). Ordinary wobble in vocabulary stays near 0.
  const meanDepth = depth.reduce((a, b) => a + b, 0) / Math.max(1, depth.length);
  const sdDepth = Math.sqrt(depth.reduce((a, b) => a + (b - meanDepth) ** 2, 0) / Math.max(1, depth.length)) || 1;
  const topicAfter = units.map((_, i) => {
    if (i >= n - 1) return 1;
    const strength = Math.max(0, Math.min(1, (depth[i] - meanDepth) / (2 * sdDepth)));
    // New vocabulary in a conclusion line ("dari situ gue sadar...") is the
    // payoff of the same topic, not a new topic.
    const intoConclusion = Math.max(features[i + 1].conclusion, features[Math.min(n - 1, i + 2)].conclusion);
    return intoConclusion >= 0.4 ? strength * 0.3 : strength;
  });

  // Punctuated transcripts (Whisper, manual captions): a clip must end on a
  // full stop and start after one. Unpunctuated (YouTube auto-captions):
  // rely on pauses and word cues only.
  const punctuated = units.filter((u) => /[.!?,]/.test(u.text)).length >= units.length * 0.3;

  // ── Start / end quality per unit ─────────────────────────────────
  const startQuality = units.map((u, i) => {
    const before = i === 0 ? 0.9 : breakAfter[i - 1];
    const first = u.words[0] ?? '';
    let q = before;
    if (BAD_START_WORDS.has(first)) q -= 0.35;
    if (features[i].contextStart) q -= 0.3;
    if (features[i].fillerRatio > 0.25) q -= 0.2;
    if (features[i].nonSpeech) q -= 0.5;
    if (punctuated && i > 0 && !units[i - 1].terminal) q -= 0.3;
    return Math.max(0, Math.min(1, q));
  });
  const endQuality = units.map((u, i) => {
    const last = u.words[u.words.length - 1] ?? '';
    let q = breakAfter[i];
    if (BAD_END_WORDS.has(last)) q -= 0.2; // already partly in breakAfter
    if (features[i].nonSpeech) q -= 0.3;
    if (punctuated && !u.terminal) q -= 0.35;
    return Math.max(0, Math.min(1, q));
  });

  return { units, features, breakAfter, topicAfter, startQuality, endQuality, idf, silences, totalDuration };
}
