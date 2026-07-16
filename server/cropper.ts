import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { ViralMoment } from './types.js';
import { runFfmpeg, getFfmpegPath } from './ffmpeg.js';
import {
  parseTranscriptToSegments,
  filterSegmentsForClip,
  writeAssFile,
} from './subtitles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.resolve(__dirname, '..', 'temp');

export type CropProgressCallback = (progress: number) => void;

interface VideoDimensions {
  width: number;
  height: number;
}

/**
 * Analyze a video frame using sharp to find the most visually interesting
 * region. Returns the optimal crop offset (X or Y) to center the 9:16 crop
 * on the area with the most detail/action.
 *
 * For wide videos (e.g. 16:9): analyzes horizontal strips → returns X offset
 * For tall videos (e.g. 9:16): analyzes vertical strips → returns Y offset
 *
 * @returns Pixel offset from center. Positive = right/down, negative = left/up, 0 = center.
 */
async function findSmartCropOffset(
  videoPath: string,
  momentStart: number,
  momentEnd: number,
  sourceWidth: number,
  sourceHeight: number,
  cropWidth: number,
  cropHeight: number,
  isWide: boolean,
): Promise<number> {
  const framePath = path.join(tempDir, `smart_frame_${Date.now()}.jpg`);
  const midpoint = (momentStart + momentEnd) / 2;

  try {
    // Extract a single frame at the midpoint
    const frameArgs = [
      '-y',
      '-ss', String(midpoint),
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      framePath,
    ];
    await runFfmpeg(frameArgs, { timeout: 15_000 });

    if (!fs.existsSync(framePath) || fs.statSync(framePath).size === 0) {
      return 0; // fallback to center
    }

    // Read with sharp and analyze
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(framePath).metadata();
    const fw = metadata.width || sourceWidth;
    const fh = metadata.height || sourceHeight;

    // Resize to a small analysis grid (320px on the long side)
    const analysisSize = 320;
    let analysisWidth: number;
    let analysisHeight: number;
    if (fw >= fh) {
      analysisWidth = analysisSize;
      analysisHeight = Math.round((analysisSize / fw) * fh);
    } else {
      analysisHeight = analysisSize;
      analysisWidth = Math.round((analysisSize / fh) * fw);
    }

    const rawBuffer = await sharp(framePath)
      .resize(analysisWidth, analysisHeight, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    const data = new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength);

    const numStrips = 8;
    const stripVariances: number[] = [];

    if (isWide) {
      // Analyze vertical strips (left to right) → find best X offset
      const stripW = Math.floor(analysisWidth / numStrips);

      for (let s = 0; s < numStrips; s++) {
        const startX = s * stripW;
        const endX = Math.min((s + 1) * stripW, analysisWidth);
        let sum = 0;
        let sumSq = 0;
        let count = 0;

        for (let y = 0; y < analysisHeight; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = y * analysisWidth + x;
            if (idx < data.length) {
              const val = data[idx];
              sum += val;
              sumSq += val * val;
              count++;
            }
          }
        }

        if (count > 0) {
          const mean = sum / count;
          const variance = sumSq / count - mean * mean;
          stripVariances.push(variance);
        } else {
          stripVariances.push(0);
        }
      }

      // Find best strip and convert to source-space X offset
      let maxVariance = -1;
      let bestStrip = Math.floor(numStrips / 2);
      for (let s = 0; s < stripVariances.length; s++) {
        if (stripVariances[s] > maxVariance) {
          maxVariance = stripVariances[s];
          bestStrip = s;
        }
      }

      const stripCenterRatio = (bestStrip + 0.5) / numStrips;
      const idealCenterX = stripCenterRatio * sourceWidth;
      const currentCenterX = sourceWidth / 2;
      const offsetX = Math.round(idealCenterX - currentCenterX);

      // Clamp so crop window stays within frame
      const maxOffset = Math.round((sourceWidth - cropWidth) / 2);
      const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, offsetX));

      console.log(`[SmartCrop] Wide video: best strip ${bestStrip}/${numStrips}, var=${maxVariance.toFixed(0)}, offsetX=${clampedOffset}px`);
      try { fs.unlinkSync(framePath); } catch { /* ignore */ }
      return clampedOffset;
    } else {
      // Analyze horizontal strips (top to bottom) → find best Y offset
      const stripW = analysisWidth;
      const stripH = Math.floor(analysisHeight / numStrips);

      for (let s = 0; s < numStrips; s++) {
        const startY = s * stripH;
        const endY = Math.min((s + 1) * stripH, analysisHeight);
        let sum = 0;
        let sumSq = 0;
        let count = 0;

        for (let y = startY; y < endY; y++) {
          for (let x = 0; x < stripW; x++) {
            const idx = y * analysisWidth + x;
            if (idx < data.length) {
              const val = data[idx];
              sum += val;
              sumSq += val * val;
              count++;
            }
          }
        }

        if (count > 0) {
          const mean = sum / count;
          const variance = sumSq / count - mean * mean;
          stripVariances.push(variance);
        } else {
          stripVariances.push(0);
        }
      }

      let maxVariance = -1;
      let bestStrip = Math.floor(numStrips / 2);
      for (let s = 0; s < stripVariances.length; s++) {
        if (stripVariances[s] > maxVariance) {
          maxVariance = stripVariances[s];
          bestStrip = s;
        }
      }

      const stripCenterRatio = (bestStrip + 0.5) / numStrips;
      const idealCenterY = stripCenterRatio * sourceHeight;
      const currentCenterY = sourceHeight / 2;
      const offsetY = Math.round(idealCenterY - currentCenterY);

      const maxOffset = Math.round((sourceHeight - cropHeight) / 2);
      const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, offsetY));

      console.log(`[SmartCrop] Tall video: best strip ${bestStrip}/${numStrips}, var=${maxVariance.toFixed(0)}, offsetY=${clampedOffset}px`);
      try { fs.unlinkSync(framePath); } catch { /* ignore */ }
      return clampedOffset;
    }
  } catch (err) {
    console.log(`[SmartCrop] Analysis failed, using center: ${err instanceof Error ? err.message : 'unknown'}`);
    try { fs.unlinkSync(framePath); } catch { /* ignore */ }
    return 0;
  }
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

  // ── Smart Crop: analyze frame and shift crop toward area of interest ──
  const isWide = dimensions.width / dimensions.height > targetAspect;
  const smartOffset = await findSmartCropOffset(
    videoPath,
    moment.startTime,
    moment.endTime,
    dimensions.width,
    dimensions.height,
    cropWidth,
    cropHeight,
    isWide,
  );

  if (isWide) {
    // Shift crop horizontally (X axis)
    cropX = Math.max(0, Math.min(dimensions.width - cropWidth, cropX + smartOffset));
  } else {
    // Shift crop vertically (Y axis)
    cropY = Math.max(0, Math.min(dimensions.height - cropHeight, cropY + smartOffset));
  }

  console.log(`[Cropper] Smart crop adjusted: ${cropWidth}x${cropHeight}+${cropX}+${cropY}`);

  const duration = moment.endTime - moment.startTime;

  // ── Optional: Burn TikTok-style subtitles ──────────────────────
  let assPath: string | null = null;

  if (transcript && transcript.trim().length > 0) {
    try {
      const allSegments = parseTranscriptToSegments(transcript);
      const clipSegments = filterSegmentsForClip(allSegments, moment.startTime, moment.endTime);

      if (clipSegments.length > 0) {
        assPath = path.join(tempDir, `subtitles_${clipIndex}.ass`);
        writeAssFile(clipSegments, assPath, 1080, 1920);
        console.log(`[Cropper] Burning ${clipSegments.length} subtitle segments for clip ${clipIndex}`);
      } else {
        console.log(`[Cropper] No subtitle segments in range for clip ${clipIndex}`);
      }
    } catch (err) {
      // Don't fail the whole crop if subtitles fail
      console.warn(`[Cropper] Subtitle generation failed for clip ${clipIndex}:`, err instanceof Error ? err.message : err);
    }
  }

  // Build raw ffmpeg args:
  // ffmpeg -ss <start> -i <input> -t <duration> -c:v libx264 -c:a aac
  //        -vf "crop=...:...,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
  //        -preset fast -crf 22 -pix_fmt yuv420p <output>
  const vfParts = [
    `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920`,
  ];

  // Append ASS subtitle filter if we have an ASS file
  if (assPath) {
    // Escape colons (filter option separator) for the filter string
    // On Linux/macOS paths start with / so this is mostly for safety
    const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
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