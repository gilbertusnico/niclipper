/**
 * Framing for wide shots.
 *
 * Clips are a 9:16 crop from the middle of a 16:9 video. That works for
 * close-ups, but on a wide shot (whole set, people small, lots of table) the
 * middle strip is mostly empty table. Those shots are shown whole instead:
 * the full 16:9 frame in the middle of a blurred, darkened copy of itself.
 *
 * Detection is deliberately light (no ML model, fine on an old laptop):
 *  1. The clip is sampled twice a second; a sample's score is the share of
 *     skin-tone pixels in the upper half of the 9:16 crop. A close-up has a
 *     face and neck there (~0.13–0.27 on real podcasts); a wide shot has small
 *     people far away (~0.02–0.05). Below WIDE_SKIN_SHARE → wide.
 *  2. Labels are smoothed so the framing never flickers.
 *  3. Switches are moved onto FFmpeg's shot cuts when one is close.
 */

import fs from 'fs';
import path from 'path';
import { runFfmpeg } from './ffmpeg.js';

/** Below this share of skin-tone pixels (upper half of the 9:16 crop) a shot counts as wide. */
export const WIDE_SKIN_SHARE = 0.08;
/** Samples per second for the skin measure. */
const SAMPLE_FPS = 2;
/** FFmpeg scene score above which a frame counts as a shot cut (only used to place switches exactly). */
const SCENE_CUT = 0.15;
/** A framing change must last this many samples (1.5 s); shorter ones are ignored (no flicker). */
const MIN_RUN_SAMPLES = 3;
/** A switch moves onto a shot cut this close to it. */
const CUT_SNAP_SECONDS = 0.75;
/** Size of the analysed thumbnail (9:16). */
const W = 72;
const H = 128;

export interface Interval { start: number; end: number; }
export interface CropRect { width: number; height: number; x: number; y: number; }

/** Share of skin-tone pixels (YCbCr rule) in the upper half of one RGB thumbnail. */
export function skinShare(frame: Buffer): number {
  let skin = 0;
  let total = 0;
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const r = frame[i], g = frame[i + 1], b = frame[i + 2];
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      total++;
      if (cb >= 77 && cb <= 127 && cr >= 135 && cr <= 173 && r > 60) skin++;
    }
  }
  return total ? skin / total : 0;
}

/**
 * Turn per-sample skin shares (+ shot cuts) into wide-shot intervals.
 *  1. Label each sample wide / close.
 *  2. Drop one-sample blips (median of 3).
 *  3. A change only counts when it lasts MIN_RUN_SAMPLES; shorter runs keep
 *     the framing before them (no flicker).
 *  4. Move each switch onto the nearest shot cut, when one is close, so the
 *     framing changes exactly on the cut.
 * Exported for testing.
 */
export function wideIntervals(cuts: number[], samples: number[], duration: number): Interval[] {
  if (samples.length === 0) return [];
  const raw = samples.map((v) => v < WIDE_SKIN_SHARE);
  const label = raw.map((v, i) => {
    if (i === 0 || i === raw.length - 1) return v;
    const votes = Number(raw[i - 1]) + Number(v) + Number(raw[i + 1]);
    return votes >= 2;
  });

  // Runs of equal labels; short runs take the label of the run before them.
  const runs: { from: number; to: number; wide: boolean }[] = [];
  for (let i = 0; i < label.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.wide === label[i]) last.to = i;
    else runs.push({ from: i, to: i, wide: label[i] });
  }
  const merged: typeof runs = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    const short = run.to - run.from + 1 < MIN_RUN_SAMPLES;
    if (last && (short || last.wide === run.wide)) last.to = run.to;
    else merged.push({ ...run });
  }
  // A short first run (e.g. 1 s of close-up before a long wide shot) joins the next one.
  if (merged.length > 1 && merged[0].to - merged[0].from + 1 < MIN_RUN_SAMPLES) {
    merged[1].from = 0;
    merged.shift();
  }

  const snap = (t: number) => {
    let best = t;
    let dist = CUT_SNAP_SECONDS;
    for (const c of cuts) {
      const d = Math.abs(c - t);
      if (d < dist) { dist = d; best = c; }
    }
    return best;
  };
  const out: Interval[] = [];
  for (const run of merged) {
    if (!run.wide) continue;
    const start = run.from === 0 ? 0 : snap((run.from - 0.5) / SAMPLE_FPS);
    const end = run.to === label.length - 1 ? duration : snap((run.to + 0.5) / SAMPLE_FPS);
    if (end - start > 0.3) out.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
  }
  return out;
}

/**
 * Time ranges (seconds from the clip start) that are wide shots and should be
 * shown whole on a blurred background. Empty when everything is a close-up or
 * when detection fails (the clip is then cropped as before).
 */
export async function detectWideShots(
  videoPath: string,
  start: number,
  duration: number,
  crop: CropRect,
  tempDir: string,
  clipIndex: number,
): Promise<Interval[]> {
  const rawPath = path.join(tempDir, `framing_${clipIndex}.rgb`);
  try {
    // One decode: shot cuts (showinfo prints frames whose scene score is high)
    // and small RGB samples of the same 9:16 crop the clip will use.
    const log = await runFfmpeg([
      '-ss', String(start), '-t', String(duration), '-i', videoPath,
      '-filter_complex',
      `[0:v]split=2[a][b];` +
      `[a]scale=160:-2,select='gt(scene\\,${SCENE_CUT})',showinfo[cuts];` +
      `[b]fps=${SAMPLE_FPS},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${W}:${H},format=rgb24[s]`,
      '-map', '[cuts]', '-f', 'null', '-',
      '-map', '[s]', '-f', 'rawvideo', '-y', rawPath,
    ], { timeout: 5 * 60 * 1000 });

    const cuts = [...log.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => parseFloat(m[1])).filter(Number.isFinite);
    const raw = fs.readFileSync(rawPath);
    const frameBytes = W * H * 3;
    const samples: number[] = [];
    for (let off = 0; off + frameBytes <= raw.length; off += frameBytes) {
      samples.push(skinShare(raw.subarray(off, off + frameBytes)));
    }
    if (samples.length === 0) return [];
    return wideIntervals(cuts, samples, duration);
  } catch (err) {
    console.warn(`[Framing] Wide-shot detection failed for clip ${clipIndex}; cropping as usual:`, err instanceof Error ? err.message : err);
    return [];
  } finally {
    try { fs.unlinkSync(rawPath); } catch { /* ignore */ }
  }
}

/**
 * Filtergraph (for -filter_complex) from input [0:v] to [framed], 1080×1920:
 * the 9:16 crop, with wide-shot intervals replaced by the whole frame on a
 * blurred background. `intervals` must be non-empty.
 */
export function framedGraph(crop: CropRect, intervals: Interval[], duration: number): string {
  const fit =
    `[f0]split=2[bgsrc][fgsrc];` +
    // Blur at low resolution (cheap), then scale up; darken so the frame stands out.
    `[bgsrc]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=8,eq=brightness=-0.12,scale=1080:1920[bg];` +
    `[fgsrc]scale=1080:-2[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
  const fill = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;

  const coversAll = intervals.length === 1 && intervals[0].start <= 0.05 && intervals[0].end >= duration - 0.05;
  if (coversAll) return `[0:v]null[f0];${fit}[framed]`;

  const enable = intervals.map((iv) => `between(t,${iv.start},${iv.end})`).join('+');
  return `[0:v]split=2[c0][f0];[c0]${fill}[fill];${fit}[fit];[fill][fit]overlay=0:0:enable='${enable}'[framed]`;
}
