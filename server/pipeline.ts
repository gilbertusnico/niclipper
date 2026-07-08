import { downloadVideo } from './downloader.js';
import { transcribeAudio } from './transcriber.js';
import { analyzeTranscript } from './analyzer.js';
import { cropClips } from './cropper.js';
import { generateSubtitles } from './subtitle.js';
import { renderFinalClips } from './renderer.js';
import type { ClipResult, ViralMoment, ProgressCallback } from './types.js';

export type { ClipResult, ViralMoment, ProgressCallback };

/**
 * Run the full Niclipper pipeline:
 * 1. Download video from YouTube
 * 2. Extract audio and transcribe
 * 3. Analyze transcript for viral moments
 * 4. Crop each moment to 9:16 vertical
 * 5. Generate Indonesian subtitles
 * 6. Burn subtitles and render final clips
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

  // ── Stage 3: Analyze ───────────────────────────────────────────────
  emitProgress('analyzing', 0);
  console.log('[Pipeline] Stage 3: Analyzing transcript for viral moments...');

  let moments: ViralMoment[];
  try {
    moments = await analyzeTranscript(transcript, (progress) => {
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
      });
      croppedFiles.push(cropped);

      console.log(`[Pipeline] Cropped clip ${i + 1}: ${moment.startTime}s - ${moment.endTime}s`);
    }
    emitProgress('cropping', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Cropping failed';
    throw new Error(`Cropping failed: ${msg}`);
  }

  // ── Stage 5: Generate Subtitles ────────────────────────────────────
  emitProgress('subtitles', 0);
  console.log('[Pipeline] Stage 5: Generating subtitles...');

  try {
    for (let i = 0; i < moments.length; i++) {
      const moment = moments[i];
      const subProgress = Math.round(((i + 1) / moments.length) * 100);
      emitProgress('subtitles', subProgress, { clip: i + 1 });

      await generateSubtitles(transcript, moment, i + 1);
      console.log(`[Pipeline] Subtitles generated for clip ${i + 1}`);
    }
    emitProgress('subtitles', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Subtitle generation failed';
    throw new Error(`Subtitle generation failed: ${msg}`);
  }

  // ── Stage 6: Render ────────────────────────────────────────────────
  emitProgress('rendering', 0);
  console.log('[Pipeline] Stage 6: Rendering final clips...');

  let clips: ClipResult[];
  try {
    clips = await renderFinalClips(croppedFiles, moments, (progress) => {
      emitProgress('rendering', progress);
    });
    console.log(`[Pipeline] Rendered ${clips.length} final clips`);
    emitProgress('rendering', 100);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Rendering failed';
    throw new Error(`Rendering failed: ${msg}`);
  }

  // Cleanup temp files (non-blocking)
  cleanup();

  return clips;
}

/**
 * Clean up temporary files
 */
function cleanup(): void {
  import('fs').then((fs) => {
    const tempDir = new URL('../temp', import.meta.url).pathname;
    const subsDir = new URL('../subtitles', import.meta.url).pathname;

    for (const dir of [tempDir, subsDir]) {
      fs.readdir(dir, (err, files) => {
        if (err) return;
        for (const file of files) {
          fs.unlink(pathJoin(dir, file), () => {});
        }
      });
    }
  }).catch(() => {});
}

function pathJoin(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}