/**
 * Selector — score EVERY possible clip window (unit-aligned, MIN..MAX seconds)
 * across the whole video, then pick the best non-overlapping, topically
 * different ones and polish their boundaries on real pauses.
 */

import type { Analysis } from './features.js';
import type { ViralMoment } from './types.js';
import { describeClip, type SourceInfo } from './describe.js';
import {
  CLIP_MIN_SECONDS, CLIP_MAX_SECONDS, CLIP_IDEAL_SECONDS, CLIP_IDEAL_SPREAD,
  HOOK_WINDOW_SECONDS, PAYOFF_WINDOW_SECONDS, MIN_START_QUALITY, MIN_END_QUALITY,
  MIN_GAP_BETWEEN_CLIPS, MAX_KEYWORD_OVERLAP, MIN_RELATIVE_SCORE, WEIGHTS,
  EDGE_ZONE_SECONDS, EDGE_ZONE_FRACTION,
} from './constants.js';

interface Window {
  s: number;
  e: number;
  score: number;
  density: number;
  peak: number;
  hook: number;
  payoff: number;
  coherence: number;
  penalty: number;
}

/** Duration-weighted mean of `values` over units [a, b]. */
function weightedMean(values: number[], a: number, b: number, analysis: Analysis): number {
  let sum = 0, dur = 0;
  for (let k = a; k <= b; k++) {
    const d = analysis.units[k].end - analysis.units[k].start;
    sum += values[k] * d; dur += d;
  }
  return dur > 0 ? sum / dur : 0;
}

