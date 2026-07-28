/**
 * Content Understanding Engine — Main Orchestrator
 *
 * Coordinates the full pipeline:
 * 1. Semantic Chunker → IdeaBlocks
 * 2. Narrative Analyzer → Map narrative stages
 * 3. Audio Analyzer → Extract audio features
 * 4. Visual Analyzer → Extract visual features (optional)
 * 5. Content Classifier → Identify content type
 * 6. Candidate Generator → Merge blocks into candidates
 * 7. Retention Predictor → Score each candidate
 * 8. Quality Filter → Remove unfit clips
 * 9. Diversity Filter → Deduplicate topics
 * 10. Boundary Optimizer → Snap to natural boundaries
 * 11. Ranking Engine → Select top clips
 *
 * Output: ViralMoment[] (same interface as old system for backward compat)
 */

import type {
  IdeaBlock,
  CandidateClip,
  AudioFeatures,
  VisualFeatures,
  ContentClassification,
  ViralMoment,
  AnalysisProgressCallback,
} from './types.js';

import { chunkIntoBlocks } from './semantic-chunker.js';
import { analyzeNarrative } from './narrative-analyzer.js';
import { analyzeAudio } from './audio-analyzer.js';
import { analyzeVideo } from './visual-analyzer.js';
import { classifyContent, refineWithNarrative } from './content-classifier.js';
import { predictRetention } from './retention-predictor.js';
import { applyQualityFilters } from './quality-filter.js';
import { applyDiversityFilter } from './diversity-filter.js';
import { optimizeBoundaries } from './boundary-optimizer.js';
import { rankAndSelectCandidates } from './ranking-engine.js';

import {
  MIN_CLIP_DURATION,
  MAX_CLIP_DURATION,
  MAX_CANDIDATES,
} from './constants.js';
import { tokenize } from './text-utils.js';

/**
 * Main entry point for the Content Understanding Engine
 *
 * @param transcript - Raw transcript text from Whisper
 * @param videoPath - Path to the downloaded video file
 * @param audioPath - Path to the extracted WAV audio file
 * @param onProgress - Progress callback (0-100)
 * @returns ViralMoment[] — top clip recommendations
 */
