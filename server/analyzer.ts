/**
 * Analyzer — Thin wrapper around the Content Understanding Engine
 *
 * This module re-exports the engine's analyzeTranscript function with
 * the same name so pipeline.ts doesn't need to change its import.
 * 
 * Signature: analyzeTranscript(transcript, videoPath?, audioPath?, onProgress?)
 */

export {
  analyzeTranscript,
} from './analysis/engine.js';

export type { AnalysisProgressCallback } from './analysis/types.js';