export function scoreWindows(analysis: Analysis, relax = false): Window[] {
  const { units, features, startQuality, endQuality, topicAfter } = analysis;
  const n = units.length;
  const interest = features.map((f) => f.interest);
  const minDur = relax ? Math.min(CLIP_MIN_SECONDS, analysis.totalDuration * 0.8) : CLIP_MIN_SECONDS;
  const minStart = relax ? 0 : MIN_START_QUALITY;
  const minEnd = relax ? 0 : MIN_END_QUALITY;

  // Prefix sums for O(1) window aggregates.
  const pre = (fn: (k: number) => number) => {
    const p = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) p[k + 1] = p[k] + fn(k);
    return p;
  };
  const durP = pre((k) => units[k].end - units[k].start);
  const intP = pre((k) => interest[k] * (units[k].end - units[k].start));
  const wordP = pre((k) => units[k].words.length);
  const fillP = pre((k) => features[k].fillerRatio * units[k].words.length);
  const silentP = pre((k) => (features[k].nonSpeech ? units[k].end - units[k].start : 0));
  const sponsorP = pre((k) => (features[k].sponsor ? 1 : 0));
  const ctaP = pre((k) => (features[k].cta ? 1 : 0));
  const introP = pre((k) => (features[k].intro ? 1 : 0));
  const outroP = pre((k) => (features[k].outro ? 1 : 0));
  const sum = (p: Float64Array, a: number, b: number) => p[b + 1] - p[a];

  // Hook: interest of the first HOOK_WINDOW seconds + strong opener signals.
  const hookAt = units.map((u, s) => {
    let b = s;
    while (b + 1 < n && units[b + 1].start < u.start + HOOK_WINDOW_SECONDS) b++;
    const f0 = features[s];
    const f1 = features[Math.min(s + 1, n - 1)];
    const opener = Math.max(f0.opener, f0.question * 0.8, f0.reaction * 0.6, f1.opener * 0.5);
    return 0.45 * weightedMean(interest, s, b, analysis) + 0.25 * opener + 0.30 * startQuality[s];
  });
  // Payoff: interest of the last PAYOFF_WINDOW seconds + conclusion/reaction at the end.
  const payoffAt = units.map((u, e) => {
    let a = e;
    while (a - 1 >= 0 && units[a - 1].end > u.end - PAYOFF_WINDOW_SECONDS) a--;
    let closing = 0;
    for (let k = a; k <= e; k++) closing = Math.max(closing, features[k].conclusion, features[k].reaction * 0.8);
    return 0.30 * weightedMean(interest, a, e, analysis) + 0.25 * closing + 0.45 * endQuality[e];
  });

  // Interest just before a start / just after an end. A good clip covers a
  // whole "island" of interesting talk: dull before it, dull after it.
  const CONTEXT = 12;
  const beforeAt = units.map((u, s) => {
    let a = s;
    while (a - 1 >= 0 && units[a - 1].start >= u.start - CONTEXT) a--;
    return a < s ? weightedMean(interest, a, s - 1, analysis) : 0;
  });
  const afterAt = units.map((u, e) => {
    let b = e;
    while (b + 1 < n && units[b + 1].end <= u.end + CONTEXT) b++;
    return b > e ? weightedMean(interest, e + 1, b, analysis) : 0;
  });

  // Opening / closing zones of the video: greetings, guest intro, thanks,
  // apologies, sign-off. Rarely the best clip, so overlapping them costs.
  const zone = Math.min(EDGE_ZONE_SECONDS, analysis.totalDuration * EDGE_ZONE_FRACTION);
  const introEnd = analysis.totalDuration > 4 * zone ? zone : 0;
  const outroStart = analysis.totalDuration > 4 * zone ? analysis.totalDuration - zone : Infinity;

  const windows: Window[] = [];
  for (let s = 0; s < n; s++) {
    if (startQuality[s] < minStart) continue;
    let peak1 = 0, peak2 = 0, internalTopic = 0;
    for (let e = s; e < n; e++) {
      const v = interest[e];
      if (v > peak1) { peak2 = peak1; peak1 = v; } else if (v > peak2) peak2 = v;
      if (e > s) internalTopic = Math.max(internalTopic, topicAfter[e - 1]);

      const duration = units[e].end - units[s].start;
      if (duration > CLIP_MAX_SECONDS) break;
      if (duration < minDur || endQuality[e] < minEnd) continue;

      const speechDur = sum(durP, s, e) || duration;
      const density = sum(intP, s, e) / speechDur;
      const peak = (peak1 + peak2) / 2;
      const hook = hookAt[s];
      const payoff = payoffAt[e];
      // One idea per clip: a strong topic change inside the clip is bad,
      // starting/ending exactly on a topic change is good.
      const coherence = 1 - internalTopic;
      const edgesOnTopic = 0.5 * (s === 0 ? 1 : topicAfter[s - 1]) + 0.5 * topicAfter[e];
      const durFit = Math.exp(-(((duration - CLIP_IDEAL_SECONDS) / CLIP_IDEAL_SPREAD) ** 2));
      const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
      const island = 0.5 * clamp01((density - beforeAt[s]) / 0.4) + 0.5 * clamp01((density - afterAt[e]) / 0.4);

      let penalty = 0;
      const words = sum(wordP, s, e);
      if (words / duration < 0.5) continue; // (almost) no speech: never a clip
      if (sum(sponsorP, s, e) > 0) penalty += 0.8;
      if (sum(ctaP, s, e) > 0) penalty += 0.3;
      if (sum(introP, s, e) > 0) penalty += 0.5;
      if (sum(outroP, s, e) > 0) penalty += 0.5;
      const fillerRatio = words ? sum(fillP, s, e) / words : 0;
      penalty += Math.max(0, fillerRatio - 0.05) * 3;
      penalty += (sum(silentP, s, e) / duration) * 1.5;
      if (words / duration < 1.2) penalty += 0.3; // mostly music / silence
      const ws = units[s].start, we = units[e].end;
      const edgeOverlap = Math.max(0, Math.min(we, introEnd) - ws) + Math.max(0, we - Math.max(ws, outroStart));
      if (edgeOverlap > 0) penalty += 0.15 + 0.5 * (edgeOverlap / duration);

      const score =
        WEIGHTS.density * density +
        WEIGHTS.peak * peak +
        WEIGHTS.hook * hook +
        WEIGHTS.payoff * payoff +
        WEIGHTS.coherence * coherence +
        WEIGHTS.topicEdges * edgesOnTopic +
        WEIGHTS.island * island +
        WEIGHTS.duration * durFit -
        penalty;

      windows.push({ s, e, score, density, peak, hook, payoff, coherence, penalty });
    }
  }
  return windows;
}

