/**
 * Retention Predictor — Multi-Phase Retention Estimation
 *
 * Predicts viewer retention probability for each candidate clip.
 * Instead of a simple "viral score", estimates retention at 3 phases:
 *
 * 1. Hook (0-3s): Will they stay past the first 3 seconds?
 * 2. Maintain (3-10s): Will they keep watching?
 * 3. Payoff (10s-end): Was it worth watching until the end?
 *
 * Each phase uses different signals combined via weighted scoring.
 */

import type { CandidateClip, RetentionScore, AudioFeatures } from './types.js';
import {
  HOOK_WEIGHT,
  MAINTAIN_WEIGHT,
  PAYOFF_WEIGHT,
  HOOK_CURIOSITY_MAX,
  HOOK_EMOTIONAL_MAX,
  HOOK_SELF_CONTAINED_MAX,
  MAINTAIN_PACING_MAX,
  MAINTAIN_ENGAGEMENT_MAX,
  MAINTAIN_NO_DEAD_AIR_MAX,
  PAYOFF_ENDING_MAX,
  PAYOFF_VALUE_DELIVERY_MAX,
  PAYOFF_NO_TRAILING_MAX,
} from './constants.js';
import {
  splitSentences,
  startsWithQuestion,
  startsWithExclamation,
  hasContextDependency,
  countEmotionalWords,
  hasStrongEnding,
  hasQuestionAnswerPattern,
  informationDensity,
  tokenize,
  exclamationCount,
  questionCount,
} from './text-utils.js';

/**
 * Predict retention for a candidate clip
 */
export function predictRetention(
  clip: CandidateClip,
  audioFeatures: AudioFeatures | null,
): RetentionScore {
  const sentences = splitSentences(clip.text);
  const tokens = tokenize(clip.text);
  const wordCount = tokens.length;

  // Phase 1: Hook (first sentence = ~first 3 seconds)
  const firstSentence = sentences[0] || clip.text.slice(0, 100);
  const hookScore = scoreHook(firstSentence, clip.startTime, audioFeatures);

  // Phase 2: Maintain (body sentences)
  const bodySentences = sentences.slice(1);
  const maintainScore = scoreMaintain(bodySentences, wordCount, clip.text, audioFeatures, clip.startTime, clip.endTime);

  // Phase 3: Payoff (last sentence)
  const lastSentence = sentences[sentences.length - 1] || '';
  const payoffScore = scorePayoff(lastSentence, sentences, wordCount, clip.text, clip.endTime, audioFeatures);

  // Overall weighted score
  const overall = Math.round(
    hookScore * HOOK_WEIGHT +
    maintainScore * MAINTAIN_WEIGHT +
    payoffScore * PAYOFF_WEIGHT,
  );

  return {
    hook3s: Math.round(hookScore),
    maintain10s: Math.round(maintainScore),
    payoffFull: Math.round(payoffScore),
    overall: Math.min(100, Math.max(0, overall)),
  };
}

/**
 * Score the hook phase (first 3 seconds = first sentence)
 *
 * What makes a great hook:
 * - Question opening (creates curiosity gap)
 * - Exclamation / emotional start
 * - Self-contained (doesn't need context)
 * - Punchy short sentence
 */
