/**
 * Local File Pipeline — Crop an uploaded local video at user-specified time ranges
 *
 * Skips download stage entirely since the file is already on disk.
 * 1. Auto-transcribe for subtitles (silent fallback if fails)
 * 2. Crop each specified time range to 9:16 vertical (with or without subtitles)
 * 3. Render final clips + thumbnails
 */

import { transcribeAudio } from './transcriber.js';
import { cropClips } from './cropper.js';
import { renderFinalClips } from './renderer.js';
import type { ClipResult, ViralMoment, ProgressCallback } from './types.js';

export interface TimeRange {
  start: number;
  end: number;
}

/**
 * Run the local file cropping pipeline.
 * Optionally accepts a pre-generated transcript.
 * If none is provided, attempts auto-transcription for subtitles.
 *
 * @param subtitles - 'auto' (default, whisper transcribes), 'none' (skip), 'manual' (use provided transcript)
 */
export async function runLocalFilePipeline(
  filePath: string,
  ranges: TimeRange[],
  emitProgress: ProgressCallback,
  transcript?: string, // optional — if omitted, pipeline auto-transcribes
  subtitles: 'auto' | 'none' | 'manual' = 'auto',
): Promise<ClipResult[]> {
  // ── Stage 1: Transcribe (optional — for subtitles) ────────────────
  let resolvedTranscript: string | undefined = transcript;

  if (subtitles === 'none') {
    // User explicitly chose no subtitles — skip transcription entirely
    resolvedTranscript = undefined;
    console.log('[LocalFilePipeline] Skipping transcription (subtitles=none)');
    emitProgress('transcribing', 100);
  } else if (!resolvedTranscript) {
    // No transcript provided, auto-transcribe (for 'auto' or 'manual' modes)
    emitProgress('transcribing', 0);
    console.log('[LocalFilePipeline] Auto-transcribing for subtitles...');
    try {
      resolvedTranscript = await transcribeAudio(filePath, (progress) => {
        emitProgress('transcribing', progress);
      });
      emitProgress('transcribing', 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      console.warn(`[LocalFilePipeline] Transcription failed, proceeding without subtitles: ${msg}`);
      emitProgress('transcribing', 100); // move past it
    }
  }

  // ── Stage 2: Crop ──────────────────────────────────────────────────
  emitProgress('cropping', 0);
  console.log('[LocalFilePipeline] Stage 2: Cropping clips from local file...');

  // Build ViralMoment[] from user-specified ranges
  const moments: ViralMoment[] = ranges.map((r, i) => ({
    startTime: r.start,
    endTime: r.end,
    reason: `Local clip ${i + 1} (${formatTime(r.start)} — ${formatTime(r.end)})`,
  }));

  const totalMoments = moments.length;
  const croppedFiles: string[] = [];

  try {
    for (let i = 0; i < moments.length; i++) {
      const moment = moments[i];
      const clipProgress = Math.round((i / totalMoments) * 100);
      emitProgress('cropping', clipProgress, { clip: i + 1 });

      const cropped = await cropClips(filePath, moment, i + 1, (subProgress) => {
        const overall = Math.round(((i + subProgress / 100) / totalMoments) * 100);
        emitProgress('cropping', overall, { clip: i + 1 });
      }, resolvedTranscript);
      croppedFiles.push(cropped);
    }
    emitProgress('cropping', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Cropping failed';
    throw new Error(`Cropping failed: ${msg}`);
  }

  // ── Stage 3: Render ────────────────────────────────────────────────
  emitProgress('rendering', 0);
  console.log('[LocalFilePipeline] Stage 3: Rendering final clips...');

  let clips: ClipResult[];
  try {
    clips = await renderFinalClips(croppedFiles, moments, (progress) => {
      emitProgress('rendering', progress);
    }, resolvedTranscript, true);
    emitProgress('rendering', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Rendering failed';
    throw new Error(`Rendering failed: ${msg}`);
  }

  return clips;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}