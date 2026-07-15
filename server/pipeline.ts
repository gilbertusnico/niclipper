import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadVideo } from './downloader.js';
import { transcribeAudio } from './transcriber.js';
import { analyzeTranscript } from './analyzer.js';
import { cropClips } from './cropper.js';
import { renderFinalClips } from './renderer.js';
import type { ClipResult, ViralMoment, ProgressCallback } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type { ClipResult, ViralMoment, ProgressCallback };

/**
 * Run the full Niclipper pipeline:
 * 1. Download video from YouTube
 * 2. Extract audio and transcribe
 * 3. Analyze transcript for viral moments
 * 4. Crop each moment to 9:16 vertical
 * 5. Render final clips
 */
export async function runPipeline(
  url: string,
  emitProgress: ProgressCallback,
): Promise<ClipResult[]> {
  // ── Stage 1: Download ──────────────────────────────────────────────
  emitProgress('downloading', 0);
  console.log('[Pipeline] Stage 1: Downloading video...');

  let videoPath: string;
  try {
    videoPath = await downloadVideo(url, (progress) => {
      emitProgress('downloading', progress);
    });
    console.log(`[Pipeline] Video downloaded: ${videoPath}`);
    emitProgress('downloading', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Download failed';
    throw new Error(`Download failed: ${msg}`);
  }

  // ── Stage 2: Transcribe ───────────────────────────────────────────
  emitProgress('transcribing', 0);
  console.log('[Pipeline] Stage 2: Transcribing audio...');

  let transcript: string;
  try {
    transcript = await transcribeAudio(videoPath, (progress) => {
      emitProgress('transcribing', progress);
    });
    console.log(`[Pipeline] Transcript length: ${transcript.length} chars`);
    emitProgress('transcribing', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Transcription failed';
    throw new Error(`Transcription failed: ${msg}`);
  }

  // ── Stage 3: Analyze with Content Understanding Engine ──────────────
  emitProgress('analyzing', 0);
  console.log('[Pipeline] Stage 3: Analyzing transcript for viral moments...');

  let moments: ViralMoment[];
  try {
    const tempDir = path.resolve(__dirname, '..', 'temp');
    const audioPath = path.join(tempDir, 'audio.wav');
    moments = await analyzeTranscript(transcript, videoPath, audioPath, (progress) => {
      emitProgress('analyzing', progress);
    });
    console.log(`[Pipeline] Found ${moments.length} viral moments`);
    emitProgress('analyzing', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Analysis failed';
    throw new Error(`Analysis failed: ${msg}`);
  }

  if (moments.length === 0) {
    throw new Error('No viral moments found in the video');
  }

  // ── Stage 4: Crop ──────────────────────────────────────────────────
  emitProgress('cropping', 0);
  console.log('[Pipeline] Stage 4: Cropping clips to vertical...');

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
      }, transcript);
      croppedFiles.push(cropped);

      console.log(`[Pipeline] Cropped clip ${i + 1}: ${moment.startTime}s - ${moment.endTime}s`);
    }
    emitProgress('cropping', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Cropping failed';
    throw new Error(`Cropping failed: ${msg}`);
  }

  // ── Stage 5: Render ────────────────────────────────────────────────
  emitProgress('rendering', 0);
  console.log('[Pipeline] Stage 5: Rendering final clips...');

  let clips: ClipResult[];
  try {
    clips = await renderFinalClips(croppedFiles, moments, (progress) => {
      emitProgress('rendering', progress);
    }, transcript, true); // skipCleanup to keep source video for re-render
    console.log(`[Pipeline] Rendered ${clips.length} final clips`);
    emitProgress('rendering', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Rendering failed';
    throw new Error(`Rendering failed: ${msg}`);
  }

  return clips;
}

export function cleanupTempDir(): void {
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