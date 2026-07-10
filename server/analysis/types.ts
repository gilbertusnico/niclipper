/**
 * Types for the Niclipper Content Understanding Engine
 * 100% offline algorithmic highlight detection
 */

/** Narrative stages in a video's flow */
export enum NarrativeStage {
  UNKNOWN = 'unknown',
  INTRO = 'intro',
  SETUP = 'setup',
  CONFLICT = 'conflict',
  CURIOSITY = 'curiosity',
  EXPLANATION = 'explanation',
  DEMONSTRATION = 'demonstration',
  TWIST = 'twist',
  RESOLUTION = 'resolution',
  PUNCHLINE = 'punchline',
  CTA = 'call_to_action',
  OUTRO = 'outro',
}

/** Content type of the video */
export enum ContentType {
  UNKNOWN = 'unknown',
  TUTORIAL = 'tutorial',
  PODCAST = 'podcast',
  INTERVIEW = 'interview',
  STORYTELLING = 'storytelling',
  REVIEW = 'review',
  NEWS = 'news',
  MOTIVATION = 'motivation',
  OPINION = 'opinion',
  COMEDY = 'comedy',
  Q_AND_A = 'q_and_a',
}

/** A single parsed segment from the transcript */
export interface TranscriptSegment {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
}

/** A semantic unit built from one or more transcript segments */
export interface IdeaBlock {
  id: number;
  startTime: number;
  endTime: number;
  text: string;
  summary: string;
  narrativeStage: NarrativeStage;
  topicScore: Record<string, number>; // word → frequency
}

/** Detected pause (silence) in audio */
export interface PauseSegment {
  startTime: number;
  endTime: number;
  duration: number;
}

/** Audio analysis features */
export interface AudioFeatures {
  rmsPerSecond: number[];
  energyBursts: { time: number; intensity: number }[];
  silenceSegments: PauseSegment[];
  speakingRate: number; // syllables per second
  avgPitch: number;
  pitchVariation: number;
}

/** Scene change detected in video */
export interface SceneChange {
  time: number;
  confidence: number;
}

/** Visual analysis features */
export interface VisualFeatures {
  sceneChanges: SceneChange[];
  motionIntensity: number; // average 0-1
  hasFaceInFrame: boolean;
}

/** Retention prediction for a candidate clip */
export interface RetentionScore {
  hook3s: number;   // 0-100
  maintain10s: number; // 0-100
  payoffFull: number;  // 0-100
  overall: number;  // 0-100
}

/** A candidate clip before optimization */
export interface CandidateClip {
  id: number;
  blocks: IdeaBlock[];
  startTime: number;
  endTime: number;
  text: string;
  wordCount: number;
  retentionScore: RetentionScore;
  qualityPenalty: number; // 0 = perfect, negative = penalized
  diversityPenalty: number; // 0 = unique, negative = similar to others
  finalScore: number;
  reason: string; // why this clip was chosen
}

/** Final output — same interface as old ViralMoment for backward compat */
export interface ViralMoment {
  startTime: number;
  endTime: number;
  reason: string;
  /** Retention prediction breakdown (0-100 each) */
  retentionScore?: {
    hook3s: number;
    maintain10s: number;
    payoffFull: number;
    overall: number;
  };
  /** Weighted final ranking score */
  finalScore?: number;
  /** Unique narrative stages in this clip (e.g. "setup → conflict → resolution") */
  narrativeStages?: string[];
  /** Detected content type (e.g. "storytelling", "tutorial", "comedy") */
  contentType?: string;
  /** Content classification confidence (0-1) */
  confidence?: number;
}

/** Result from the content classifier */
export interface ContentClassification {
  contentType: ContentType;
  confidence: number;
  narrativeArc: NarrativeStage[];
  hasMultipleTopics: boolean;
}

/** Progress callback */
export type AnalysisProgressCallback = (progress: number) => void;