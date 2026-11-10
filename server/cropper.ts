import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { ViralMoment } from './types.js';
import { runFfmpeg, getFfmpegPath, hasFfmpegFilter } from './ffmpeg.js';
import { buildCardsForClip, writeHighlightAssFile, type WordTiming } from './subtitles.js';
import {
  SUBTITLE_STYLE,
  getSubtitleFontPath,
  toDisplayText,
  layoutCardLines,
  fitFontSize,
} from './subtitle-style.js';
import { generateHookAss, buildHookDrawText } from './hook-overlay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const tempDir = path.resolve(projectRoot, 'temp');

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
 * @param words - Optional per-word timings (absolute seconds) for the yellow
 *                highlight; estimated from the transcript when missing
 * @param options.hook - Hook line burned in big at the start (see hook-overlay.ts)
 * @returns Path to the cropped temp file
 */
export async function cropClips(
  videoPath: string,
  moment: ViralMoment,
  clipIndex: number,
  onProgress: CropProgressCallback,
  transcript?: string,
  words?: WordTiming[],
  options: { hook?: string } = {},
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
  // ASS (libass) draws the word-highlight captions in one filter. drawtext is
  // kept as a fallback for FFmpeg builds without libass (no highlight there).
  let subtitleOverlay: string | null = null;
  let subtitleTextFiles: string[] = [];

  if (transcript && transcript.trim().length > 0) {
    try {
      const cards = buildCardsForClip(transcript, words, moment.startTime, moment.endTime);
      const timing = words?.length ? 'YouTube word timing' : 'estimated word timing';

      // No fallback: one frozen card of unrelated text for the whole clip is worse
      // than no subtitles, and it hides timestamp bugs.
      if (cards.length === 0) {
        console.warn(`[Cropper] No timestamped subtitle segments matched clip ${clipIndex} (${moment.startTime}s–${moment.endTime}s); skipping subtitles.`);
      } else if (hasFfmpegFilter('ass')) {
        const assPath = path.join(tempDir, `sub_${clipIndex}.ass`);
        writeHighlightAssFile(cards, assPath, 1080, 1920);
        subtitleTextFiles = [assPath];
        const fontFile = getSubtitleFontPath();
        subtitleOverlay = `ass=filename=${quoteFilterValue(assPath)}`
          + (fontFile ? `:fontsdir=${quoteFilterValue(path.dirname(fontFile))}` : '');
        console.log(`[Cropper] Prepared ${cards.length} word-highlight subtitle cards (${timing}) for clip ${clipIndex}.`);
      } else if (hasFfmpegFilter('drawtext')) {
        const segments = cards.map((c) => ({ start: c.start, end: c.end, text: c.words.map((w) => w.text).join(' ') }));
        const built = buildTimedDrawTextFilter(segments, 1080, 1920, clipIndex);
        subtitleOverlay = built.filter;
        subtitleTextFiles = built.files;
        console.warn(`[Cropper] FFmpeg has no 'ass' filter; using drawtext without word highlight for clip ${clipIndex}.`);
      } else {
        console.warn('[Cropper] FFmpeg has neither ass nor drawtext filter. Skipping subtitle burn-in for clip.', {
          clipIndex,
          ffmpegPath: getFfmpegPath(),
        });
      }
    } catch (err) {
      console.warn(`[Cropper] Failed to generate subtitles for clip ${clipIndex}:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Hook text (big, first ~3.5 s, top of the frame) ───────────
  let hookOverlay: string | null = null;
  const hook = options.hook?.trim();
  if (hook) {
    try {
      if (hasFfmpegFilter('ass')) {
        const content = generateHookAss(hook, duration, 1080, 1920);
        if (content) {
          const assPath = path.join(tempDir, `hook_${clipIndex}.ass`);
          fs.writeFileSync(assPath, content, 'utf-8');
          subtitleTextFiles.push(assPath);
          const fontFile = getSubtitleFontPath();
          hookOverlay = `ass=filename=${quoteFilterValue(assPath)}`
            + (fontFile ? `:fontsdir=${quoteFilterValue(path.dirname(fontFile))}` : '');
        }
      } else if (hasFfmpegFilter('drawtext')) {
        const built = buildHookDrawText(hook, duration, 1080, 1920, getSubtitleFontPath(), tempDir, clipIndex);
        if (built) {
          hookOverlay = built.filter;
          subtitleTextFiles.push(...built.files);
        }
      }
      if (hookOverlay) console.log(`[Cropper] Hook text for clip ${clipIndex}: "${hook}"`);
    } catch (err) {
      console.warn(`[Cropper] Failed to build hook text for clip ${clipIndex}:`, err instanceof Error ? err.message : err);
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

  // Text overlay goes after the video is at 1080x1920 (the ASS PlayRes).
  if (subtitleOverlay) {
    vfParts.push(subtitleOverlay);
  }
  // Hook last, so it is drawn on top of the captions.
  if (hookOverlay) {
    vfParts.push(hookOverlay);
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
    '-movflags', '+faststart',
    '-y', // overwrite output
    outputPath,
  ];

  try {
    await runFfmpeg(args, {
      totalDuration: duration,
      onProgress,
      timeout: 30 * 60 * 1000, // 30 min timeout for long clips
    });
  } finally {
    for (const file of subtitleTextFiles) {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }

  return outputPath;
}

/** Quote a value for use as a single-quoted ffmpeg filter option. */
function quoteFilterValue(value: string): string {
  // ffmpeg accepts forward slashes on every OS; a quote is closed, escaped, reopened.
  return `'${value.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

/**
 * Build the drawtext filters for all subtitle segments (style: subtitle-style.ts).
 *
 * Each line of each segment gets its own drawtext so every line is centered
 * independently and placed at a fixed y (works on any ffmpeg version; the
 * `text_align` option only exists from ffmpeg 6.1).
 *
 * Text goes through small temp files (`textfile=` + `expansion=none`) so
 * quotes, colons and % in speech need no escaping. (Inline `text='a\\nb'`
 * rendered a literal "n" instead of a line break.)
 *
 * Segments are already non-overlapping (see normalizeSegments) and the enable
 * window is half-open [start, end), so two segments never share a frame.
 */
function buildTimedDrawTextFilter(
  segments: Array<{ start: number; end: number; text: string }>,
  width: number,
  height: number,
  clipIndex: number,
): { filter: string; files: string[] } {
  // Style values are tuned for a 1080-wide frame; scale for other sizes.
  const scale = width / 1080;
  const fontFile = getSubtitleFontPath();
  const lineHeight = Math.round(SUBTITLE_STYLE.fontSize * SUBTITLE_STYLE.lineHeightRatio * scale);
  const bottomMargin = Math.round(height * SUBTITLE_STYLE.bottomMarginRatio);
  const shadow = Math.max(1, Math.round(SUBTITLE_STYLE.shadowOffset * scale));

  const files: string[] = [];
  const filters: string[] = [];

  segments.forEach((segment, i) => {
    const lines = layoutCardLines(toDisplayText(segment.text));
    const enable = `'gte(t,${segment.start})*lt(t,${segment.end})'`;

    lines.forEach((line, j) => {
      const textPath = path.join(tempDir, `sub_${clipIndex}_${i}_${j}.txt`);
      fs.writeFileSync(textPath, line, 'utf-8');
      files.push(textPath);

      const fontSize = Math.round(fitFontSize(line) * scale);
      const border = Math.max(2, Math.round(fontSize * SUBTITLE_STYLE.borderRatio));
      // Bottom-anchored block: lines stack upward from the bottom margin.
      // A shrunk line (very long word) is vertically centered in its slot.
      const slotTop = height - bottomMargin - (lines.length - j) * lineHeight;
      const y = Math.round(slotTop + (lineHeight - fontSize * SUBTITLE_STYLE.lineHeightRatio) / 2);

      filters.push([
        `drawtext=textfile=${quoteFilterValue(textPath)}`,
        'expansion=none',
        ...(fontFile ? [`fontfile=${quoteFilterValue(fontFile)}`] : []),
        'fontcolor=white',
        `fontsize=${fontSize}`,
        'bordercolor=black',
        `borderw=${border}`,
        `shadowcolor=${SUBTITLE_STYLE.shadowColor}`,
        `shadowx=${shadow}`,
        `shadowy=${shadow}`,
        'x=(w-text_w)/2',
        `y=${y}`,
        `enable=${enable}`,
      ].join(':'));
    });
  });

  return { filter: filters.join(','), files };
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