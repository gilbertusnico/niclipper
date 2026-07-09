import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import type { ViralMoment } from './types.js';

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
 * @param videoPath - Path to the original downloaded video
 * @param moment - The viral moment with start/end times
 * @param clipIndex - 1-based index of the clip
 * @param onProgress - Callback for cropping progress (0-100)
 * @returns Path to the cropped temp file
 */
export async function cropClips(
  videoPath: string,
  moment: ViralMoment,
  clipIndex: number,
  onProgress: CropProgressCallback,
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

  console.log(`[Cropper] Source: ${dimensions.width}x${dimensions.height}, Crop: ${cropWidth}x${cropHeight}+${cropX}+${cropY}`);

  return new Promise((resolve, reject) => {
    const duration = moment.endTime - moment.startTime;

    ffmpeg(videoPath)
      .seekInput(moment.startTime)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        // Crop filter
        `-vf`, `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`,
        '-preset', 'fast',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
      ])
      .output(outputPath)
      .on('progress', (info) => {
        if (info.percent) {
          onProgress(Math.min(info.percent, 99));
        }
      })
      .on('end', () => {
        onProgress(100);
        resolve(outputPath);
      })
      .on('error', (err) => {
        if (err.message.includes('Cannot find ffmpeg') || err.message.includes('not found')) {
          reject(new Error('FFmpeg is not installed. Please install it: https://ffmpeg.org/download.html'));
        } else {
          reject(new Error(`Cropping clip ${clipIndex} failed: ${err.message}`));
        }
      })
      .run();
  });
}

/**
 * Get video dimensions using ffmpeg -i output parsing.
 * Avoids needing ffprobe which may not be installed.
 */
function getVideoDimensions(videoPath: string): Promise<VideoDimensions> {
  return new Promise((resolve, reject) => {
    try {
      // ffmpeg -i outputs video info to stderr and exits with code 1 (no output file).
      // We use 2>&1 to merge stderr into stdout, then catch the error and parse stdout.
      execSync(`ffmpeg -i "${videoPath}" 2>&1`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      reject(new Error('Unexpected: ffmpeg -i should have exited with code 1'));
    } catch (err: any) {
      // With 2>&1, the merged output is in stdout since the shell handles the redirect
      let output = err.stdout || '';
      // Fallback to stderr or message if stdout is empty
      if (!output) {
        output = err.stderr || err.message || '';
      }

      // Parse the video stream line for resolution, e.g.:
      // Stream #0:0[0x1](und): Video: h264 (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], ...
      // We use a stricter pattern: digit{3,4}xdigit{3,4} to avoid matching hex codec tags like 0x31637661
      const match = output.match(/(\d{3,4})x(\d{3,4})/);
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
    }
  });
}