import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { ViralMoment } from './types.js';
import { runFfmpeg, getFfmpegPath } from './ffmpeg.js';
import { parseTranscriptToSegments, filterSegmentsForClip, writeAssFile } from './subtitles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.resolve(__dirname, '..', 'temp');

export type CropProgressCallback = (progress: number) => void;

interface VideoDimensions {
  width: number;
  height: number;
}

/**
 * Crop a viral moment segment to 1080×1920 vertical video.
 * If a transcript is provided, TikTok-style subtitles (bold white + black stroke)
 * are burned into the video using an ASS subtitle file.
 *
 * Uses raw ffmpeg (not fluent-ffmpeg) to avoid needing ffprobe.
 *
 * @param videoPath - Path to the original downloaded video
 * @param moment - The viral moment with start/end times
 * @param clipIndex - 1-based index of the clip
 * @param onProgress - Callback for cropping progress (0-100)
 * @param transcript - Optional full transcript string to burn subtitles
 * @returns Path to the cropped temp file
 */
export async function cropClips(
  videoPath: string,
  moment: ViralMoment,
  clipIndex: number,
  onProgress: CropProgressCallback,
  transcript?: string,
): Promise<string> {
  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const outputPath = path.join(tempDir, `clip_${clipIndex}.mp4`);

  // Get source video dimensions
  const dimensions = await getVideoDimensions(videoPath);

  // Calculate crop for 9:16 vertical
  // We want to take a vertical slice from the center of the video
  const targetAspect = 9 / 16; // width/height for vertical

  let cropWidth: number;
  let cropHeight: number;
  let cropX: number;
  let cropY: number;

  if (dimensions.width / dimensions.height > targetAspect) {
    // Video is wider than target — crop width from center
    cropHeight = dimensions.height;
    cropWidth = Math.round(dimensions.height * targetAspect);
    cropX = Math.round((dimensions.width - cropWidth) / 2);
    cropY = 0;
  } else {
    // Video is taller than target — crop height from center
    cropWidth = dimensions.width;
    cropHeight = Math.round(dimensions.width / targetAspect);
    cropX = 0;
    cropY = Math.round((dimensions.height - cropHeight) / 2);
  }

  console.log(`[Cropper] Source: ${dimensions.width}x${dimensions.height}, Center crop: ${cropWidth}x${cropHeight}+${cropX}+${cropY}`);

  const duration = moment.endTime - moment.startTime;

  // ── Subtitle generation (burned into video) ───────────────────
  // Generate an ASS subtitle file from the transcript and burn it
  // into the video using FFmpeg's ass filter (TikTok-style).
  let assPath: string | null = null;

  if (transcript && transcript.trim().length > 0) {
    try {
      const allSegments = parseTranscriptToSegments(transcript);
      const clipSegments = filterSegmentsForClip(allSegments, moment.startTime, moment.endTime);
      if (clipSegments.length > 0) {
        assPath = path.join(tempDir, `clip_${clipIndex}.ass`);
        writeAssFile(clipSegments, assPath, 1080, 1920);
        console.log(`[Cropper] Generated ASS subtitle: ${assPath} (${clipSegments.length} segments)`);
      }
    } catch (err) {
      console.warn(`[Cropper] Failed to generate subtitles for clip ${clipIndex}:`, err instanceof Error ? err.message : err);
    }
  }

  // Build raw ffmpeg args:
  // ffmpeg -ss <start> -i <input> -t <duration> -c:v libx264 -c:a aac
  //        -vf "crop=...:...,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[,ass=file.ass]"
  //        -preset fast -crf 22 -pix_fmt yuv420p <output>
  const vfParts = [
    `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920`,
  ];

  // Add ASS subtitle burn-in after the video is at 1080x1920
  if (assPath) {
    // Escape backslashes for the filter string
    const escapedAssPath = assPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    vfParts.push(`ass=${escapedAssPath}`);
  }

  const vf = vfParts.join(',');

  const args = [
    '-ss', String(moment.startTime),
    '-i', videoPath,
    '-t', String(duration),
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-vf', vf,
    '-preset', 'fast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-y', // overwrite output
    outputPath,
  ];

  await runFfmpeg(args, {
    totalDuration: duration,
    onProgress,
    timeout: 30 * 60 * 1000, // 30 min timeout for long clips
  });

  return outputPath;
}

/**
 * Get video dimensions using ffmpeg -i output parsing.
 * Avoids needing ffprobe which may not be installed.
 */
function getVideoDimensions(videoPath: string): Promise<VideoDimensions> {
  return new Promise((resolve, reject) => {
    try {
      const ffmpegBin = getFfmpegPath();
      // ffmpeg -i outputs video info to stderr and exits with code 1 (no output file).
      const output = execSync(`"${ffmpegBin}" -i "${videoPath}" 2>&1 || true`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Parse the video stream line for resolution, e.g.:
      // Stream #0:0[0x1](und): Video: h264 (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], ...
      // Use a strict pattern: digit{3,4}xdigit{3,4} to avoid matching hex codec tags like 0x31637661
      const match = output.match(/\b(\d{3,4})x(\d{3,4})\b/);
      if (!match) {
        reject(new Error(`Could not determine video dimensions from ffmpeg output:\n${output.slice(-500)}`));
        return;
      }

      const width = parseInt(match[1], 10);
      const height = parseInt(match[2], 10);

      if (!width || !height) {
        reject(new Error(`Invalid video dimensions: ${width}x${height}`));
        return;
      }

      console.log(`[Cropper] Detected video dimensions: ${width}x${height}`);
      resolve({ width, height });
    } catch (err: any) {
      reject(new Error(`Failed to probe video: ${err.message}`));
    }
  });
}