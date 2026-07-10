/**
 * Boundary Optimizer — Natural Boundary Detection
 *
 * Snaps clip start/end times to natural conversation boundaries:
 * - Start of a sentence
 * - End of a sentence (period, question mark, exclamation)
 * - After a pause/silence
 * - At scene changes
 * - After a punchline/resolution
 *
 * Never starts in the middle of a sentence, story, joke, or explanation.
 * Never ends before the payoff/resolution is complete.
 */

import type { CandidateClip, IdeaBlock, PauseSegment } from './types.js';
import { NarrativeStage } from './types.js';
import {
  BOUNDARY_MAX_SNAP,
  PUNCHLINE_BUFFER,
  MIN_PAUSE_BOUNDARY,
  IDEAL_CLIP_DURATION_MIN,
  IDEAL_CLIP_DURATION_MAX,
} from './constants.js';
import { splitSentences } from './text-utils.js';

/**
 * Optimize clip boundaries to natural conversation points
 */
export function optimizeBoundaries(
  clip: CandidateClip,
  silenceSegments: PauseSegment[],
  allBlocks: IdeaBlock[],
): CandidateClip {
  let optimizedStart = clip.startTime;
  let optimizedEnd = clip.endTime;

  // ── Snap Start to Next Natural Boundary ──────────────────────
  optimizedStart = snapStartToNaturalBoundary(
    allBlocks,
    clip.startTime,
    silenceSegments,
  );

  // ── Snap End to Previous Natural Boundary ────────────────────
  optimizedEnd = snapEndToNaturalBoundary(
    allBlocks,
    clip.endTime,
    silenceSegments,
  );

  // ── Ensure Minimum and Maximum Duration ─────────────────────
  const duration = optimizedEnd - optimizedStart;

  if (duration < IDEAL_CLIP_DURATION_MIN) {
    // Try to extend to reach minimum
    optimizedEnd = extendToMinimumDuration(
      optimizedStart,
      optimizedEnd,
      allBlocks,
      silenceSegments,
    );
  }

  if (duration > IDEAL_CLIP_DURATION_MAX + 30) {
    // Try to trim to maximum
    optimizedEnd = trimToMaximumDuration(
      optimizedStart,
      optimizedEnd,
      allBlocks,
      silenceSegments,
    );
  }

  return {
    ...clip,
    startTime: Math.max(0, optimizedStart),
    endTime: optimizedEnd,
  };
}

/**
 * Snap start time forward to the nearest natural boundary
 */
function snapStartToNaturalBoundary(
  blocks: IdeaBlock[],
  targetStart: number,
  silenceSegments: PauseSegment[],
): number {
  const block = blocks.find(b => b.startTime <= targetStart && b.endTime >= targetStart);
  if (!block) return targetStart;

  // Find the sentence that contains target time
  const sentences = splitSentences(block.text);
  if (sentences.length === 0) return targetStart;

  const blockDuration = block.endTime - block.startTime;
  const timeInBlock = targetStart - block.startTime;
  const ratioInBlock = blockDuration > 0 ? timeInBlock / blockDuration : 0;
  const sentenceIndex = Math.min(
    Math.floor(ratioInBlock * sentences.length),
    sentences.length - 1,
  );

  // Snap to start of current sentence
  if (sentenceIndex > 0) {
    // Estimate sentence position
    const sentenceDuration = blockDuration / sentences.length;
    const sentenceStart = block.startTime + sentenceIndex * sentenceDuration;

    // Don't snap too far
    if (Math.abs(sentenceStart - targetStart) <= BOUNDARY_MAX_SNAP) {
      return sentenceStart;
    }
  }

  // Alternatively, snap to the nearest pause
  return snapToNearestPause(targetStart, silenceSegments, BOUNDARY_MAX_SNAP);
}

/**
 * Snap end time backward to the nearest natural boundary
 */
function snapEndToNaturalBoundary(
  blocks: IdeaBlock[],
  targetEnd: number,
  silenceSegments: PauseSegment[],
): number {
  // 1. Check if we end at a narrative resolution/punchline block
  const endBlock = blocks.find(b => b.startTime <= targetEnd && b.endTime >= targetEnd);
  if (endBlock) {
    // If this block is a punchline or resolution, include the payoff buffer
    if (
      endBlock.narrativeStage === NarrativeStage.PUNCHLINE ||
      endBlock.narrativeStage === NarrativeStage.RESOLUTION ||
      endBlock.narrativeStage === NarrativeStage.TWIST
    ) {
      // Make sure the end time includes the punchline
      if (endBlock.endTime > targetEnd && (endBlock.endTime - targetEnd) <= BOUNDARY_MAX_SNAP * 2) {
        return endBlock.endTime + PUNCHLINE_BUFFER;
      }
    }
  }

  // 2. Snap to end of current sentence
  if (endBlock) {
    const sentences = splitSentences(endBlock.text);
    if (sentences.length > 0) {
      const blockDuration = endBlock.endTime - endBlock.startTime;
      const timeInBlock = targetEnd - endBlock.startTime;
      const ratioInBlock = blockDuration > 0 ? timeInBlock / blockDuration : 0;
      const sentenceIndex = Math.floor(ratioInBlock * sentences.length);

      if (sentenceIndex >= 0 && sentenceIndex < sentences.length) {
        const sentenceDuration = blockDuration / sentences.length;
        const endOfSentence = endBlock.startTime + (sentenceIndex + 1) * sentenceDuration;

        if (Math.abs(endOfSentence - targetEnd) <= BOUNDARY_MAX_SNAP) {
          return endOfSentence;
        }
      }
    }
  }

  // 3. Snap to nearest pause
  return snapToNearestPause(targetEnd, silenceSegments, BOUNDARY_MAX_SNAP, false);
}

/**
 * Snap a time to the nearest significant pause
 */
function snapToNearestPause(
  time: number,
  silenceSegments: PauseSegment[],
  maxDistance: number,
  snapForward = true,
): number {
  let bestTime = time;
  let bestDist = maxDistance;

  for (const pause of silenceSegments) {
    if (pause.duration < MIN_PAUSE_BOUNDARY) continue;

    const endDist = Math.abs(pause.endTime - time);
    if (endDist <= bestDist) {
      bestDist = endDist;
      bestTime = snapForward
        ? Math.max(time, pause.endTime)
        : Math.min(time, pause.endTime);
    }

    const startDist = Math.abs(pause.startTime - time);
    if (startDist <= bestDist) {
      bestDist = startDist;
      bestTime = time;
    }
  }

  return bestTime;
}

/**
 * Extend end time to meet minimum duration
 */
function extendToMinimumDuration(
  start: number,
  end: number,
  blocks: IdeaBlock[],
  silenceSegments: PauseSegment[],
): number {
  const currentDuration = end - start;
  const neededExtension = IDEAL_CLIP_DURATION_MIN - currentDuration;
  if (neededExtension <= 0) return end;

  // Try to extend to the next boundary
  const nextBlock = blocks.find(b => b.startTime > end);
  if (nextBlock) {
    const maxExtension = Math.min(neededExtension, nextBlock.endTime - end, 15);
    return end + maxExtension;
  }

  return end + Math.min(neededExtension, 10);
}

/**
 * Trim end time to fit within maximum duration
 */
function trimToMaximumDuration(
  start: number,
  end: number,
  blocks: IdeaBlock[],
  silenceSegments: PauseSegment[],
): number {
  const maxEnd = start + IDEAL_CLIP_DURATION_MAX;

  // Snap to the nearest boundary before maxEnd
  return snapToNearestPause(maxEnd, silenceSegments, BOUNDARY_MAX_SNAP, false);
}