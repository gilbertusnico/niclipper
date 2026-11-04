/**
 * Types for the Niclipper moment-detection engine (100% offline).
 */

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

/** A selected moment — same shape the pipeline/UI already use. */
export interface ViralMoment {
  startTime: number;
  endTime: number;
  reason: string;
  /** YouTube-ready title (extractive, from the clip's own words). */
  title?: string;
  /** YouTube-ready description (summary lines, source link, hashtags). */
  description?: string;
  /** Sub-scores (0-100 each) shown in the UI. */
  retentionScore?: {
    hook3s: number;
    maintain10s: number;
    payoffFull: number;
    overall: number;
  };
  /** Final score on a 0–10 scale. */
  finalScore?: number;
  /** Content tags shown as chips (e.g. "cerita", "opini", "angka/fakta"). */
  narrativeStages?: string[];
  contentType?: string;
  confidence?: number;
}

/** Progress callback */
export type AnalysisProgressCallback = (progress: number) => void;
