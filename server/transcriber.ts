import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runFfmpeg } from './ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.resolve(__dirname, '..', 'temp');

export type TranscribeProgressCallback = (progress: number) => void;

/**
 * Transcribe audio from a video file using local Whisper (via @xenova/transformers).
 * Completely offline — no API keys, no rate limits, no cost.
 * The model is downloaded once on first use and cached.
 */
export async function transcribeAudio(
  videoPath: string,
  onProgress: TranscribeProgressCallback,
): Promise<string> {
  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const wavPath = path.join(tempDir, 'audio.wav');

  // Step 1: Extract audio to 16kHz mono WAV using FFmpeg (0-20% progress)
  onProgress(5);
  console.log(`[Transcriber] Extracting audio from ${videoPath}...`);

  await extractAudioToWav(videoPath, wavPath, (ffmpegProgress) => {
    onProgress(Math.round(ffmpegProgress * 0.2));
  });

  onProgress(20);
  console.log(`[Transcriber] Audio extracted to ${wavPath}`);

  // Step 2: Transcribe using local Whisper model (20-100% progress)
  onProgress(25);
  console.log('[Transcriber] Loading Whisper model...');

  const transcript = await transcribeWithWhisper(wavPath, (whisperProgress) => {
    onProgress(20 + Math.round(whisperProgress * 0.8));
  });

  onProgress(100);
  console.log('[Transcriber] Transcription complete');

  return transcript;
}

/**
 * Extract audio to 16kHz mono WAV (the format Whisper expects) using raw FFmpeg.
 */
function extractAudioToWav(
  videoPath: string,
  outputPath: string,
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

  const args = [
    '-i', videoPath,
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    '-y',
    outputPath,
  ];

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
 */
async function transcribeWithWhisper(
  audioPath: string,
  onProgress: (progress: number) => void,
): Promise<string> {
  // Dynamic import — @xenova/transformers is a heavy ESM-only module
  const { pipeline, env } = await import('@xenova/transformers');

  // Use 'tiny' model (~150MB) — faster and avoids ONNX reshape bug
  // that affects 'base' and larger models in transformers.js
  const MODEL_ID = 'Xenova/whisper-tiny';

  // Cache the model in the project's temp directory (not in home dir)
  env.cacheDir = path.resolve(tempDir, 'models');

  // Create the ASR pipeline (downloads model on first run)
  const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
    progress_callback: (progress: { status: string; loaded?: number; total?: number }) => {
      if (progress.status === 'progress' && progress.loaded !== undefined && progress.total) {
        const modelLoadProgress = Math.round((progress.loaded / progress.total) * 30);
        onProgress(modelLoadProgress);
      }
    },
  });

  onProgress(60);

  // Read the WAV file as raw PCM samples (Float32Array)
  // Node.js has no AudioContext, so we MUST pass audio data directly
  console.log('[Transcriber] Reading WAV audio data...');
  const audioData = readWavAsFloat32Array(audioPath);
  console.log(`[Transcriber] Loaded ${audioData.length} samples from WAV (${(audioData.length / 16000).toFixed(1)}s)`);

  // Transcribe the audio data with timestamps
  // Chunk into 30-second segments with 5-second stride for long audio
  console.log('[Transcriber] Running Whisper transcription...');
  const result = await transcriber(audioData, {
    return_timestamps: true,
    language: 'indonesian',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  onProgress(95);

  // Format the result into the same timestamped format Gemini would return
  const chunks = (result as any).chunks || [];
  if (chunks.length === 0) {
    // If no chunks, return the full text with a single timestamp from 0
    if (result.text?.trim()) {
      const duration = getAudioDuration(audioPath);
      return `[TIMESTAMP: 0.0 -> ${duration.toFixed(1)}]\n${result.text.trim()}\n`;
    }
    throw new Error('Whisper returned empty transcription. The audio may be silent or unclear.');
  }

  const segments = chunks.map((chunk: any) => {
    const start = chunk.timestamp?.[0] ?? 0;
    const end = chunk.timestamp?.[1] ?? start;
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