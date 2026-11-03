import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runFfmpeg } from './ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.resolve(__dirname, '..', 'temp');

export type TranscribeProgressCallback = (progress: number, detail?: string) => void;

/**
 * Transcribe audio from a video file using local Whisper (via @xenova/transformers).
 * Completely offline — no API keys, no rate limits, no cost.
 * The model is downloaded once on first use and cached.
 *
 * @param videoPath - Path to the video file
 * @param onProgress - Progress callback
 * @param startTime - Optional start time in seconds (only transcribe this segment)
 * @param endTime - Optional end time in seconds (only transcribe this segment)
 */
export async function transcribeAudio(
  videoPath: string,
  onProgress: TranscribeProgressCallback,
  startTime?: number,
  endTime?: number,
): Promise<string> {
  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const wavPath = path.join(tempDir, 'audio.wav');

  // Step 1: Extract audio to 16kHz mono WAV using FFmpeg (0-20% progress)
  const rangeLabel = startTime !== undefined && endTime !== undefined
    ? ` (${startTime}s → ${endTime}s, ${(endTime - startTime).toFixed(0)}s segment)`
    : '';
  onProgress(5, `Extracting audio from video${rangeLabel}...`);
  console.log(`[Transcriber] Extracting audio from ${videoPath}${rangeLabel}...`);

  await extractAudioToWav(videoPath, wavPath, startTime, endTime, (ffmpegProgress) => {
    onProgress(Math.round(ffmpegProgress * 0.2), 'Extracting audio...');
  });

  onProgress(20, 'Audio extracted, preparing transcription...');
  console.log(`[Transcriber] Audio extracted to ${wavPath}`);

  // Step 2: Transcribe using local Whisper model (20-100% progress)
  onProgress(25, 'Loading AI model (Whisper)...');
  console.log('[Transcriber] Loading Whisper model...');

  // A segment's audio starts at 0, so shift timestamps back to source-video time
  const timeOffset = startTime !== undefined && endTime !== undefined ? startTime : 0;
  const transcript = await transcribeWithWhisper(wavPath, (whisperProgress) => {
    onProgress(20 + Math.round(whisperProgress * 0.8));
  }, timeOffset);

  onProgress(100);
  console.log('[Transcriber] Transcription complete');

  return transcript;
}

/**
 * Extract audio to 16kHz mono WAV (the format Whisper expects) using raw FFmpeg.
 * If startTime and endTime are provided, only that segment is extracted — much faster
 * than extracting and transcribing the full video.
 */
function extractAudioToWav(
  videoPath: string,
  outputPath: string,
  startTime: number | undefined,
  endTime: number | undefined,
  onProgress: (progress: number) => void,
): Promise<void> {
  // Remove existing temp file if it exists
  try {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  } catch {
    // ignore
  }

  // Build ffmpeg args: when a time range is specified, seek first then cut
  // Using -ss before -i for fast seeking, then -to to limit duration
  const args: string[] = [];

  if (startTime !== undefined && endTime !== undefined) {
    const duration = endTime - startTime;
    args.push('-ss', String(startTime));
    args.push('-i', videoPath);
    args.push('-to', String(duration)); // relative to seek point
  } else {
    args.push('-i', videoPath);
  }

  args.push(
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    '-y',
    outputPath,
  );

  return runFfmpeg(args, { onProgress, timeout: 10 * 60 * 1000 });
}

/**
 * Read a WAV file and return the raw PCM samples as a Float32Array.
 * WAV header is parsed, and 16-bit PCM samples are normalized to [-1, 1].
 * This is needed because Node.js has no AudioContext, so we can't
 * pass a file path to the Transformers.js pipeline.
 */
