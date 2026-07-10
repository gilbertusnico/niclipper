/**
 * Audio Analyzer — Signal Processing from WAV file
 *
 * Analyzes audio features for retention prediction:
 * - RMS energy profile (loudness over time)
 * - Zero-crossing rate (pitch/intensity proxy)
 * - Silence/pause detection (natural boundaries)
 * - Energy bursts (emotional moments)
 *
 * All processing is done on raw PCM data — no external services.
 */

import fs from 'fs';
import type { AudioFeatures, PauseSegment } from './types.js';
import {
  AUDIO_FRAME_MS,
  SILENCE_RMS_THRESHOLD,
  SILENCE_MIN_DURATION,
  ENERGY_BURST_THRESHOLD,
} from './constants.js';

/** WAV header is 44 bytes for standard PCM */
const WAV_HEADER_SIZE = 44;

/**
 * Read WAV file and return raw PCM samples as Float32Array
 */
function readWavSamples(audioPath: string): { samples: Float32Array; sampleRate: number; channels: number } {
  const buffer = fs.readFileSync(audioPath);
  if (buffer.length < WAV_HEADER_SIZE) {
    throw new Error('Invalid WAV file: too small');
  }

  const sampleRate = buffer.readUInt32LE(24);
  const channels = buffer.readUInt16LE(22);
  const bitsPerSample = buffer.readUInt16LE(34);

  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported bits per sample: ${bitsPerSample}. Expected 16-bit.`);
  }

  const dataSize = buffer.length - WAV_HEADER_SIZE;
  const samplesPerChannel = dataSize / (bitsPerSample / 8) / channels;
  const samples = new Float32Array(samplesPerChannel);

  let offset = WAV_HEADER_SIZE;
  for (let i = 0; i < samplesPerChannel; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const sample = buffer.readInt16LE(offset);
      offset += 2;
      sum += sample;
    }
    samples[i] = sum / channels / 32768;
  }

  return { samples, sampleRate, channels };
}

/**
 * Compute RMS for a frame of audio data
 */
function computeRMS(frame: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < frame.length; i++) {
    sumSquares += frame[i] * frame[i];
  }
  return Math.sqrt(sumSquares / frame.length);
}

/**
 * Compute Zero-Crossing Rate for a frame
 */
function computeZCR(frame: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < frame.length; i++) {
    if ((frame[i] >= 0 && frame[i - 1] < 0) || (frame[i] < 0 && frame[i - 1] >= 0)) {
      crossings++;
    }
  }
  return crossings / frame.length;
}

/**
 * Analyze audio features from WAV file
 */
export function analyzeAudio(audioPath: string): AudioFeatures {
  const { samples, sampleRate } = readWavSamples(audioPath);
  const frameSize = Math.round(sampleRate * (AUDIO_FRAME_MS / 1000));
  const totalFrames = Math.floor(samples.length / frameSize);
  const durationMs = (samples.length / sampleRate) * 1000;

  // Compute per-frame RMS and ZCR
  const rmsPerFrame: number[] = [];
  const zcrPerFrame: number[] = [];

  for (let f = 0; f < totalFrames; f++) {
    const start = f * frameSize;
    const end = Math.min(start + frameSize, samples.length);
    const frame = samples.subarray(start, end);

    rmsPerFrame.push(computeRMS(frame));
    zcrPerFrame.push(computeZCR(frame));
  }

  // Compute RMS per second (aggregate frames into seconds)
  const framesPerSecond = 1000 / AUDIO_FRAME_MS;
  const totalSeconds = Math.ceil(totalFrames / framesPerSecond);
  const rmsPerSecond: number[] = [];

  for (let s = 0; s < totalSeconds; s++) {
    const frameStart = Math.round(s * framesPerSecond);
    const frameEnd = Math.round(Math.min((s + 1) * framesPerSecond, totalFrames));
    const slice = rmsPerFrame.slice(frameStart, frameEnd);
    const avgRms = slice.length > 0
      ? slice.reduce((a, b) => a + b, 0) / slice.length
      : 0;
    rmsPerSecond.push(avgRms);
  }

  // Average RMS for threshold calculations
  const avgRms = rmsPerFrame.length > 0
    ? rmsPerFrame.reduce((a, b) => a + b, 0) / rmsPerFrame.length
    : 0;

  // Detect silence segments (RMS below threshold for minimum duration)
  const silenceSegments: PauseSegment[] = [];
  let silenceStart: number | null = null;

  for (let f = 0; f < totalFrames; f++) {
    const timeMs = f * AUDIO_FRAME_MS;
    const isSilence = rmsPerFrame[f] < SILENCE_RMS_THRESHOLD;

    if (isSilence && silenceStart === null) {
      silenceStart = timeMs;
    } else if (!isSilence && silenceStart !== null) {
      const silenceDuration = (timeMs - silenceStart) / 1000;
      if (silenceDuration >= SILENCE_MIN_DURATION) {
        silenceSegments.push({
          startTime: silenceStart / 1000,
          endTime: timeMs / 1000,
          duration: silenceDuration,
        });
      }
      silenceStart = null;
    }
  }

  // Handle trailing silence
  if (silenceStart !== null) {
    const silenceDuration = (totalFrames * AUDIO_FRAME_MS - silenceStart) / 1000;
    if (silenceDuration >= SILENCE_MIN_DURATION) {
      silenceSegments.push({
        startTime: silenceStart / 1000,
        endTime: (totalFrames * AUDIO_FRAME_MS) / 1000,
        duration: silenceDuration,
      });
    }
  }

  // Detect energy bursts (sudden increase in RMS)
  const energyBursts: { time: number; intensity: number }[] = [];
  for (let f = 1; f < totalFrames; f++) {
    const ratio = avgRms > 0 ? rmsPerFrame[f] / avgRms : 0;
    if (ratio >= ENERGY_BURST_THRESHOLD) {
      energyBursts.push({
        time: (f * AUDIO_FRAME_MS) / 1000,
        intensity: ratio,
      });
    }
  }

  // Estimate speaking rate from audio (using ZCR-based voice activity)
  const speakingRate = estimateSpeakingRateFromAudio(zcrPerFrame, totalSeconds, sampleRate);

  // Estimate pitch from ZCR (rough approximation)
  const avgZcr = zcrPerFrame.length > 0
    ? zcrPerFrame.reduce((a, b) => a + b, 0) / zcrPerFrame.length
    : 0;
  const pitchVariation = computePitchVariation(zcrPerFrame, avgZcr);

  return {
    rmsPerSecond,
    energyBursts,
    silenceSegments,
    speakingRate,
    avgPitch: avgZcr,
    pitchVariation,
  };
}

/**
 * Estimate speaking rate from audio using ZCR-based voice activity detection
 */
function estimateSpeakingRateFromAudio(
  zcrPerFrame: number[],
  totalSeconds: number,
  sampleRate: number,
): number {
  if (totalSeconds <= 0) return 0;

  // Count frames with voice activity (ZCR above threshold)
  const voiceThreshold = 0.1; // ZCR threshold for voice vs silence
  const voiceFrames = zcrPerFrame.filter(z => z > voiceThreshold).length;
  const voiceRatio = voiceFrames / Math.max(zcrPerFrame.length, 1);

  // Rough estimate: speaking rate = 3-6 syllables/second for normal speech
  // Scale by voice activity ratio
  const baseRate = 4.5; // average syllables/sec
  return baseRate * voiceRatio;
}

/**
 * Compute pitch variation from ZCR deviation
 */
function computePitchVariation(zcrValues: number[], mean: number): number {
  if (zcrValues.length === 0 || mean === 0) return 0;

  const variance = zcrValues.reduce((sum, z) => sum + (z - mean) ** 2, 0) / zcrValues.length;
  return Math.sqrt(variance) / mean; // Coefficient of variation
}

/**
 * Get silence/pause boundaries near a given time
 * Used for snapping clip boundaries to natural pauses
 */
export function getPauseBoundaries(
  silenceSegments: PauseSegment[],
  nearTime: number,
  maxDistance: number,
): { start: number; end: number } | null {
  for (const pause of silenceSegments) {
    const distance = Math.abs(pause.endTime - nearTime);
    if (distance <= maxDistance) {
      return { start: pause.startTime, end: pause.endTime };
    }
  }
  return null;
}

/**
 * Check if there's dead air (long silence) in a time range
 */
export function hasDeadAir(
  silenceSegments: PauseSegment[],
  startTime: number,
  endTime: number,
): boolean {
  const totalSilence = silenceSegments
    .filter(p => p.startTime >= startTime && p.endTime <= endTime)
    .reduce((sum, p) => sum + p.duration, 0);

  const rangeDuration = endTime - startTime;
  return rangeDuration > 0 && (totalSilence / rangeDuration) > 0.3; // >30% silence = dead air
}