function scoreHook(
  firstSentence: string,
  clipStartTime: number,
  audioFeatures: AudioFeatures | null,
): number {
  let score = 0;

  // ── Curiosity Opening (0-40) ──────────────────────────────────
  if (startsWithQuestion(firstSentence)) {
    score += HOOK_CURIOSITY_MAX * 0.8; // Strong: question directly
  } else if (firstSentence.includes('?')) {
    score += HOOK_CURIOSITY_MAX * 0.4; // Question in middle
  }

  // Curiosity gap patterns
  const gapPatterns = [
    /yang (gak|nggak|tidak) (akan|bakal)/i,
    /yang (membuat|bikin|buit) (saya|aku|kamu|anda)/i,
    /rahasia|tips|trik|alasan (kenapa|mengapa)/i,
    /gak (akan|bakal) (kamu|anda) (sangka|duga)/i,
  ];
  for (const pattern of gapPatterns) {
    if (pattern.test(firstSentence)) {
      score += HOOK_CURIOSITY_MAX * 0.3;
      break;
    }
  }

  // ── Emotional Hook (0-30) ─────────────────────────────────────
  if (startsWithExclamation(firstSentence)) {
    score += HOOK_EMOTIONAL_MAX * 0.4;
  }

  const emotionCount = countEmotionalWords(firstSentence);
  score += Math.min(HOOK_EMOTIONAL_MAX * 0.3, emotionCount * 5);

  // Short punchy sentence (< 8 words)
  const wordCount = firstSentence.split(/\s+/).length;
  if (wordCount >= 2 && wordCount <= 8) {
    score += HOOK_EMOTIONAL_MAX * 0.3;
  }

  // ── Self-Contained Start (0-30) ───────────────────────────────
  if (!hasContextDependency(firstSentence)) {
    score += HOOK_SELF_CONTAINED_MAX * 0.6; // No context dependency
  } else {
    score -= HOOK_SELF_CONTAINED_MAX * 0.3; // Penalty for context dependency
  }

  // Starts with a clear topic introduction
  const topicIndicators = [
    'jadi', 'nah', 'oke', 'baik', 'kali ini', 'hari ini',
    'ada', 'ini', 'itu', 'satu', 'sebuah',
  ];
  const firstWord = firstSentence.toLowerCase().split(/\s+/)[0];
  if (topicIndicators.includes(firstWord)) {
    score += HOOK_SELF_CONTAINED_MAX * 0.4;
  }

  // ── Audio Signal Boost (if available) ─────────────────────────
  if (audioFeatures) {
    // Check if there's an energy burst at clip start (emotional emphasis)
    const startBursts = audioFeatures.energyBursts.filter(
      b => Math.abs(b.time - clipStartTime) < 1.0,
    );
    if (startBursts.length > 0) {
      score += 10;
    }

    // Check that clip doesn't start in silence
    const startSilence = audioFeatures.silenceSegments.find(
      s => Math.abs(s.endTime - clipStartTime) < 0.5,
    );
    if (startSilence) {
      score -= 15; // Starts with silence = weak hook
    }
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Score the maintain phase (body of the clip, ~3-10 seconds)
 *
 * What makes people keep watching:
 * - Good pacing (no dead air)
 * - Narrative progression
 * - Information density
 * - Emotional variation
 */
function scoreMaintain(
  bodySentences: string[],
  totalWordCount: number,
  fullText: string,
  audioFeatures: AudioFeatures | null,
  startTime: number,
  endTime: number,
): number {
  let score = 30; // Base score

  // ── Pacing (0-30) ────────────────────────────────────────────
  const bodyText = bodySentences.join(' ');
  const bodyWords = tokenize(bodyText);
  const duration = endTime - startTime;

  // Information density: unique meaningful words / total words
  const infoDensity = informationDensity(bodyText);
  score += infoDensity * MAINTAIN_PACING_MAX;

  // Speaking rate check (too fast or too slow = poor pacing)
  if (duration > 0) {
    const wordsPerSecond = totalWordCount / duration;
    if (wordsPerSecond >= 1.5 && wordsPerSecond <= 4.5) {
      score += MAINTAIN_PACING_MAX * 0.2; // Good pace
    } else if (wordsPerSecond > 5.0) {
      score -= MAINTAIN_PACING_MAX * 0.2; // Too fast
    } else if (wordsPerSecond < 1.0) {
      score -= MAINTAIN_PACING_MAX * 0.3; // Too slow
    }
  }

  // ── Engagement Flow (0-40) ────────────────────────────────────
  // Narrative progression — multiple distinct stages
  if (bodySentences.length >= 3) {
    score += MAINTAIN_ENGAGEMENT_MAX * 0.15;
  }

  // Question-answer pattern (highly engaging)
  if (hasQuestionAnswerPattern(bodyText)) {
    score += MAINTAIN_ENGAGEMENT_MAX * 0.25;
  }

  // Emotional words throughout
  const emotionCount = countEmotionalWords(bodyText);
  score += Math.min(MAINTAIN_ENGAGEMENT_MAX * 0.2, emotionCount * 3);

  // Information-rich (not just filler)
  if (infoDensity > 0.6) {
    score += MAINTAIN_ENGAGEMENT_MAX * 0.15;
  }

  // Exclamation and question marks throughout
  const exclams = exclamationCount(bodyText);
  const questions = questionCount(bodyText);
  score += Math.min(10, exclams * 2 + questions * 2);

  // ── No Dead Air (0-30) (from audio features) ──────────────────
  if (audioFeatures) {
    const clipDuration = endTime - startTime;
    if (clipDuration > 0) {
      // Count total silence in this clip's range
      const silencesInClip = audioFeatures.silenceSegments.filter(
        s => s.startTime >= startTime && s.endTime <= endTime,
      );
      const totalSilence = silencesInClip.reduce((sum, s) => sum + s.duration, 0);
      const silenceRatio = totalSilence / clipDuration;

      if (silenceRatio < 0.1) {
        score += MAINTAIN_NO_DEAD_AIR_MAX * 0.8; // Great — minimal silence
      } else if (silenceRatio < 0.2) {
        score += MAINTAIN_NO_DEAD_AIR_MAX * 0.4; // OK
      } else {
        score -= MAINTAIN_NO_DEAD_AIR_MAX * 0.5; // Too much silence
      }

      // Energy bursts throughout = dynamic delivery
      const burstCount = audioFeatures.energyBursts.filter(
        b => b.time >= startTime && b.time <= endTime,
      ).length;
      if (burstCount >= 2) {
        score += 10;
      }
    }
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Score the payoff phase (last sentence, conclusion/punchline)
 *
 * What makes a satisfying ending:
 * - Strong resolution or punchline
 * - Delivers on the hook's promise
 * - No trailing filler
 * - Natural feeling ending
 */
function scorePayoff(
  lastSentence: string,
  allSentences: string[],
  totalWordCount: number,
  fullText: string,
  endTime: number,
  audioFeatures: AudioFeatures | null,
): number {
  let score = 20; // Base score

  // ── Ending Strength (0-40) ────────────────────────────────────
  if (hasStrongEnding(allSentences)) {
    score += PAYOFF_ENDING_MAX * 0.5; // Strong ending signal
  }

  // Ends with exclamation (punchy ending)
  const trimmed = lastSentence.trim();
  if (trimmed.endsWith('!')) {
    score += PAYOFF_ENDING_MAX * 0.3;
  }

  // Ends with a short, punchy sentence
  const lastWordCount = lastSentence.split(/\s+/).length;
  if (lastWordCount >= 2 && lastWordCount <= 10) {
    score += PAYOFF_ENDING_MAX * 0.2;
  }

  // Natural conclusion signals
  const conclusionWords = ['jadi', 'akhirnya', 'kesimpulannya', 'intinya', 'gitu', 'makanya'];
  const lastWords = lastSentence.toLowerCase();
  if (conclusionWords.some(w => lastWords.includes(w))) {
    score += PAYOFF_ENDING_MAX * 0.2;
  }

  // ── Value Delivery (0-30) ─────────────────────────────────────
  // The clip should deliver on its initial promise
  // Estimate: if clip has both a hook and resolution, value is delivered
  if (allSentences.length >= 3) {
    score += PAYOFF_VALUE_DELIVERY_MAX * 0.3; // Complete thought
  }

  // Information-rich payoff
  const infoDensity = informationDensity(lastSentence);
  if (infoDensity > 0.5) {
    score += PAYOFF_VALUE_DELIVERY_MAX * 0.2;
  }

  // Emotional payoff
  const emotionCount = countEmotionalWords(lastSentence);
  if (emotionCount > 0) {
    score += PAYOFF_VALUE_DELIVERY_MAX * 0.3;
  }

  // ── No Trailing Filler (0-30) ──────────────────────────────────
  // Check if last sentence has trailing filler
  const fillerEndings = ['dan', 'dan juga', 'serta', 'atau', 'tapi', 'namun'];
  const lastWord = lastWords.split(/\s+/).pop() || '';
  if (fillerEndings.includes(lastWord)) {
    score -= PAYOFF_NO_TRAILING_MAX * 0.5; // Ends abruptly with filler
  }

  // Check for CTA near end (weak ending)
  if (/(subscribe|like|share|follow)/i.test(lastSentence)) {
    score -= PAYOFF_NO_TRAILING_MAX * 0.3;
  }

  // Check if the clip text ends naturally (no dangling clauses)
  const endsComplete = /[.!?]$/.test(trimmed);
  if (endsComplete) {
    score += PAYOFF_NO_TRAILING_MAX * 0.4;
  }

  // ── Audio Signal Boost (if available) ─────────────────────────
  if (audioFeatures && allSentences.length > 0) {
    // Estimate end time based on sentence position
    // (rough — full text length proportion)
    const clipEndEstimate = endTime; // Use actual clip end time
    const endBursts = audioFeatures.energyBursts.filter(
      b => b.time > clipEndEstimate - 1,
    );
    if (endBursts.length > 0) {
      score += 10; // Emphatic ending
    }
  }

  return Math.min(100, Math.max(0, score));
}