function readWavAsFloat32Array(filePath: string): Float32Array {
  const buffer = fs.readFileSync(filePath);
  const header = buffer.subarray(0, 44);

  // Validate WAV header
  const riff = header.toString('ascii', 0, 4);
  const wave = header.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Invalid WAV file header');
  }

  const bitsPerSample = header.readUInt16LE(34);
  const numChannels = header.readUInt16LE(22);
  const dataSize = buffer.length - 44;

  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported bits per sample: ${bitsPerSample}. Expected 16-bit PCM.`);
  }

  // Read raw PCM samples
  const samplesPerChannel = dataSize / (bitsPerSample / 8) / numChannels;
  const result = new Float32Array(samplesPerChannel);

  let offset = 44; // start of PCM data
  for (let i = 0; i < samplesPerChannel; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      // Read signed 16-bit little-endian sample
      const sample = buffer.readInt16LE(offset);
      offset += 2;
      sum += sample;
    }
    // Average channels (mono mix) and normalize to [-1, 1]
    result[i] = sum / numChannels / 32768;
  }

  return result;
}

/**
 * Transcribe a WAV file using local Whisper model (via @xenova/transformers).
 * Lazy-loads the pipeline so the model is only downloaded once.
 *
 * @param timeOffset - Seconds added to every timestamp (start of the extracted segment)
 */
async function transcribeWithWhisper(
  audioPath: string,
  onProgress: TranscribeProgressCallback,
  timeOffset: number = 0,
): Promise<string> {
  // Dynamic import — @xenova/transformers is a heavy ESM-only module
  const { pipeline, env } = await import('@xenova/transformers');

  // Use 'tiny' model (~150MB) — faster and avoids ONNX reshape bug
  // that affects 'base' and larger models in transformers.js
  const MODEL_ID = 'Xenova/whisper-tiny';

  // Suppress ONNX Runtime warnings (unused initializer messages, etc.)
  env.logLevel = 'fatal';
  // Also set env variable for extra safety
  process.env.ORT_LOG_LEVEL = 'FATAL';

  // Cache the model in the project's temp directory (not in home dir)
  const modelCacheDir = path.resolve(tempDir, 'models');
  env.cacheDir = modelCacheDir;

  // 🧹 Clear any stale model cache from previous runs (e.g. whisper-base)
  // Corrupted ONNX files from a different model version cause the Reshape error
  try {
    if (fs.existsSync(modelCacheDir)) {
      // Only clear if the cached model doesn't match our target
      // (transformers.js caches under <cacheDir>/<org>/<model>, e.g. Xenova/whisper-tiny)
      const hasTinyModel = fs.existsSync(path.join(modelCacheDir, MODEL_ID));
      if (!hasTinyModel) {
        console.log('[Transcriber] Purging stale model cache (wrong model version)...');
        fs.rmSync(modelCacheDir, { recursive: true, force: true });
      }
    }
  } catch {
    // Non-critical
  }

  // Force fresh download from HuggingFace (don't silently use stale local files)
  env.allowLocalModels = false;
  env.useFS = false;

  // Create the ASR pipeline (downloads model on first run)
  // quantized: false avoids ONNX quantization reshape issues on some CPU archs
  const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
    quantized: false,
    progress_callback: (progress: { status: string; loaded?: number; total?: number }) => {
      if (progress.status === 'progress' && progress.loaded !== undefined && progress.total) {
        const modelLoadProgress = Math.round((progress.loaded / progress.total) * 30);
        // Show detailed download progress
        const downloadedMb = (progress.loaded / 1024 / 1024).toFixed(0);
        const totalMb = (progress.total / 1024 / 1024).toFixed(0);
        onProgress(modelLoadProgress, `Downloading AI model... ${downloadedMb}MB / ${totalMb}MB`);
      } else if (progress.status === 'initiate') {
        onProgress(26, 'Starting model download (150MB)...');
      } else if (progress.status === 'done') {
        onProgress(55, 'Model loaded, processing audio...');
      }
    },
  });

  onProgress(60, 'Processing audio data...');

  // Read the WAV file as raw PCM samples (Float32Array)
  // Node.js has no AudioContext, so we MUST pass audio data directly
  console.log('[Transcriber] Reading WAV audio data...');
  const audioData = readWavAsFloat32Array(audioPath);
  console.log(`[Transcriber] Loaded ${audioData.length} samples from WAV (${(audioData.length / 16000).toFixed(1)}s)`);

  // Transcribe the audio data with timestamps
  // Chunk into 30-second segments with 5-second stride for long audio
  console.log('[Transcriber] Running Whisper transcription...');
  let result: any;
  try {
    result = await transcriber(audioData, {
      return_timestamps: true,
      language: 'indonesian',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
  } catch (err: unknown) {
    const onnxError = err instanceof Error ? err.message : String(err);
    console.error('[Transcriber] ONNX/Runtime error:', onnxError);
    console.error('[Transcriber] Stack:', err instanceof Error ? err.stack : 'N/A');
    throw new Error(`Transcription failed (ONNX Reshape error): ${onnxError}`);
  }

  onProgress(95);

  // Format the result into the same timestamped format Gemini would return
  const chunks = (result as any).chunks || [];
  if (chunks.length === 0) {
    // If no chunks, return the full text with a single timestamp from 0
    if (result.text?.trim()) {
      const duration = getAudioDuration(audioPath);
      return `[TIMESTAMP: ${timeOffset.toFixed(1)} -> ${(timeOffset + duration).toFixed(1)}]\n${result.text.trim()}\n`;
    }
    throw new Error('Whisper returned empty transcription. The audio may be silent or unclear.');
  }

  const segments = chunks.map((chunk: any) => {
    const start = (chunk.timestamp?.[0] ?? 0) + timeOffset;
    // Whisper leaves the last chunk's end as null; normalizeSegments estimates it
    const end = chunk.timestamp?.[1] != null ? chunk.timestamp[1] + timeOffset : start;
    const text = (chunk.text || '').trim();
    return `[TIMESTAMP: ${start.toFixed(1)} -> ${end.toFixed(1)}]\n${text}`;
  });

  return segments.join('\n\n');
}

/**
 * Get the duration of a WAV file in seconds by reading the file header.
 */
function getAudioDuration(filePath: string): number {
  try {
    const header = fs.readFileSync(filePath, { length: 100 });
    // WAV format: chunk size at bytes 4-7, subchunk2 size at bytes 40-43
    // Sample rate at bytes 24-27, byte rate at bytes 28-31
    const sampleRate = header.readUInt32LE(24);
    const byteRate = header.readUInt32LE(28);
    const dataSize = fs.statSync(filePath).size - 44; // minus WAV header
    if (byteRate > 0) {
      return dataSize / byteRate;
    }
  } catch {
    // fallback
  }
  return 0;
}