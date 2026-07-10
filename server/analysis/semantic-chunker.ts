/**
 * Semantic Chunker — TextTiling Algorithm
 *
 * Segments transcript into Idea Blocks based on topic shifts.
 * Uses cosine similarity between adjacent windows of sentences
 * to detect natural topic boundaries — NOT fixed duration chunks.
 *
 * Algorithm:
 * 1. Parse timestamped transcript into segments
 * 2. Compute similarity scores at every gap between sentences
 * 3. Low similarity = topic boundary → split there
 * 4. Merge small blocks below minimum duration
 * 5. Return IdeaBlock[]
 */

import type { TranscriptSegment, IdeaBlock } from './types.js';
import { NarrativeStage } from './types.js';
import {
  TEXT_TILING_WINDOW_SIZE,
  TEXT_TILING_SIMILARITY_THRESHOLD,
  MIN_BLOCK_DURATION,
  MAX_BLOCK_DURATION,
} from './constants.js';
import {
  splitSentences,
  tokenize,
  termFrequency,
  cosineSimilarity,
} from './text-utils.js';

/**
 * Parse a timestamped transcript from Whisper into structured segments
 * Format: [TIMESTAMP: 0.0 -> 5.2]\nText here\n
 */
export function parseTranscript(transcript: string): TranscriptSegment[] {
  const lines = transcript.split('\n');
  const segments: TranscriptSegment[] = [];
  let currentStart = 0;
  let currentEnd = 0;
  let currentText: string[] = [];
  let index = 0;

  const timestampRegex = /\[TIMESTAMP:\s*([\d.]+)\s*->\s*([\d.]+)\]/;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(timestampRegex);

    if (match) {
      // Save previous segment
      if (currentText.length > 0) {
        segments.push({
          index: index++,
          startTime: currentStart,
          endTime: currentEnd,
          text: currentText.join(' ').trim(),
        });
      }

      currentStart = parseFloat(match[1]);
      currentEnd = parseFloat(match[2]);
      currentText = [];
    } else if (trimmed) {
      currentText.push(trimmed);
    }
  }

  // Save last segment
  if (currentText.length > 0) {
    segments.push({
      index: index,
      startTime: currentStart,
      endTime: currentEnd,
      text: currentText.join(' ').trim(),
    });
  }

  return segments;
}

/**
 * Flatten segments into sentences with timestamps
 */
function segmentsToSentences(
  segments: TranscriptSegment[],
): { text: string; startTime: number; endTime: number }[] {
  const sentences: { text: string; startTime: number; endTime: number }[] = [];

  for (const seg of segments) {
    const segSentences = splitSentences(seg.text);
    const duration = seg.endTime - seg.startTime;
    const perSentence = duration / Math.max(segSentences.length, 1);

    for (let i = 0; i < segSentences.length; i++) {
      const s = segSentences[i];
      if (s.length < 2) continue; // skip empty/minimal sentences
      sentences.push({
        text: s,
        startTime: seg.startTime + i * perSentence,
        endTime: seg.startTime + (i + 1) * perSentence,
      });
    }
  }

  return sentences;
}

/**
 * TextTiling: compute similarity at each gap between sentences
 * Returns an array of similarity scores, one for each gap
 */
function computeGapSimilarities(
  sentences: { text: string; startTime: number; endTime: number }[],
): number[] {
  const gapScores: number[] = [];
  const W = TEXT_TILING_WINDOW_SIZE;

  for (let i = 0; i < sentences.length - 1; i++) {
    // Block before gap: W sentences ending just before gap
    const blockStart = Math.max(0, i - W + 1);
    const beforeBlock = sentences.slice(blockStart, i + 1);
    const beforeTokens = beforeBlock.flatMap(s => tokenize(s.text));

    // Block after gap: W sentences starting just after gap
    const afterBlock = sentences.slice(i + 1, i + 1 + W);
    const afterTokens = afterBlock.flatMap(s => tokenize(s.text));

    if (beforeTokens.length === 0 || afterTokens.length === 0) {
      gapScores.push(0.5); // neutral score if no data
      continue;
    }

    const tfBefore = termFrequency(beforeTokens);
    const tfAfter = termFrequency(afterTokens);
    const similarity = cosineSimilarity(tfBefore, tfAfter);
    gapScores.push(similarity);
  }

  return gapScores;
}

/**
 * Find topic boundaries from gap similarity scores
 * A boundary exists where similarity drops below threshold
 */
function findBoundaries(
  gapScores: number[],
  sentences: { text: string; startTime: number; endTime: number }[],
): number[] {
  const boundaries: number[] = []; // indices of gap positions to split at

  // Smooth scores with moving average
  const smoothed: number[] = [];
  for (let i = 0; i < gapScores.length; i++) {
    const start = Math.max(0, i - 1);
    const end = Math.min(gapScores.length, i + 2);
    const slice = gapScores.slice(start, end);
    smoothed.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }

  // Find valleys below threshold
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] < TEXT_TILING_SIMILARITY_THRESHOLD) {
      // Check if this is a local minimum
      const isValley =
        (i === 0 || smoothed[i] <= smoothed[i - 1]) &&
        (i === smoothed.length - 1 || smoothed[i] <= smoothed[i + 1]);

      if (isValley) {
        boundaries.push(i);
      }
    }
  }

  return boundaries;
}

