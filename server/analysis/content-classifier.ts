/**
 * Content Classifier — Pattern Matching Engine
 *
 * Identifies video content type using keyword frequency and
 * structural pattern analysis across all IdeaBlocks.
 *
 * Content types detected:
 * - Tutorial, Podcast, Interview, Storytelling, Review
 * - News, Motivation, Opinion, Comedy, Q&A
 */

import type { IdeaBlock, ContentClassification } from './types.js';
import { ContentType, NarrativeStage } from './types.js';
import { CONTENT_TYPE_SIGNALS } from './constants.js';
import { tokenizeFull } from './text-utils.js';

/**
 * Classify content type from all IdeaBlocks
 */
export function classifyContent(blocks: IdeaBlock[]): ContentClassification {
  if (blocks.length === 0) {
    return {
      contentType: ContentType.UNKNOWN,
      confidence: 0,
      narrativeArc: [],
      hasMultipleTopics: false,
    };
  }

  // Combine all text
  const fullText = blocks.map(b => b.text).join(' ');
  const allTokens = tokenizeFull(fullText);

  // Score each content type
  const scores: Record<string, { keywordScore: number; patternScore: number }> = {};

  for (const [type, signals] of Object.entries(CONTENT_TYPE_SIGNALS)) {
    let keywordScore = 0;
    let patternScore = 0;

    // Keyword scoring
    for (const keyword of signals.keywords) {
      const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = fullText.match(regex);
      if (matches) {
        keywordScore += matches.length * 2;
      }
    }

    // Pattern scoring — check each sentence against patterns
    const sentences = fullText.split(/[.!?]+\s*/);
    for (const sentence of sentences) {
      for (const pattern of signals.pattern) {
        if (pattern.test(sentence)) {
          patternScore += 5;
        }
      }
    }

    scores[type] = { keywordScore, patternScore };
  }

  // Find the best matching type
  let bestType = ContentType.UNKNOWN;
  let bestScore = 0;

  for (const [type, { keywordScore, patternScore }] of Object.entries(scores)) {
    const totalScore = keywordScore + patternScore;
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestType = type as ContentType;
    }
  }

  // Calculate confidence (0-1)
  const totalAllScores = Object.values(scores).reduce(
    (sum, s) => sum + s.keywordScore + s.patternScore, 0,
  );
  const confidence = totalAllScores > 0 ? bestScore / totalAllScores : 0;

  // Extract narrative arc from blocks
  const narrativeArc = blocks
    .map(b => b.narrativeStage)
    .filter((s, i, arr) => s !== NarrativeStage.UNKNOWN && arr.indexOf(s) === i);

  // Detect multiple topics
  const hasMultipleTopics = detectMultipleTopics(blocks);

  return {
    contentType: bestType,
    confidence,
    narrativeArc,
    hasMultipleTopics,
  };
}

/**
 * Detect if the video covers multiple distinct topics
 * by analyzing topic score similarity between blocks
 */
function detectMultipleTopics(blocks: IdeaBlock[]): boolean {
  if (blocks.length <= 1) return false;

  let uniqueTopicCount = 0;
  const seenTopics = new Set<string>();

  for (const block of blocks) {
    // Get top 3 topic words
    const topics = Object.entries(block.topicScore)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([word]) => word);

    const topicKey = topics.sort().join('|');
    if (!seenTopics.has(topicKey) && topics.length > 0) {
      seenTopics.add(topicKey);
      uniqueTopicCount++;
    }
  }

  return uniqueTopicCount >= 3; // 3+ distinct topic clusters
}

/**
 * Refine content classification using narrative structure
 */
export function refineWithNarrative(
  classification: ContentClassification,
  blocks: IdeaBlock[],
): ContentClassification {
  const narrativeStage = new Set(blocks.map(b => b.narrativeStage));

  // Check for structural clues
  const hasQA = narrativeStage.has(NarrativeStage.CURIOSITY);
  const hasTutorial = narrativeStage.has(NarrativeStage.DEMONSTRATION);
  const hasComedy = narrativeStage.has(NarrativeStage.PUNCHLINE);
  const hasStory = narrativeStage.has(NarrativeStage.SETUP);

  // If current type has low confidence, use structural clues
  if (classification.confidence < 0.4) {
    if (hasTutorial && !hasComedy) {
      return { ...classification, contentType: ContentType.TUTORIAL, confidence: 0.5 };
    }
    if (hasQA && !hasTutorial) {
      return { ...classification, contentType: ContentType.Q_AND_A, confidence: 0.5 };
    }
    if (hasStory && hasComedy) {
      return { ...classification, contentType: ContentType.STORYTELLING, confidence: 0.6 };
    }
  }

  return classification;
}