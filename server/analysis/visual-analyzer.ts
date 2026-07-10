/**
 * Visual Analyzer — Scene Change & Motion Detection via FFmpeg
 *
 * Detects visual signals from the video file:
 * - Scene changes (cuts/transitions)
 * - Motion intensity estimation
 *
 * Uses FFmpeg filters to extract metadata — no ML/CV models needed.
 */

import { runFfmpeg } from '../ffmpeg.js';
import type { VisualFeatures, SceneChange } from './types.js';
import { SCENE_CHANGE_THRESHOLD } from './constants.js';

/**
 * Parse FFmpeg scene detection output to extract timestamps
 * FFmpeg outputs lines like:
 *   [Parsed_showinfo ...] pts_time:42.5 ... scene:0.45
 */
function parseSceneChanges(ffmpegOutput: string): SceneChange[] {
  const scenes: SceneChange[] = [];
  const lines = ffmpegOutput.split('\n');

  const sceneRegex = /pts_time:([\d.]+).*?scene:([\d.]+)/;

  for (const line of lines) {
    const match = line.match(sceneRegex);
    if (match) {
      const time = parseFloat(match[1]);
      const confidence = parseFloat(match[2]);
      if (confidence >= SCENE_CHANGE_THRESHOLD) {
        scenes.push({ time, confidence });
      }
    }
  }

  return scenes;
}

/**
 * Parse motion intensity from FFmpeg signalstats output
 * Uses frame-to-frame difference as a proxy for motion
 */
function parseMotionIntensity(ffmpegOutput: string): number {
  const lines = ffmpegOutput.split('\n');
  let totalDiff = 0;
  let count = 0;

  // Look for YMIN/YMAX differences as a motion proxy
  const diffRegex = /YMIN:\s*(\d+)\s+YMAX:\s*(\d+)/;

  for (const line of lines) {
    const match = line.match(diffRegex);
    if (match) {
      const yMin = parseInt(match[1], 10);
      const yMax = parseInt(match[2], 10);
      totalDiff += yMax - yMin;
      count++;
    }
  }

  if (count === 0) return 0;
  const avgDiff = totalDiff / count;
  // Normalize to 0-1 scale (255 is max luma difference)
  return Math.min(1, avgDiff / 255);
}

/**
 * Detect scene changes and motion intensity from a video file
 */
export async function analyzeVideo(videoPath: string): Promise<VisualFeatures> {
  const scenes = await detectSceneChanges(videoPath);
  const motionIntensity = await estimateMotionIntensity(videoPath);

  return {
    sceneChanges: scenes,
    motionIntensity,
    hasFaceInFrame: false, // Face detection would require a CV model — future enhancement
  };
}

/**
 * Use FFmpeg scene detection filter to find scene changes
 */
async function detectSceneChanges(videoPath: string): Promise<SceneChange[]> {
  try {
    const args = [
      '-i', videoPath,
      '-filter:v', `select='gt(scene,${SCENE_CHANGE_THRESHOLD})',showinfo`,
      '-f', 'null',
      '-',
    ];

    const output = await runFfmpeg(args, { timeout: 30000 });
    return parseSceneChanges(output);
  } catch (err) {
    console.warn('[VisualAnalyzer] Scene detection failed, using empty:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Estimate motion intensity by analyzing frame-to-frame luma differences
 */
async function estimateMotionIntensity(videoPath: string): Promise<number> {
  try {
    // Use a short sample (first 30 seconds) to estimate motion
    const args = [
      '-i', videoPath,
      '-t', '30', // analyze first 30 seconds
      '-vf', 'signalstats',
      '-f', 'null',
      '-',
    ];

    const output = await runFfmpeg(args, { timeout: 30000 });
    return parseMotionIntensity(output);
  } catch (err) {
    console.warn('[VisualAnalyzer] Motion estimation failed, using 0:', err instanceof Error ? err.message : String(err));
    return 0;
  }
}

/**
 * Get the nearest scene change boundary near a given time
 */
export function getNearestSceneChange(
  sceneChanges: SceneChange[],
  time: number,
  maxDistance: number,
): number | null {
  let nearest: number | null = null;
  let nearestDist = maxDistance;

  for (const scene of sceneChanges) {
    const dist = Math.abs(scene.time - time);
    if (dist <= nearestDist) {
      nearestDist = dist;
      nearest = scene.time;
    }
  }

  return nearest;
}

/**
 * Check if a time range contains significant visual activity
 * (scene changes or motion)
 */
export function hasVisualActivity(
  sceneChanges: SceneChange[],
  motionIntensity: number,
  startTime: number,
  endTime: number,
): boolean {
  // Check for scene changes within range
  const hasScenes = sceneChanges.some(
    s => s.time >= startTime && s.time <= endTime,
  );

  // Check for high motion
  const hasMotion = motionIntensity > 0.3;

  return hasScenes || hasMotion;
}