/**
 * Merge small blocks that are below minimum duration
 */
function mergeSmallBlocks(blocks: IdeaBlock[]): IdeaBlock[] {
  if (blocks.length <= 1) return blocks;

  const merged: IdeaBlock[] = [];
  let current = blocks[0];

  for (let i = 1; i < blocks.length; i++) {
    const duration = current.endTime - current.startTime;
    const nextBlock = blocks[i];

    if (duration < MIN_BLOCK_DURATION) {
      // Merge with next
      current = {
        ...current,
        endTime: nextBlock.endTime,
        text: current.text + '\n' + nextBlock.text,
        summary: current.summary + ' ' + nextBlock.summary,
        topicScore: { ...current.topicScore, ...nextBlock.topicScore },
      };
    } else {
      merged.push(current);
      current = nextBlock;
    }
  }
  merged.push(current);

  return merged;
}

/**
 * Summarize a block by extracting the most representative sentence
 */
function summarizeBlock(text: string): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return '';

  // Pick the sentence with the highest information density
  let bestSentence = sentences[0];
  let bestScore = -1;

  for (const s of sentences) {
    const tokens = tokenize(s);
    if (tokens.length === 0) continue;
    const unique = new Set(tokens);
    const score = unique.size / tokens.length + tokens.length * 0.1;
    if (score > bestScore) {
      bestScore = score;
      bestSentence = s;
    }
  }

  return bestSentence;
}

/**
 * Main chunker: parse transcript → detect topic boundaries → build IdeaBlocks
 */
export function chunkIntoBlocks(transcript: string): IdeaBlock[] {
  const segments = parseTranscript(transcript);
  if (segments.length === 0) return [];

  const sentences = segmentsToSentences(segments);
  if (sentences.length === 0) return [];

  const gapScores = computeGapSimilarities(sentences);
  const boundaries = findBoundaries(gapScores, sentences);

  // Build blocks from boundaries
  const blocks: IdeaBlock[] = [];
  let blockStart = 0;

  for (const boundary of boundaries) {
    const blockSentences = sentences.slice(blockStart, boundary + 1);
    if (blockSentences.length === 0) continue;

    const text = blockSentences.map(s => s.text).join(' ');
    const tokens = tokenize(text);
    const tf = termFrequency(tokens);

    blocks.push({
      id: blocks.length,
      startTime: blockSentences[0].startTime,
      endTime: blockSentences[blockSentences.length - 1].endTime,
      text,
      summary: summarizeBlock(text),
      narrativeStage: NarrativeStage.UNKNOWN,
      topicScore: Object.fromEntries(
        Object.entries(tf)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10), // Keep top 10 topic words
      ),
    });

    blockStart = boundary + 1;
  }

  // Add remaining sentences as final block
  if (blockStart < sentences.length) {
    const blockSentences = sentences.slice(blockStart);
    const text = blockSentences.map(s => s.text).join(' ');
    const tokens = tokenize(text);
    const tf = termFrequency(tokens);

    blocks.push({
      id: blocks.length,
      startTime: blockSentences[0].startTime,
      endTime: blockSentences[blockSentences.length - 1].endTime,
      text,
      summary: summarizeBlock(text),
      narrativeStage: NarrativeStage.UNKNOWN,
      topicScore: Object.fromEntries(
        Object.entries(tf)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10),
      ),
    });
  }

  // Merge small blocks
  const merged = mergeSmallBlocks(blocks);

  // Split oversized blocks if they exceed max duration
  return splitOversizedBlocks(merged);
}

/**
 * Split blocks that exceed MAX_BLOCK_DURATION
 */
function splitOversizedBlocks(blocks: IdeaBlock[]): IdeaBlock[] {
  const result: IdeaBlock[] = [];

  for (const block of blocks) {
    const duration = block.endTime - block.startTime;
    if (duration <= MAX_BLOCK_DURATION) {
      result.push(block);
      continue;
    }

    // Split in half recursively
    const mid = (block.startTime + block.endTime) / 2;
    const sentences = splitSentences(block.text);
    const halfIdx = Math.floor(sentences.length / 2);

    const text1 = sentences.slice(0, halfIdx).join(' ');
    const text2 = sentences.slice(halfIdx).join(' ');

    const tf1 = termFrequency(tokenize(text1));
    const tf2 = termFrequency(tokenize(text2));

    result.push({
      id: block.id,
      startTime: block.startTime,
      endTime: mid,
      text: text1,
      summary: summarizeBlock(text1),
      narrativeStage: NarrativeStage.UNKNOWN,
      topicScore: Object.fromEntries(Object.entries(tf1).slice(0, 10)),
    });

    result.push({
      id: block.id + 0.5,
      startTime: mid,
      endTime: block.endTime,
      text: text2,
      summary: summarizeBlock(text2),
      narrativeStage: NarrativeStage.UNKNOWN,
      topicScore: Object.fromEntries(Object.entries(tf2).slice(0, 10)),
    });
  }

  return result;
}