function windowKeywords(analysis: Analysis, s: number, e: number): Set<string> {
  const counts = new Map<string, number>();
  for (let k = s; k <= e; k++) {
    for (const w of analysis.features[k].keywords) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] * (analysis.idf.get(b[0]) ?? 0) - a[1] * (analysis.idf.get(a[0]) ?? 0))
      .slice(0, 12)
      .map(([w]) => w),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** Move start/end onto real pauses when audio is available (never into another unit's speech). */
function polishBoundaries(analysis: Analysis, s: number, e: number): { start: number; end: number } {
  const { units, silences } = analysis;
  let start = units[s].start;
  let end = units[e].end;
  const prevEnd = s > 0 ? units[s - 1].end : 0;
  const nextStart = e + 1 < units.length ? units[e + 1].start : end + 1;

  const near = (from: number, to: number) =>
    silences.filter((p) => p.endTime >= from && p.startTime <= to && p.duration >= 0.2);

  // Start: just after a pause that ends close to the unit start.
  const startPauses = near(start - 0.8, start + 0.4);
  if (startPauses.length) {
    const p = startPauses.reduce((a, b) => (b.duration > a.duration ? b : a));
    start = Math.max(prevEnd - 0.05, p.endTime - 0.12);
  } else {
    start = Math.max(prevEnd, start - 0.1);
  }
  // End: a little into the pause after the last word, or a short tail.
  const endPauses = near(end - 0.5, end + 0.9);
  if (endPauses.length) {
    const p = endPauses.reduce((a, b) => (b.duration > a.duration ? b : a));
    end = Math.min(p.startTime + Math.min(0.4, p.duration * 0.6), Math.max(end, p.startTime + 0.1));
  } else {
    end = Math.min(nextStart + 0.05, end + 0.3);
  }
  start = Math.max(0, start);
  return { start: Math.round(start * 100) / 100, end: Math.round(Math.max(end, start + 1) * 100) / 100 };
}

function describe(analysis: Analysis, w: Window, keywords: Set<string>): { reason: string; tags: string[] } {
  const f = analysis.features.slice(w.s, w.e + 1);
  const has = (key: 'story' | 'opinion' | 'insight' | 'reaction' | 'question' | 'specificity' | 'conclusion') =>
    f.some((x) => x[key] >= 0.5);
  const tags: string[] = [];
  if (has('story')) tags.push('cerita');
  if (has('opinion')) tags.push('opini');
  if (has('insight')) tags.push('insight/tips');
  if (has('specificity')) tags.push('angka/fakta');
  if (has('question')) tags.push('tanya-jawab');
  if (has('reaction')) tags.push('reaksi');

  const parts: string[] = [];
  if (w.hook >= 0.6) parts.push('pembuka kuat');
  if (w.payoff >= 0.6) parts.push('penutup tuntas');
  if (w.coherence >= 0.7) parts.push('satu topik utuh');
  if (tags.length) parts.push(`berisi ${tags.join(', ')}`);
  const topic = [...keywords].slice(0, 4).join(', ');
  if (topic) parts.push(`topik: ${topic}`);
  return { reason: parts.join(' · ') || 'bagian paling padat isi', tags };
}

export function selectMoments(analysis: Analysis, maxResults: number, source: SourceInfo = {}): ViralMoment[] {
  let windows = scoreWindows(analysis);
  if (windows.length < maxResults) windows = windows.concat(scoreWindows(analysis, true));
  windows.sort((a, b) => b.score - a.score);

  const chosen: { w: Window; kw: Set<string> }[] = [];
  for (const w of windows) {
    if (chosen.length >= maxResults) break;
    // Don't pad the result with clearly weaker clips (the best one is always kept).
    if (chosen.length > 0 && w.score < chosen[0].w.score * MIN_RELATIVE_SCORE) break;
    const start = analysis.units[w.s].start;
    const end = analysis.units[w.e].end;
    const overlaps = chosen.some(({ w: c }) => {
      const cs = analysis.units[c.s].start - MIN_GAP_BETWEEN_CLIPS;
      const ce = analysis.units[c.e].end + MIN_GAP_BETWEEN_CLIPS;
      return start < ce && end > cs;
    });
    if (overlaps) continue;
    const kw = windowKeywords(analysis, w.s, w.e);
    if (chosen.some((c) => jaccard(c.kw, kw) > MAX_KEYWORD_OVERLAP)) continue;
    chosen.push({ w, kw });
  }

  const best = chosen[0]?.w.score || 1;
  return chosen
    .map(({ w, kw }) => {
      const { start, end } = polishBoundaries(analysis, w.s, w.e);
      const { reason, tags } = describe(analysis, w, kw);
      const { title, description } = describeClip(analysis, w.s, w.e, source);
      const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);
      return {
        startTime: start,
        endTime: end,
        reason,
        title,
        description,
        retentionScore: {
          hook3s: pct(w.hook),
          maintain10s: pct(0.6 * w.density + 0.4 * w.peak),
          payoffFull: pct(w.payoff),
          overall: pct(w.score / Math.max(best, 1e-6) * 0.9),
        },
        // UI shows finalScore on a 0–10 scale.
        finalScore: Math.round(Math.max(0, Math.min(10, w.score * 10)) * 10) / 10,
        narrativeStages: tags,
      } satisfies ViralMoment;
    });
}
