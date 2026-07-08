import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ViralMoment } from './types.js';

export type AnalyzeProgressCallback = (progress: number) => void;

/**
 * Analyze transcript to find the most engaging/viral moments.
 * @param transcript - The full video transcript text
 * @param onProgress - Callback for analysis progress (0-100)
 * @returns Array of viral moments with timestamps and reasons
 */
export async function analyzeTranscript(
  transcript: string,
  onProgress: AnalyzeProgressCallback,
): Promise<ViralMoment[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in .env file');
  }

  onProgress(10);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
  });

  onProgress(20);

  const prompt = `Kamu adalah analis konten viral Indonesia. Analisis transkrip video berikut dan temukan 3 momen PALING VIRAL yang cocok dijadikan short clip (30-90 detik) untuk platform seperti TikTok, Instagram Reels, atau YouTube Shorts.

Pertimbangkan:
- Momen yang paling menarik, mengejutkan, atau emosional
- Momen yang bisa berdiri sendiri tanpa konteks
- Momen dengan potensi engagement tinggi (like, share, comment)
- Hindari bagian intro/outro yang lambat

Transkrip video:
"""
${transcript}
"""

Berikan jawaban dalam format JSON ARRAY saja (tanpa markdown, tanpa penjelasan tambahan):
[
  {
    "startTime": <start_time_in_seconds>,
    "endTime": <end_time_in_seconds>,
    "reason": "<alasan kenapa momen ini viral dalam Bahasa Indonesia, maksimal 1 kalimat>"
  }
]

Pastikan:
- Setiap clip durasi 30-90 detik
- startTime dan endTime adalah angka (number) dalam detik
- startTime < endTime
- Berikan 3 momen terbaik
- Hanya return JSON array, tidak ada teks lain`;

  onProgress(30);

  const result = await model.generateContent(prompt);

  onProgress(70);

  const response = await result.response;
  const text = response.text().trim();

  onProgress(85);

  // Parse the JSON response
  // The response might be wrapped in markdown code blocks, handle that
  let jsonStr = text;

  // Remove markdown code block if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Also try to find a JSON array directly
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    jsonStr = arrayMatch[0];
  }

  try {
    const moments: ViralMoment[] = JSON.parse(jsonStr);

    if (!Array.isArray(moments) || moments.length === 0) {
      throw new Error('Gemini did not return any moments');
    }

    // Validate each moment
    const validMoments = moments.filter((m) => {
      return (
        typeof m.startTime === 'number' &&
        typeof m.endTime === 'number' &&
        typeof m.reason === 'string' &&
        m.startTime >= 0 &&
        m.endTime > m.startTime
      );
    });

    if (validMoments.length === 0) {
      throw new Error('No valid moments found in Gemini response');
    }

    // Limit to max 3 moments, ensure reasonable clip duration (30-90 seconds)
    const processedMoments = validMoments.slice(0, 3).map((m) => {
      let endTime = m.endTime;
      if (endTime - m.startTime > 90) {
        endTime = m.startTime + 90;
      }
      if (endTime - m.startTime < 30) {
        endTime = m.startTime + 30;
      }
      return { ...m, endTime };
    });

    onProgress(100);
    return processedMoments;
  } catch (parseErr) {
    console.error('[Analyzer] Failed to parse Gemini response:', text);
    throw new Error(
      `Failed to analyze transcript. Gemini returned unexpected format. Please try again with a different video.`,
    );
  }
}