export async function analyzeTranscript(
  transcript: string,
  videoPath?: string,
  audioPath?: string,
  onProgress?: AnalysisProgressCallback,
): Promise<ViralMoment[]> {
  const progress = (step: number, total: number) => {
    if (onProgress) {
      onProgress(Math.round((step / total) * 100));
    }
  };

  const TOTAL_STEPS = 8;

  try {
    // ── Step 1/8: Semantic Chunker ──────────────────────────────
    console.log('[Engine] Step 1/8: Building semantic blocks...');
    let blocks = chunkIntoBlocks(transcript);
    console.log(`[Engine] Created ${blocks.length} semantic blocks`);
    progress(1, TOTAL_STEPS);

    if (blocks.length === 0) {
      console.warn('[Engine] No blocks generated from transcript');
      return [];
    }

    // ── Step 2/8: Narrative Analyzer ────────────────────────────
    console.log('[Engine] Step 2/8: Analyzing narrative structure...');
    blocks = analyzeNarrative(blocks);
    progress(2, TOTAL_STEPS);

    // ── Step 3/8: Audio Analysis ────────────────────────────────
    console.log('[Engine] Step 3/8: Analyzing audio features...');
    let audioFeatures: AudioFeatures | null = null;
    if (audioPath) {
      try {
        audioFeatures = analyzeAudio(audioPath);
        console.log(
          `[Engine] Audio: ${audioFeatures.silenceSegments.length} pauses, ` +
          `${audioFeatures.energyBursts.length} energy bursts, ` +
          `speaking rate ${audioFeatures.speakingRate.toFixed(1)} syll/s`,
        );
      } catch (err) {
        console.warn('[Engine] Audio analysis failed (non-critical):', err instanceof Error ? err.message : String(err));
      }
    }
    progress(3, TOTAL_STEPS);

    // ── Step 4/8: Visual Analysis ───────────────────────────────
    console.log('[Engine] Step 4/8: Analyzing visual features...');
    let visualFeatures: VisualFeatures | null = null;
    if (videoPath) {
      try {
        visualFeatures = await analyzeVideo(videoPath);
        console.log(
          `[Engine] Visual: ${visualFeatures.sceneChanges.length} scene changes, ` +
          `motion ${visualFeatures.motionIntensity.toFixed(2)}`,
        );
      } catch (err) {
        console.warn('[Engine] Visual analysis failed (non-critical):', err instanceof Error ? err.message : String(err));
      }
    }
    progress(4, TOTAL_STEPS);

    // ── Step 5/8: Content Classifier ────────────────────────────
    console.log('[Engine] Step 5/8: Classifying content type...');
    let classification = classifyContent(blocks);
    classification = refineWithNarrative(classification, blocks);
    console.log(`[Engine] Content type: ${classification.contentType} (confidence: ${(classification.confidence * 100).toFixed(0)}%)`);
    progress(5, TOTAL_STEPS);

    // ── Step 6/8: Generate Candidates ───────────────────────────
    console.log('[Engine] Step 6/8: Generating candidate clips...');
    let candidates = generateCandidates(blocks, classification);
    console.log(`[Engine] Generated ${candidates.length} candidate clips`);
    progress(6, TOTAL_STEPS);

    if (candidates.length === 0) return [];

    // Sort by block count first (narrative completeness), then duration
    const sorted = candidates
      .sort((a, b) => {
        // Prefer more complete narrative arcs
        const arcDiff = b.blocks.length - a.blocks.length;
        if (Math.abs(arcDiff) >= 2) return arcDiff;
        // Then prefer clips closer to 45 seconds
        const aDur = Math.abs((a.endTime - a.startTime) - 45);
        const bDur = Math.abs((b.endTime - b.startTime) - 45);
        return aDur - bDur;
      })
      .slice(0, MAX_CANDIDATES);

    // Score retention for each candidate
    console.log('[Engine] Predicting retention for each candidate...');
    for (const clip of sorted) {
      clip.retentionScore = predictRetention(clip, audioFeatures);
      console.log(
        `  Candidate ${clip.id}: ${clip.startTime}s-${clip.endTime}s ` +
        `(hook=${clip.retentionScore.hook3s}, maintain=${clip.retentionScore.maintain10s}, ` +
        `payoff=${clip.retentionScore.payoffFull}, overall=${clip.retentionScore.overall})`,
      );
    }

    // ── Step 7/8: Quality + Diversity Filters ──────────────────
    console.log('[Engine] Step 7/8: Applying filters...');
    let filtered = sorted.map(clip => ({
      ...clip,
      qualityPenalty: applyQualityFilters(clip, audioFeatures, classification),
    }));

    // Log quality penalties
    for (const clip of filtered) {
      if (clip.qualityPenalty < 0) {
        console.log(`  Quality penalty ${clip.qualityPenalty} for clip ${clip.id}`);
      }
    }

    // Remove heavily penalized clips (keep if penalty > -80)
    filtered = filtered.filter(c => c.qualityPenalty > -80);

    if (filtered.length === 0) {
      console.warn('[Engine] All clips filtered out by quality filter');
      return [];
    }

    // Apply diversity filter
    filtered = applyDiversityFilter(filtered);
    progress(7, TOTAL_STEPS);

    // ── Step 8/8: Boundary Optimization + Ranking ──────────────
    console.log('[Engine] Step 8/8: Optimizing boundaries and ranking...');

    // Apply boundary optimization
    const optimized = filtered.map(clip => {
      if (!audioFeatures) return clip;
      return optimizeBoundaries(clip, audioFeatures.silenceSegments, blocks);
    });

    // Final ranking
    const results = rankAndSelectCandidates(optimized);

    // Fill in content type and confidence for each result
    for (const r of results) {
      r.contentType = classification.contentType;
      r.confidence = classification.confidence;
    }

    progress(8, TOTAL_STEPS);

    console.log(`[Engine] Selected ${results.length} clips`);
    results.forEach((r, i) => {
      console.log(`  #${i + 1}: ${r.startTime}s - ${r.endTime}s → ${r.reason}`);
    });

    return results;

  } catch (err) {
    console.error('[Engine] Fatal error:', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Generate candidate clips by merging adjacent IdeaBlocks
 *
 * Strategy:
 * - Start with each individual block as a seed
 * - Try to merge adjacent blocks to reach target duration
 * - Prefer merging blocks that form a complete narrative arc
 * - Generate multiple candidates at different offsets
 */
function generateCandidates(
  blocks: IdeaBlock[],
  classification: ContentClassification,
): CandidateClip[] {
  if (blocks.length === 0) return [];

  const candidates: CandidateClip[] = [];
  let candidateId = 0;

  // Strategy 1: Sliding window of blocks
  // Try every possible contiguous group of blocks
  for (let startIdx = 0; startIdx < blocks.length; startIdx++) {
    let currentText = '';
    let currentBlocks: IdeaBlock[] = [];

    for (let endIdx = startIdx; endIdx < blocks.length; endIdx++) {
      const block = blocks[endIdx];
      currentBlocks.push(block);
      currentText += (currentText ? '\n' : '') + block.text;

      const duration = block.endTime - blocks[startIdx].startTime;

      // Check if this group is a valid candidate
      if (duration >= MIN_CLIP_DURATION && duration <= MAX_CLIP_DURATION) {
        const tokens = tokenize(currentText);
        candidates.push({
          id: candidateId++,
          blocks: [...currentBlocks],
          startTime: blocks[startIdx].startTime,
          endTime: block.endTime,
          text: currentText,
          wordCount: tokens.length,
          retentionScore: { hook3s: 0, maintain10s: 0, payoffFull: 0, overall: 0 },
          qualityPenalty: 0,
          diversityPenalty: 0,
          finalScore: 0,
          reason: '',
        });
      } else if (duration > MAX_CLIP_DURATION) {
        break; // No point extending further
      }
    }
  }

  // Strategy 2: For long videos, also try natural breaks at narrative stage transitions
  if (blocks.length >= 4) {
    for (let i = 0; i < blocks.length - 2; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const duration = blocks[j].endTime - blocks[i].startTime;
        if (duration < MIN_CLIP_DURATION || duration > MAX_CLIP_DURATION) continue;

        // Check if this span covers a complete narrative arc
        const arcBlocks = blocks.slice(i, j + 1);
        const stages = new Set(arcBlocks.map(b => b.narrativeStage));

        // A good arc has at least a setup + resolution
        const hasSetup = stages.has('setup');
        const hasResolution = stages.has('resolution');
        const hasConflict = stages.has('conflict');
        const hasTwist = stages.has('twist');

        if (hasSetup && hasResolution || hasConflict && hasResolution || hasTwist) {
          const arcText = arcBlocks.map(b => b.text).join('\n');
          const tokens = tokenize(arcText);

          // Check if we already have this range
          const exists = candidates.some(
            c => Math.abs(c.startTime - blocks[i].startTime) < 1 &&
                 Math.abs(c.endTime - blocks[j].endTime) < 1,
          );

          if (!exists) {
            candidates.push({
              id: candidateId++,
              blocks: arcBlocks,
              startTime: blocks[i].startTime,
              endTime: blocks[j].endTime,
              text: arcText,
              wordCount: tokens.length,
              retentionScore: { hook3s: 0, maintain10s: 0, payoffFull: 0, overall: 0 },
              qualityPenalty: 0,
              diversityPenalty: 0,
              finalScore: 0,
              reason: '',
            });
          }
        }
      }
    }
  }

  // Deduplicate candidates with nearly identical time ranges
  const deduped = deduplicateCandidates(candidates);

  return deduped;
}

/**
 * Remove candidates that are nearly identical in time range
 */
function deduplicateCandidates(candidates: CandidateClip[]): CandidateClip[] {
  const keep: CandidateClip[] = [];

  for (const clip of candidates) {
    const isDuplicate = keep.some(k =>
      Math.abs(k.startTime - clip.startTime) < 2 &&
      Math.abs(k.endTime - clip.endTime) < 2,
    );

    if (!isDuplicate) {
      keep.push(clip);
    }
  }

  return keep;
}