/**
 * Quality Filter — Remove Unfit Candidates
 *
 * Before & during retention scoring, filter out clips that
 * are fundamentally unsuitable for short-form video.
 *
 * Filters:
 * - Greeting/Intro only
 * - Sponsor content
 * - CTA-heavy sections
 * - Outro/sign-off
 * - Dead air / mostly silence
 * - Incomplete story (context-dependent)
 * - Repeated explanations
 */

import type { CandidateClip, AudioFeatures, ContentClassification } from './types.js';
import { ContentType } from './types.js';
import {
  QUALITY_INTRO_PENALTY,
  QUALITY_SPONSOR_PENALTY,
  QUALITY_CTA_PENALTY,
  QUALITY_OUTRO_PENALTY,
  QUALITY_DEAD_AIR_PENALTY,
  QUALITY_INCOMPLETE_PENALTY,
  QUALITY_TOO_SHORT_PENALTY,
  QUALITY_TOO_LONG_PENALTY,
  QUALITY_CONTEXT_DEPENDENT_PENALTY,
  MIN_CLIP_DURATION,
  MAX_CLIP_DURATION,
} from './constants.js';
import {
  isGreeting,
  isOutro,
  hasCTA,
  hasSponsorContent,
  hasContextDependency,
  tokenize,
} from './text-utils.js';

/**
 * Apply quality filters to a candidate clip
 * Returns a penalty score (negative = bad, 0 = neutral)
 */
export function applyQualityFilters(
  clip: CandidateClip,
  audioFeatures: AudioFeatures | null,
  classification: ContentClassification,
): number {
  let penalty = 0;
  const text = clip.text.toLowerCase();
  const tokens = tokenize(clip.text);
  const duration = clip.endTime - clip.startTime;

  // ── Duration Filters ──────────────────────────────────────────
  if (duration < MIN_CLIP_DURATION) {
    penalty += QUALITY_TOO_SHORT_PENALTY;
  }
  if (duration > MAX_CLIP_DURATION) {
    penalty += QUALITY_TOO_LONG_PENALTY;
  }

  // ── Content Type Filters ──────────────────────────────────────
  // Check for intro/greeting
  if (isGreeting(text)) {
    // If the ENTIRE clip is just greeting
    if (tokens.length < 15) {
      penalty += QUALITY_INTRO_PENALTY;
    } else {
      penalty += QUALITY_INTRO_PENALTY * 0.3; // Partial penalty
    }
  }

  // Check for outro/sign-off
  if (isOutro(text)) {
    const lastTokens = tokens.slice(-10);
    if (lastTokens.length > 0 && lastTokens.some(t => {
      const greetings = ['jumpa', 'makasih', 'terima', 'kasih', 'sekian', 'bye'];
      return greetings.includes(t);
    })) {
      penalty += QUALITY_OUTRO_PENALTY;
    }
  }

  // Check for sponsor content
  if (hasSponsorContent(text)) {
    penalty += QUALITY_SPONSOR_PENALTY;
  }

  // Check for CTA-heavy content
  if (hasCTA(text)) {
    penalty += QUALITY_CTA_PENALTY * 0.7;
  }

  // ── Context Dependency ────────────────────────────────────────
  if (hasContextDependency(text)) {
    // Check how bad it is
    const firstSentence = clip.text.split(/[.!?]/)[0];
    if (hasContextDependency(firstSentence)) {
      penalty += QUALITY_CONTEXT_DEPENDENT_PENALTY; // Heavy — starts with reference
    } else {
      penalty += QUALITY_CONTEXT_DEPENDENT_PENALTY * 0.3; // Minor
    }
  }

  // ── Audio-Based Filters ───────────────────────────────────────
  if (audioFeatures) {
    // Check for dead air (excessive silence)
    const silenceInClip = audioFeatures.silenceSegments.filter(
      s => s.startTime >= clip.startTime && s.endTime <= clip.endTime,
    );
    const totalSilence = silenceInClip.reduce((sum, s) => sum + s.duration, 0);
    const silenceRatio = duration > 0 ? totalSilence / duration : 0;

    if (silenceRatio > 0.4) {
      penalty += QUALITY_DEAD_AIR_PENALTY; // Mostly silence = dead clip
    } else if (silenceRatio > 0.25) {
      penalty += QUALITY_DEAD_AIR_PENALTY * 0.5; // Significant silence
    }
  }

  // ── Content Completeness ──────────────────────────────────────
  // If clip has no narrative resolution, it feels incomplete
  const hasResolution = clip.blocks.some(
    b => b.narrativeStage === 'resolution' || b.narrativeStage === 'punchline',
  );
  if (!hasResolution && clip.blocks.length > 0) {
    penalty += QUALITY_INCOMPLETE_PENALTY * 0.3;
  }

  // Cap penalty
  return Math.max(-100, penalty);
}