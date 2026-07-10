/**
 * Narrative Analyzer — State Machine
 *
 * Maps each IdeaBlock to a NarrativeStage using signal words,
 * linguistic patterns, and context transitions.
 *
 * Uses a state machine approach:
 * - Each block is analyzed independently for signal words
 * - Then a smooth transition system refines the sequence
 * - Ensures narrative flow makes sense (e.g., OUTRO can't appear mid-video)
 */

import type { IdeaBlock } from './types.js';
import { NarrativeStage } from './types.js';
import { SIGNAL_WORDS } from './constants.js';
import {
  startsWithQuestion,
  startsWithExclamation,
  hasNarrativePattern,
  isGreeting,
  isOutro,
  hasCTA,
  tokenizeFull,
} from './text-utils.js';

/**
 * Score a block against each narrative stage using signal words
 */
function scoreNarrativeStage(text: string): Record<NarrativeStage, number> {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};
  const tokens = tokenizeFull(text);
  const wordCount = tokens.length;

  // Initialize all stages
  for (const stage of Object.values(NarrativeStage)) {
    scores[stage] = 0;
  }

  // Score each signal word category
  for (const [stageSlug, words] of Object.entries(SIGNAL_WORDS)) {
    // Map the slug (from constants) to NarrativeStage enum
    const stageKey = stageSlug as keyof typeof SIGNAL_WORDS;
    const stage = mapSlugToStage(stageKey);
    if (!stage) continue;

    let score = 0;
    for (const word of words) {
      // Check if word appears in text
      const count = (lower.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
      score += count * 5;

      // Bonus if word appears at start of text
      if (lower.startsWith(word) || lower.startsWith(word + ' ')) {
        score += 10;
      }
    }

    scores[stage] = score;
  }

  // Additional pattern-based scoring
  if (startsWithQuestion(text)) {
    scores[NarrativeStage.CURIOSITY] += 20;
  }

  if (startsWithExclamation(text)) {
    scores[NarrativeStage.TWIST] += 10;
    scores[NarrativeStage.PUNCHLINE] += 10;
  }

  if (hasNarrativePattern(text)) {
    scores[NarrativeStage.SETUP] = (scores[NarrativeStage.SETUP] || 0) + 15;
  }

  if (isGreeting(text)) {
    scores[NarrativeStage.INTRO] += 25;
  }

  if (isOutro(text)) {
    scores[NarrativeStage.OUTRO] += 25;
  }

  if (hasCTA(text)) {
    scores[NarrativeStage.CTA] += 30;
  }

  // If text is very short and has mixed signals, default to UNKNOWN
  if (wordCount < 5) {
    for (const stage of Object.values(NarrativeStage)) {
      scores[stage] *= 0.5;
    }
  }

  return scores as Record<NarrativeStage, number>;
}

/**
 * Map signal word slug to NarrativeStage enum
 */
function mapSlugToStage(slug: keyof typeof SIGNAL_WORDS): NarrativeStage | null {
  const map: Record<string, NarrativeStage> = {
    intro: NarrativeStage.INTRO,
    setup: NarrativeStage.SETUP,
    conflict: NarrativeStage.CONFLICT,
    curiosity: NarrativeStage.CURIOSITY,
    twist: NarrativeStage.TWIST,
    demonstration: NarrativeStage.DEMONSTRATION,
    resolution: NarrativeStage.RESOLUTION,
    punchline: NarrativeStage.PUNCHLINE,
    cta: NarrativeStage.CTA,
    outro: NarrativeStage.OUTRO,
  };
  return map[slug] || null;
}

/**
 * Get the best narrative stage from a scores object
 */
function getBestStage(scores: Record<NarrativeStage, number>): NarrativeStage {
  let best = NarrativeStage.UNKNOWN;
  let bestScore = 0;

  for (const [stage, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = stage as NarrativeStage;
    }
  }

  return best;
}

/**
 * Smooth narrative transitions — ensure logical flow
 * e.g., if we have INTRO → CTA → SETUP, that's weird.
 * This pass fixes impossible transitions.
 */
