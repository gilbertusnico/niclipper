import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';

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
 * Extract audio to 16kHz mono WAV (the format Whisper expects).
 */
function extractAudioToWav(
  videoPath: string,
  outputPath: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Remove existing temp file if it exists
    try {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    } catch {
      // ignore
    }

    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le') // 16-bit PCM
      .audioFrequency(16000)    // 16kHz — Whisper expects this
      .audioChannels(1)         // mono
      .output(outputPath)
      .on('progress', (info) => {
        if (info.percent) {
          onProgress(Math.min(info.percent, 99));
        }
      })
      .on('end', () => {
        onProgress(100);
        resolve();
      })
      .on('error', (err) => {
        if (err.message.includes('Cannot find ffmpeg') || err.message.includes('not found')) {
          reject(new Error('FFmpeg is not installed. Please install it: https://ffmpeg.org/download.html'));
        } else {
          reject(new Error(`Audio extraction failed: ${err.message}`));
        }
      })
      .run();
  });
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

  // Use 'tiny' model (~150MB) for speed — change to 'base' (~300MB) for better accuracy
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

  // Transcribe the audio file with timestamps
  console.log('[Transcriber] Running Whisper transcription...');
  const result = await transcriber(audioPath, {
    return_timestamps: true,
    language: 'indonesian',
    task: 'transcribe',
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