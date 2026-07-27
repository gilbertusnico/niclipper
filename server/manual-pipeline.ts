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
import { getTranscriptForYouTube } from './subtitle-downloader.js';
import { cropClips } from './cropper.js';
import { renderFinalClips } from './renderer.js';
import type { ClipResult, ViralMoment, ProgressCallback } from './types.js';

export interface TimeRange {
  start: number; // in seconds
  end: number;   // in seconds
  title?: string;
}

/**
 * Run the manual cropping pipeline.
 * Optionally accepts a pre-generated transcript.
 * If none is provided, attempts auto-transcription for subtitles.
 *
 * @param subtitles - 'auto' (default, whisper transcribes), 'none' (skip), 'manual' (use provided transcript)
 */
export async function runManualPipeline(
  url: string,
  ranges: TimeRange[],
  emitProgress: ProgressCallback,
  transcript?: string, // optional — if omitted, pipeline auto-transcribes
  subtitles: 'auto' | 'none' | 'manual' = 'auto',
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
  // ⚡ Strategy: Try YouTube subtitles first (1-2 seconds), fall back to Whisper AI
  let resolvedTranscript: string | undefined = transcript;

  if (subtitles === 'none') {
    // User explicitly chose no subtitles — skip transcription entirely
    resolvedTranscript = undefined;
    console.log('[ManualPipeline] Stage 2: Skipping transcription (subtitles=none)');
    emitProgress('transcribing', 100);
  } else if (!resolvedTranscript) {
    // No transcript provided, auto-transcribe (for 'auto' or 'manual' modes)
    // 🚀 OPTIMIZATION 1: Try YouTube subtitles first (1-2 seconds)
    // 🚀 OPTIMIZATION 2: If fallback to Whisper, only transcribe the segment the user selected
    const transcribeStart = ranges.length > 0 ? Math.min(...ranges.map(r => r.start)) : undefined;
    const transcribeEnd = ranges.length > 0 ? Math.max(...ranges.map(r => r.end)) : undefined;
    const rangeLabel = transcribeStart !== undefined && transcribeEnd !== undefined
      ? ` (${formatTime(transcribeStart)} — ${formatTime(transcribeEnd)}, ${(transcribeEnd - transcribeStart).toFixed(0)}s)`
      : '';

    emitProgress('transcribing', 0);
    console.log(`[ManualPipeline] Stage 2: Getting transcript (YouTube subs → Whisper fallback)${rangeLabel}...`);
    try {
      const result = await getTranscriptForYouTube(url, videoPath, (progress, detail) => {
        emitProgress('transcribing', progress, detail ? { detail } : undefined);
      }, transcribeStart, transcribeEnd);
      resolvedTranscript = result ?? undefined;
      emitProgress('transcribing', 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      console.warn(`[ManualPipeline] All transcription methods failed, proceeding without subtitles: ${msg}`);
      resolvedTranscript = undefined;
      emitProgress('transcribing', 100); // move past it
    }
  }

  // Build ViralMoment[] from user-specified ranges
  const moments: ViralMoment[] = ranges.map((r, i) => ({
    startTime: r.start,
    endTime: r.end,
    reason: `Manual clip ${i + 1} (${formatTime(r.start)} — ${formatTime(r.end)})`,
    ...(r.title ? { title: r.title } : {}),
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
    }, resolvedTranscript, true); // skipCleanup to keep source video for re-render
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