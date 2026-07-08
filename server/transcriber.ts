import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.resolve(__dirname, '..', 'temp');

export type TranscribeProgressCallback = (progress: number) => void;

/**
 * Extract audio from video and transcribe using Gemini.
 * @param videoPath - Path to the downloaded video file
 * @param onProgress - Callback for transcription progress (0-100)
 * @returns The full transcript text with timestamps
 */
export async function transcribeAudio(
  videoPath: string,
  onProgress: TranscribeProgressCallback,
): Promise<string> {
  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const audioPath = path.join(tempDir, 'audio.m4a');

  // Step 1: Extract audio using FFmpeg (0-30% progress)
  onProgress(5);
  console.log(`[Transcriber] Extracting audio from ${videoPath}...`);

  await extractAudio(videoPath, audioPath, (ffmpegProgress) => {
    // Map FFmpeg progress (0-100) to our 0-30 range
    onProgress(Math.round(ffmpegProgress * 0.3));
  });

  onProgress(30);
  console.log(`[Transcriber] Audio extracted to ${audioPath}`);

  // Step 2: Read audio file and send to Gemini (30-100% progress)
  onProgress(35);
  console.log('[Transcriber] Transcribing audio with Gemini...');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in .env file');
  }

  const transcript = await transcribeWithGemini(apiKey, audioPath, (geminiProgress) => {
    // Map Gemini progress (0-100) to our 30-100 range
    onProgress(30 + Math.round(geminiProgress * 0.7));
  });

  onProgress(100);
  console.log('[Transcriber] Transcription complete');

  return transcript;
}

/**
 * Extract audio from video file using FFmpeg.
 */
function extractAudio(
  videoPath: string,
  outputPath: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Remove existing temp file if it exists (avoids permission/overwrite issues)
    try {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    } catch {
      // ignore
    }

    // Use AAC re-encoding instead of stream copy — YouTube audio (Opus/AAC in MP4)
    // can't always be copied directly to an M4A container.
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('aac')
      .audioBitrate(128)
      .outputOptions(['-movflags', '+faststart'])
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
 * Send audio to Gemini API for transcription, with auto-retry on rate limits.
 */
async function transcribeWithGemini(
  apiKey: string,
  audioPath: string,
  onProgress: (progress: number) => void,
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);

  // Use Gemini 2.0 Flash for speed and cost
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
  });

  // Read audio file as base64
  const audioData = fs.readFileSync(audioPath);
  const base64Audio = audioData.toString('base64');

  onProgress(40);

  const prompt = `Transcribe this audio file in Indonesian language. 

For each spoken segment, provide:
1. The exact text spoken in Indonesian
2. The start time in seconds
3. The end time in seconds

Format each segment as:
[TIMESTAMP: startTime -> endTime]
SPOKEN TEXT

Example:
[TIMESTAMP: 0.0 -> 3.5]
Halo semuanya, selamat datang di video saya hari ini.

[TIMESTAMP: 3.5 -> 8.2]
Kita akan membahas topik yang sangat menarik.

Please transcribe EVERYTHING that is spoken, no matter how short. Do not skip any content. Be as accurate as possible with timestamps.`;

  // Retry config
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 2000; // 2 detik awal

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: 'audio/mp4',
            data: base64Audio,
          },
        },
        prompt,
      ]);

      onProgress(80);

      const response = await result.response;
      const text = response.text();

      onProgress(100);

      if (!text || text.trim().length === 0) {
        throw new Error('Gemini returned empty transcription. The audio may be silent or unclear.');
      }

      return text;
    } catch (err: any) {
      lastError = err;

      // Cek apakah ini 429 rate limit error
      const isRateLimit =
        err.message?.includes('429') ||
        err.message?.includes('Too Many Requests') ||
        err.message?.includes('quota') ||
        err.message?.includes('RESOURCE_EXHAUSTED');

      if (!isRateLimit || attempt >= MAX_RETRIES) {
        // Bukan rate limit — throw langsung
        // Atau udah habis percobaan — throw terakhir
        throw err;
      }

      // Exponential backoff + jitter
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
      console.log(`[Transcriber] Rate limited! Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt}/${MAX_RETRIES})...`);
      onProgress(30 + attempt * 3); // Progress sedikit naik biar keliatan hidup

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Shouldn't reach here, but just in case
  throw lastError || new Error('Transcription failed after retries');
}