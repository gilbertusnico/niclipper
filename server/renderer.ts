import path from 'path';
import fs from 'fs';
import { execSync, exec as execCb } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getFfmpegPath } from './ffmpeg.js';
import type { ViralMoment, ClipResult } from './types.js';

const execAsync = promisify(execCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.resolve(__dirname, '..', 'output');
const tempDir = path.resolve(__dirname, '..', 'temp');

export type RenderProgressCallback = (progress: number) => void;

/**
 * Copy each cropped clip to the final output directory.
 * @param croppedFiles - Array of paths to cropped temp clips
 * @param moments - The viral moments with timestamps
 * @param onProgress - Callback for rendering progress (0-100)
 * @returns Array of clip results with filenames and metadata
 */
export async function renderFinalClips(
  croppedFiles: string[],
  moments: ViralMoment[],
  onProgress: RenderProgressCallback,
): Promise<ClipResult[]> {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Clean output directory first
  const existingFiles = fs.readdirSync(outputDir);
  for (const file of existingFiles) {
    fs.unlinkSync(path.join(outputDir, file));
  }

  const clips: ClipResult[] = [];
  const totalClips = croppedFiles.length;

  for (let i = 0; i < croppedFiles.length; i++) {
    const croppedFile = croppedFiles[i];
    const moment = moments[i] || { startTime: 0, endTime: 0, reason: '' };
    const clipIndex = i + 1;
    const outputPath = path.join(outputDir, `clip_${clipIndex}.mp4`);

    const startPercent = Math.round((i / totalClips) * 100);
    onProgress(startPercent);

    console.log(`[Renderer] Finalising clip ${clipIndex}...`);

    // Just copy the already-cropped file to the output directory
    fs.copyFileSync(croppedFile, outputPath);

    // Generate thumbnail (1 frame at 2s, 9:16 aspect)
    await generateThumbnail(outputPath, clipIndex);

    // Get duration of the output file
    const duration = await getVideoDuration(outputPath);

    const clip: ClipResult = {
      id: clipIndex,
      filename: `clip_${clipIndex}.mp4`,
      duration: Math.round(duration),
      startTime: Math.round(moment.startTime),
      endTime: Math.round(moment.endTime),
    };

    // Forward all available analysis metadata
    if (moment.reason) clip.reason = moment.reason;
    if (moment.finalScore !== undefined) clip.finalScore = Math.round(moment.finalScore * 100) / 100;
    if (moment.retentionScore) clip.retentionScore = moment.retentionScore;
    if (moment.narrativeStages) clip.narrativeStages = moment.narrativeStages;
    if (moment.contentType) clip.contentType = moment.contentType;
    if (moment.confidence !== undefined) clip.confidence = moment.confidence;

    clips.push(clip);

    console.log(`[Renderer] Clip ${clipIndex} ready: ${outputPath} (${Math.round(duration)}s)`);
  }

  onProgress(100);

  // Cleanup temp files
  cleanupTempFiles();

  return clips;
}

/**
 * Get the duration of a video file in seconds using ffmpeg -i.
 * Returns 0 if duration cannot be determined.
 */
function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const ffmpegBin = getFfmpegPath();
      const output = execSync(`"${ffmpegBin}" -i "${videoPath}" 2>&1 || true`, { encoding: 'utf8' });
      const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        const centiseconds = parseInt(match[4], 10);
        const total = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
        resolve(total);
      } else {
        console.log(`[Renderer] Warning: Could not parse duration for ${videoPath}, assuming 0s`);
        resolve(0);
      }
    } catch (err: any) {
      console.log(`[Renderer] Warning: Failed to probe duration for ${videoPath}: ${err.message}`);
      resolve(0);
    }
  });
}

/**
 * Clean up temp directory.
 */
function cleanupTempFiles(): void {
  if (fs.existsSync(tempDir)) {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(tempDir, file));
      } catch {
        // Ignore cleanup errors
      }
    }
  }
  console.log('[Renderer] Cleaned up temp files');
}

/**
 * Generate a 9:16 thumbnail for a clip.
 * Extracts 1 frame at 2 seconds into the video.
 */
async function generateThumbnail(videoPath: string, clipIndex: number): Promise<void> {
  const ffmpegBin = getFfmpegPath();
  const thumbnailPath = path.join(outputDir, `clip_${clipIndex}.jpg`);

  try {
    // Extract a frame at 2s timestamp, force 9:16 aspect ratio output
    const cmd = `"${ffmpegBin}" -y -i "${videoPath}" -ss 00:00:02 -vframes 1 -vf "scale=432:768:force_original_aspect_ratio=increase,crop=432:768" -q:v 3 "${thumbnailPath}" 2>&1 || true`;
    await execAsync(cmd);

    // If file was created and has content, we're good
    if (fs.existsSync(thumbnailPath) && fs.statSync(thumbnailPath).size > 0) {
      console.log(`[Renderer] Thumbnail generated: ${thumbnailPath}`);
    } else {
      // Fallback: try without aspect ratio forcing, just extract any frame
      const fallbackCmd = `"${ffmpegBin}" -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -q:v 3 "${thumbnailPath}" 2>&1 || true`;
      await execAsync(fallbackCmd);
    }
  } catch (err) {
    console.log(`[Renderer] Thumbnail generation skipped for clip ${clipIndex}: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}