/**
 * Shared types for the Niclipper pipeline
 */

export interface ViralMoment {
  startTime: number;
  endTime: number;
  reason: string;
}

export interface ClipResult {
  id: number;
  filename: string;
  duration: number;
  startTime: number;
  endTime: number;
}

export type ProgressCallback = (
  stage: string,
  progress: number,
  extra?: Record<string, unknown>,
) => void;