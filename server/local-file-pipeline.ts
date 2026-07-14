/**
 * Local File Pipeline — Crop an uploaded local video at user-specified time ranges
 *
 * Skips download stage entirely since the file is already on disk.
 * 1. Crop each specified time range to 9:16 vertical
 * 2. Render final clips + thumbnails
 */

import { cropClips } from './cropper.js';
import { renderFinalClips } from './renderer.js';
import type { ClipResult, ViralMoment, ProgressCallback } from './types.js';

export interface TimeRange {
  start: number;
  end: number;
}

export async function runLocalFilePipeline(
  filePath: string,
  ranges: TimeRange[],
  emitProgress: ProgressCallback,
): Promise<ClipResult[]> {
  // ── Stage 1: Crop ──────────────────────────────────────────────────
  emitProgress('cropping', 0);
  console.log('[LocalFilePipeline] Stage 1: Cropping clips from local file...');

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
      });
      croppedFiles.push(cropped);
    }
    emitProgress('cropping', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Cropping failed';
    throw new Error(`Cropping failed: ${msg}`);
  }

  // ── Stage 2: Render ────────────────────────────────────────────────
  emitProgress('rendering', 0);
  console.log('[LocalFilePipeline] Stage 2: Rendering final clips...');

  let clips: ClipResult[];
  try {
    clips = await renderFinalClips(croppedFiles, moments, (progress) => {
      emitProgress('rendering', progress);
    });
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