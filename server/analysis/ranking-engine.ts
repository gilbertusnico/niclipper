/**
 * Ranking Engine — Weighted Final Ranking
 *
 * Combines all signals (retention, quality, diversity, duration)
 * into a single final score and ranks candidates.
 *
 * Scoring formula:
 *   finalScore = retention * w_ret + quality * w_qual + duration_match * w_dur + diversity * w_div
 *
 * Returns top N clips (default: 3)
 */

import type { CandidateClip, ViralMoment } from './types.js';
import {
  RANKING_RETENTION_WEIGHT,
  RANKING_QUALITY_WEIGHT,
  RANKING_DIVERSITY_WEIGHT,
  RANKING_DURATION_WEIGHT,
  RANKING_IDEAL_DURATION,
  IDEAL_CLIP_DURATION_MIN,
  IDEAL_CLIP_DURATION_MAX,
} from './constants.js';

/**
 * Compute final score for a candidate clip
 */
function computeFinalScore(clip: CandidateClip): number {
  const duration = clip.endTime - clip.startTime;

  // 1. Retention score (0-100)
  const retentionNorm = clip.retentionScore.overall / 100;

  // 2. Quality score: penalty turned into a 0-1 score
  const qualityNorm = Math.max(0, 1 - Math.abs(clip.qualityPenalty) / 100);

  // 3. Duration match: prefer clips near ideal duration
  let durationScore = 0;
  if (duration >= IDEAL_CLIP_DURATION_MIN && duration <= IDEAL_CLIP_DURATION_MAX) {
    durationScore = 1 - Math.abs(duration - RANKING_IDEAL_DURATION) / RANKING_IDEAL_DURATION;
  } else {
    durationScore = 0.3; // Outside ideal range, still usable
  }

  // 4. Diversity score: penalty turned into 0-1
  const diversityNorm = Math.max(0, 1 - Math.abs(clip.diversityPenalty) / 100);

  // Final weighted score
  const finalScore =
    retentionNorm * RANKING_RETENTION_WEIGHT +
    qualityNorm * RANKING_QUALITY_WEIGHT +
    durationScore * RANKING_DURATION_WEIGHT +
    diversityNorm * RANKING_DIVERSITY_WEIGHT;

  return Math.round(finalScore * 100);
}

/**
 * Generate a human-readable reason for why this clip was chosen
 */
function generateReason(clip: CandidateClip): string {
  const parts: string[] = [];
  const retention = clip.retentionScore;

  if (retention.hook3s >= 70) {
    parts.push('strong hook');
  }
  if (retention.maintain10s >= 60) {
    parts.push('engaging pacing');
  }
  if (retention.payoffFull >= 60) {
    parts.push('satisfying payoff');
  }

  const narrativeStages = clip.blocks.map(b => b.narrativeStage).filter(s => s !== 'unknown');
  if (narrativeStages.length >= 2) {
    parts.push(`${narrativeStages.join(' → ')} narrative arc`);
  }

  if (parts.length === 0) {
    parts.push('highest retention potential');
  }

  return `${parts.join(', ')} (retention: ${retention.overall}%)`;
}

/**
 * Rank candidate clips and return top N as ViralMoment[]
 */
export function rankAndSelectCandidates(
  clips: CandidateClip[],
  maxResults: number = 3,
): ViralMoment[] {
  if (clips.length === 0) return [];
  if (clips.length === 1) {
    const clip = clips[0];
    clip.finalScore = computeFinalScore(clip);
    clip.reason = generateReason(clip);
    const stageSet = new Set(clip.blocks.map(b => b.narrativeStage));
    const narrativeStages = Array.from(stageSet).filter(s => s !== 'unknown');
    return [{
      startTime: Math.round(clip.startTime),
      endTime: Math.round(clip.endTime),
      reason: clip.reason,
      retentionScore: clip.retentionScore,
      finalScore: clip.finalScore,
      narrativeStages,
      contentType: '',
      confidence: 0,
    }];
  }

  // Refine all scores
  const scored = clips.map(clip => ({
    ...clip,
    finalScore: computeFinalScore(clip),
    reason: generateReason(clip),
  }));

  // Sort by final score descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Log ranking for debugging
  console.log('[Ranking] Final rankings:');
  scored.forEach((clip, i) => {
    console.log(
      `  #${i + 1}: clip ${clip.id} (${clip.startTime}s-${clip.endTime}s) ` +
      `score=${clip.finalScore} retention=${clip.retentionScore.overall} ` +
      `quality=${100 + clip.qualityPenalty}% diversity=${100 + clip.diversityPenalty}% ` +
      `→ ${clip.reason}`,
    );
  });

  // Return top N with full analysis data
  return scored.slice(0, maxResults).map(clip => {
    // Extract unique narrative stages from blocks
    const stageSet = new Set(clip.blocks.map(b => b.narrativeStage));
    const narrativeStages = Array.from(stageSet).filter(s => s !== 'unknown');

    return {
      startTime: Math.round(clip.startTime),
      endTime: Math.round(clip.endTime),
      reason: clip.reason,
      retentionScore: clip.retentionScore,
      finalScore: clip.finalScore,
      narrativeStages,
      contentType: '',  // Will be filled by caller
      confidence: 0,
    };
  });
}