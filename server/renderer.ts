import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import type { ViralMoment, ClipResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.resolve(__dirname, '..', 'output');
const subtitlesDir = path.resolve(__dirname, '..', 'subtitles');
const tempDir = path.resolve(__dirname, '..', 'temp');

export type RenderProgressCallback = (progress: number) => void;

/**
 * Burn subtitles into each cropped clip and export final MP4s.
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
    const subtitlePath = path.join(subtitlesDir, `clip_${clipIndex}.srt`);

    const startPercent = Math.round((i / totalClips) * 100);
    onProgress(startPercent);

    console.log(`[Renderer] Burning subtitles for clip ${clipIndex}...`);

    // Check if subtitle file exists
    const hasSubtitles = fs.existsSync(subtitlePath) && fs.statSync(subtitlePath).size > 50;

    if (hasSubtitles) {
      await burnSubtitles(croppedFile, subtitlePath, outputPath, (clipProgress) => {
        const overall = Math.round(((i + clipProgress / 100) / totalClips) * 100);
        onProgress(overall);
      });
    } else {
      // No subtitles — just copy the file
      fs.copyFileSync(croppedFile, outputPath);
    }

    // Get duration of the output file
    const duration = await getVideoDuration(outputPath);

    clips.push({
      id: clipIndex,
      filename: `clip_${clipIndex}.mp4`,
      duration: Math.round(duration),
      startTime: Math.round(moment.startTime),
      endTime: Math.round(moment.endTime),
    });

    console.log(`[Renderer] Clip ${clipIndex} rendered: ${outputPath} (${Math.round(duration)}s)`);
  }

  onProgress(100);

  // Cleanup temp and subtitle files
  cleanupDirectories();

  return clips;
}

/**
 * Burn SRT subtitles into a video using FFmpeg.
 */
function burnSubtitles(
  videoPath: string,
  subtitlePath: string,
  outputPath: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Escape the subtitle path for FFmpeg filter
    const escapedSubPath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');

    ffmpeg(videoPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-vf', `subtitles=${escapedSubPath}`,
        '-preset', 'fast',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('progress', (info) => {
        if (info.percent) {
          onProgress(Math.min(info.percent, 99));
        }
      })
      .on('end', () => {
        onProgress(100);
        resolve();
      })
      .on('error', (err) => {
        if (err.message.includes('Cannot find ffmpeg') || err.message.includes('not found')) {
          reject(new Error('FFmpeg is not installed. Please install it: https://ffmpeg.org/download.html'));
        } else {
          reject(new Error(`Failed to burn subtitles: ${err.message}`));
        }
      })
      .run();
  });
}

/**
 * Get the duration of a video file in seconds using ffmpeg -i.
 */
function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    try {
      // ffmpeg -i exits with code 1 (no output file specified), so use || true to avoid error
      const output = execSync(`ffmpeg -i "${videoPath}" 2>&1 || true`, { encoding: 'utf8' });
      // Match "Duration: HH:MM:SS.MS"
      const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        const centiseconds = parseInt(match[4], 10);
        const total = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
        resolve(total);
      } else {
        reject(new Error(`Could not parse duration from ffmpeg output for ${videoPath}`));
      }
    } catch (err: any) {
      reject(new Error(`Failed to probe video duration: ${err.message}`));
    }
  });
}

/**
 * Clean up temp and subtitles directories.
 */
function cleanupDirectories(): void {
  for (const dir of [tempDir, subtitlesDir]) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(dir, file));
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
  console.log('[Renderer] Cleaned up temp files');
}