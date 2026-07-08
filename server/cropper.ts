import path from 'path';
import fs from 'fs';
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
 * Get video dimensions using FFprobe.
 */
function getVideoDimensions(videoPath: string): Promise<VideoDimensions> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to probe video: ${err.message}`));
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      if (!videoStream || !videoStream.width || !videoStream.height) {
        reject(new Error('Could not determine video dimensions'));
        return;
      }

      resolve({
        width: videoStream.width,
        height: videoStream.height,
      });
    });
  });
}