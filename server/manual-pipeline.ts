/**
 * Manual Pipeline — Crop video at user-specified time ranges
 *
 * Skips AI analysis entirely:
 * 1. Download video from YouTube
 * 2. Auto-transcribe for subtitles (silent fallback if fails)
 * 3. Crop each specified time range to 9:16 vertical (with or without subtitles)
 * 4. Render final clips
 */

import { downloadVideo } from './downloader.js';
import { transcribeAudio } from './transcriber.js';
import { cropClips } from './cropper.js';
import { renderFinalClips } from './renderer.js';
import type { ClipResult, ViralMoment, ProgressCallback } from './types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TimeRange {
  start: number; // in seconds
  end: number;   // in seconds
}

/**
 * Run the manual cropping pipeline.
 * Optionally accepts a pre-generated transcript.
 * If none is provided, attempts auto-transcription for subtitles.
 */
export async function runManualPipeline(
  url: string,
  ranges: TimeRange[],
  emitProgress: ProgressCallback,
  transcript?: string, // optional — if omitted, pipeline auto-transcribes
): Promise<ClipResult[]> {
  // ── Stage 1: Download ──────────────────────────────────────────────
  emitProgress('downloading', 0);
  console.log('[ManualPipeline] Stage 1: Downloading video...');

  let videoPath: string;
  try {
    videoPath = await downloadVideo(url, (progress) => {
      emitProgress('downloading', progress);
    });
    emitProgress('downloading', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Download failed';
    throw new Error(`Download failed: ${msg}`);
  }

  // ── Stage 2: Transcribe (optional — for subtitles) ────────────────
  let resolvedTranscript: string | undefined = transcript;

  if (!resolvedTranscript) {
    emitProgress('transcribing', 0);
    console.log('[ManualPipeline] Stage 2: Auto-transcribing for subtitles...');
    try {
      resolvedTranscript = await transcribeAudio(videoPath, (progress) => {
        emitProgress('transcribing', progress);
      });
      emitProgress('transcribing', 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      console.warn(`[ManualPipeline] Transcription failed, proceeding without subtitles: ${msg}`);
      emitProgress('transcribing', 100); // move past it
    }
  }

  // Build ViralMoment[] from user-specified ranges
  const moments: ViralMoment[] = ranges.map((r, i) => ({
    startTime: r.start,
    endTime: r.end,
    reason: `Manual clip ${i + 1} (${formatTime(r.start)} — ${formatTime(r.end)})`,
  }));

  // ── Stage 3: Crop ──────────────────────────────────────────────────
  emitProgress('cropping', 0);
  console.log('[ManualPipeline] Stage 3: Cropping clips...');

  const totalMoments = moments.length;
  const croppedFiles: string[] = [];

  try {
    for (let i = 0; i < moments.length; i++) {
      const moment = moments[i];
      const clipProgress = Math.round((i / totalMoments) * 100);
      emitProgress('cropping', clipProgress, { clip: i + 1 });

      const cropped = await cropClips(videoPath, moment, i + 1, (subProgress) => {
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

  // ── Stage 4: Render ────────────────────────────────────────────────
  emitProgress('rendering', 0);
  console.log('[ManualPipeline] Stage 4: Rendering final clips...');

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

  // Cleanup temp files
  cleanup();

  return clips;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function cleanup(): void {
  const tempDir = path.resolve(__dirname, '..', 'temp');
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
    }
  } catch {
    // Non-blocking cleanup
  }
}