function smoothNarrativeFlow(blocks: IdeaBlock[]): IdeaBlock[] {
  if (blocks.length <= 1) return blocks;

  const result = [...blocks];

  // Define expected narrative order (transition probabilities)
  const narrativeOrder: NarrativeStage[] = [
    NarrativeStage.INTRO,
    NarrativeStage.SETUP,
    NarrativeStage.CONFLICT,
    NarrativeStage.CURIOSITY,
    NarrativeStage.DEMONSTRATION,
    NarrativeStage.EXPLANATION,
    NarrativeStage.TWIST,
    NarrativeStage.PUNCHLINE,
    NarrativeStage.RESOLUTION,
    NarrativeStage.CTA,
    NarrativeStage.OUTRO,
  ];

  // Get the position of a stage in the expected order
  const stagePosition = (stage: NarrativeStage): number => {
    const idx = narrativeOrder.indexOf(stage);
    return idx >= 0 ? idx : -1;
  };

  // Smooth: if a block's stage is far from where we'd expect,
  // pull it toward its neighbors
  for (let i = 1; i < result.length - 1; i++) {
    const prevStage = result[i - 1].narrativeStage;
    const currStage = result[i].narrativeStage;
    const nextStage = result[i + 1].narrativeStage;

    const prevPos = stagePosition(prevStage);
    const currPos = stagePosition(currStage);
    const nextPos = stagePosition(nextStage);

    // If current stage is between prev and next, it's fine
    if (prevPos <= currPos && currPos <= nextPos) continue;
    // If current is same as both neighbors, it's fine
    if (currStage === prevStage && currStage === nextStage) continue;
    // If unknown, it's fine (we'll upgrade later)
    if (currStage === NarrativeStage.UNKNOWN) continue;

    // Otherwise, pull current toward the majority of its neighbors
    const neighborAvg = (prevPos + nextPos) / 2;
    const distance = Math.abs(currPos - neighborAvg);

    if (distance > 3) {
      // Too far — reassign to the closer neighbor
      const distToPrev = Math.abs(currPos - prevPos);
      const distToNext = Math.abs(currPos - nextPos);

      if (distToPrev <= distToNext && prevStage !== NarrativeStage.UNKNOWN) {
        result[i] = { ...result[i], narrativeStage: prevStage };
      } else if (nextStage !== NarrativeStage.UNKNOWN) {
        result[i] = { ...result[i], narrativeStage: nextStage };
      }
    }
  }

  return result;
}

/**
 * Analyze narrative stages for all IdeaBlocks
 */
export function analyzeNarrative(blocks: IdeaBlock[]): IdeaBlock[] {
  // First pass: score each block independently
  const scored = blocks.map(block => {
    const scores = scoreNarrativeStage(block.text);
    const stage = getBestStage(scores);
    return { ...block, narrativeStage: stage };
  });

  // Second pass: smooth transitions
  const smoothed = smoothNarrativeFlow(scored);

  // Third pass: fill in UNKNOWN blocks with contextual inference
  const filled = fillUnknownStages(smoothed);

  return filled;
}

/**
 * Fill UNKNOWN stages by looking at context and topic
 */
function fillUnknownStages(blocks: IdeaBlock[]): IdeaBlock[] {
  const result = [...blocks];

  for (let i = 0; i < result.length; i++) {
    if (result[i].narrativeStage !== NarrativeStage.UNKNOWN) continue;

    // Look at neighbors
    const prevStage = i > 0 ? result[i - 1].narrativeStage : null;
    const nextStage = i < result.length - 1 ? result[i + 1].narrativeStage : null;

    // If both neighbors are the same stage, use that
    if (prevStage && prevStage === nextStage && prevStage !== NarrativeStage.UNKNOWN) {
      result[i] = { ...result[i], narrativeStage: prevStage };
      continue;
    }

    // Check for question marks → CURIOSITY
    if ((result[i].text.match(/\?/g) || []).length >= 1) {
      result[i] = { ...result[i], narrativeStage: NarrativeStage.CURIOSITY };
      continue;
    }

    // Check for exclamation → TWIST or PUNCHLINE
    if ((result[i].text.match(/!/g) || []).length >= 2) {
      result[i] = { ...result[i], narrativeStage: NarrativeStage.TWIST };
      continue;
    }

    // Default: follow the previous stage
    if (prevStage && prevStage !== NarrativeStage.UNKNOWN) {
      result[i] = { ...result[i], narrativeStage: prevStage };
    }
  }

  return result;
}