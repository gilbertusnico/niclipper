/**
 * Moment-detection engine — finds the best short clips in a long video
 * without any AI model (fully offline, deterministic).
 *
 * 1. Units      — transcript → short speech units with real timestamps
 *                 (rolling YouTube captions de-duplicated, long chunks split).
 * 2. Audio      — loudness per second + real pauses from the video's audio.
 * 3. Features   — per unit: how specific / story / opinion / insight /
 *                 reaction / question / numbers / energy it is; per edge:
 *                 how clean a cut is there and whether the topic changes.
 * 4. Windows    — EVERY unit-aligned window of 20–60 s across the whole
 *                 video is scored (density, peaks, hook, payoff, single
 *                 topic, length) minus penalties (intro/outro/sponsor/CTA,
 *                 filler, silence).
 * 5. Selection  — best non-overlapping, topically different windows;
 *                 boundaries polished onto real pauses.
 */

import type { AudioFeatures, ViralMoment, AnalysisProgressCallback } from './types.js';
import { buildUnits, splitUnitsAtPauses } from './units.js';
import { analyzeAudio } from './audio-analyzer.js';
import { analyzeUnits } from './features.js';
import { selectMoments } from './selector.js';
import { DEFAULT_MAX_CLIPS } from './constants.js';

/**
 * @param transcript - Timestamped transcript (`[TIMESTAMP: a -> b]\ntext` blocks)
 * @param _videoPath - Unused (kept for call-site compatibility)
 * @param audioPath - 16-bit PCM WAV of the SAME video (optional but recommended)
 * @param onProgress - Progress callback (0-100)
 */
export async function analyzeTranscript(
  transcript: string,
  _videoPath?: string,
  audioPath?: string,
  onProgress?: AnalysisProgressCallback,
  maxResults: number = DEFAULT_MAX_CLIPS,
): Promise<ViralMoment[]> {
  const progress = (p: number) => onProgress?.(p);

  console.log('[Engine] Building speech units...');
  let units = buildUnits(transcript);
  console.log(`[Engine] ${units.length} units, ${units.length ? units[units.length - 1].end.toFixed(0) : 0}s of speech`);
  progress(15);
  if (units.length === 0) return [];

  let audio: AudioFeatures | null = null;
  if (audioPath) {
    try {
      audio = analyzeAudio(audioPath);
      console.log(`[Engine] Audio: ${audio.silenceSegments.length} pauses, ${audio.rmsPerSecond.length}s analysed`);
    } catch (err) {
      console.warn('[Engine] Audio analysis unavailable, using text only:', err instanceof Error ? err.message : String(err));
    }
  }
  progress(45);

  if (audio) {
    // Cut caption cues at the speaker's real pauses → clean sentence-level edges.
    const before = units.length;
    units = splitUnitsAtPauses(units, audio.silenceSegments);
    console.log(`[Engine] Split at pauses: ${before} → ${units.length} units`);
  }

  const analysis = analyzeUnits(units, audio);
  progress(70);

  const moments = selectMoments(analysis, maxResults);
  progress(100);

  console.log(`[Engine] Selected ${moments.length} clips`);
  moments.forEach((m, i) => {
    console.log(`  #${i + 1}: ${m.startTime.toFixed(1)}s – ${m.endTime.toFixed(1)}s (score ${m.finalScore}) → ${m.reason}`);
  });
  return moments;
}
