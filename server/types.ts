/**
 * Shared types for the Niclipper pipeline
 */

export interface ViralMoment {
  startTime: number;
  endTime: number;
  reason: string;
  title?: string;
  description?: string;
  /** Retention prediction breakdown (0-100 each) */
  retentionScore?: {
    hook3s: number;
    maintain10s: number;
    payoffFull: number;
    overall: number;
  };
  /** Weighted final ranking score */
  finalScore?: number;
  /** Unique narrative stages in this clip */
  narrativeStages?: string[];
  /** Detected content type */
  contentType?: string;
  /** Content classification confidence (0-1) */
  confidence?: number;
}

export interface TranscriptSegment {
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

export interface ClipResult {
  id: number;
  filename: string;
  duration: number;
  startTime: number;
  endTime: number;
  /** User-specified title, or first few words of transcript */
  title?: string;
  /** YouTube-ready description (AI mode) */
  description?: string;
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
  /** Human-readable reason for clip selection */
  reason?: string;
  /** Per-clip transcript segments (timed) from Whisper, for editing */
  transcriptSegments?: TranscriptSegment[];
}

export type ProgressCallback = (
  stage: string,
  progress: number,
  extra?: Record<string, unknown>,
) => void;