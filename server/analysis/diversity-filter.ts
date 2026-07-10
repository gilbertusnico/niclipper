/**
 * Diversity Filter — Semantic Deduplication
 *
 * Ensures selected clips cover different topics.
 * Uses Jaccard similarity on n-grams to compare clip content.
 * If two clips have similarity above threshold, the lower-ranked
 * one gets a diversity penalty.
 */

import type { CandidateClip } from './types.js';
import {
  DIVERSITY_NGRAM_SIZE,
  DIVERSITY_THRESHOLD,
} from './constants.js';
import { tokenize, ngrams, jaccardSimilarity } from './text-utils.js';

/**
 * Compute diversity penalty for a set of candidate clips
 * Each clip gets a penalty based on its similarity to higher-ranked clips.
 * Clips that are too similar to better clips get higher penalties.
 */
export function applyDiversityFilter(clips: CandidateClip[]): CandidateClip[] {
  if (clips.length <= 1) return clips;

  // Compute similarity matrix
  const similarities: number[][] = [];

  for (let i = 0; i < clips.length; i++) {
    similarities[i] = [];
    const tokensA = tokenize(clips[i].text);
    const gramsA = ngrams(tokensA, DIVERSITY_NGRAM_SIZE);

    for (let j = 0; j < clips.length; j++) {
      if (i === j) {
        similarities[i][j] = 1; // Same clip
        continue;
      }
      const tokensB = tokenize(clips[j].text);
      const gramsB = ngrams(tokensB, DIVERSITY_NGRAM_SIZE);
      similarities[i][j] = jaccardSimilarity(gramsA, gramsB);
    }
  }

  // Apply diversity penalty
  // For each clip, if it's too similar to any higher-ranked clip, penalize it
  const result = clips.map((clip, i) => {
    let penalty = 0;
    let mostSimilarTopic = '';

    for (let j = 0; j < i; j++) {
      if (similarities[i][j] > DIVERSITY_THRESHOLD) {
        penalty -= (similarities[i][j] - DIVERSITY_THRESHOLD) * 100;

        // Find what topic they share
        const tokensA = tokenize(clips[i].text);
        const tokensB = tokenize(clips[j].text);
        const shared = tokensA.filter(t => tokensB.includes(t));
        mostSimilarTopic = shared.slice(0, 3).join(', ');
      }
    }

    return {
      ...clip,
      diversityPenalty: penalty,
      reason: penalty < 0
        ? `Too similar to another clip (topics: ${mostSimilarTopic})`
        : clip.reason,
    };
  });

  // Also check for clips that are too similar to each other overall
  return removeRedundantClips(result);
}

/**
 * If multiple clips cover the same topic, remove duplicates
 * keeping only the highest-scoring one
 */
function removeRedundantClips(clips: CandidateClip[]): CandidateClip[] {
  if (clips.length <= 1) return clips;

  const keep: CandidateClip[] = [];
  const removed = new Set<number>();

  for (let i = 0; i < clips.length; i++) {
    if (removed.has(i)) continue;

    const tokensA = tokenize(clips[i].text);
    const gramsA = ngrams(tokensA, DIVERSITY_NGRAM_SIZE);

    let isDuplicate = false;

    for (let j = i + 1; j < clips.length; j++) {
      if (removed.has(j)) continue;

      const tokensB = tokenize(clips[j].text);
      const gramsB = ngrams(tokensB, DIVERSITY_NGRAM_SIZE);
      const similarity = jaccardSimilarity(gramsA, gramsB);

      if (similarity > DIVERSITY_THRESHOLD + 0.15) {
        // Very similar — keep the one with higher final score
        if (clips[i].finalScore >= clips[j].finalScore) {
          removed.add(j);
          console.log(`[Diversity] Removed clip ${clips[j].id}: too similar to clip ${clips[i].id}`);
        } else {
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      keep.push(clips[i]);
    } else {
      removed.add(i);
    }
  }

  return keep;
}