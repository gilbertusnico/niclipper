import type { ViralMoment } from './types.js';

export type AnalyzeProgressCallback = (progress: number) => void;

/**
 * Indonesian viral/emotional keywords for scoring transcript segments.
 * Words that indicate high engagement potential.
 */
const VIRAL_KEYWORDS: [string, number][] = [
  // High-impact emotional words
  ['mengejutkan', 10],
  ['luar biasa', 10],
  ['tidak pernah', 9],
  ['gila', 8],
  ['astaga', 9],
  ['wow', 8],
  ['keren', 7],
  ['bahaya', 8],
  ['penting', 7],
  ['pertama', 6],
  ['unik', 7],
  ['aneh', 7],
  ['fantastis', 10],
  ['terbaik', 8],
  ['terburuk', 8],
  ['terbesar', 8],
  ['terkecil', 7],
  ['tercepat', 7],
  ['tertinggi', 7],
  ['terendah', 6],
  ['paling', 6],
  ['sangat', 5],
  ['sekali', 5],
  ['benar-benar', 6],
  ['sungguh', 6],
  ['amaaazing', 9],
  ['brilian', 8],
  ['sempurna', 7],
  ['mengerikan', 8],
  ['menggemaskan', 8],
  ['kocak', 7],
  ['lucu', 6],
  ['ngakak', 7],
  // Comparison & superlatives
  ['lebih dari', 5],
  ['kurang dari', 4],
  ['setara', 3],
  // Questions & call-to-action
  ['tahu nggak', 7],
  ['tahu tidak', 7],
  ['percaya nggak', 8],
  ['percaya tidak', 8],
  ['bayangkan', 7],
  ['coba lihat', 6],
  // Time-sensitive words
  ['baru saja', 5],
  ['tadi malam', 4],
  ['hari ini', 4],
  ['mendadak', 7],
  ['tiba-tiba', 6],
  // Certainty/emphasis
  ['pasti', 5],
  ['harus', 4],
  ['wajib', 5],
  ['jangan sampai', 6],
  ['jangan lewatkan', 8],
  // Numbers & statistics
  ['juta', 5],
  ['miliar', 6],
  ['triliun', 7],
  ['persen', 5],
  ['angka', 3],
  // Indonesian slang / casual
  ['sih', 2],
  ['dong', 2],
  ['deh', 2],
  ['banget', 4],
  ['bgt', 3],
  ['anjay', 6],
  ['wkwk', 4],
  ['wkwkwk', 5],
  ['hahaha', 4],
  ['haha', 3],
];

/**
 * Low-energy / filler words that indicate a segment is NOT viral.
 */
const FILLER_KEYWORDS: [string, number][] = [
  ['pertama-tama', 3],
  ['selamat datang', 2],
  ['terima kasih', 2],
  ['sampai jumpa', 2],
  ['jangan lupa subscribe', 1],
  ['like dan subscribe', 1],
  ['assalamualaikum', 2],
  ['hai halo', 2],
  ['oke kali ini', 2],
  ['kali ini kita', 2],
  ['sebelum kita mulai', 3],
  ['di video kali ini', 2],
];

/**
 * Analyze transcript to find the most engaging/viral moments.
 * Fully local — no API key, no rate limits, no cost.
 * Uses smart heuristics and keyword scoring tailored for Indonesian language.
 *
 * @param transcript - The full video transcript with timestamp markers
 * @param onProgress - Callback for analysis progress (0-100)
 * @returns Array of viral moments with timestamps and reasons
 */
export async function analyzeTranscript(
  transcript: string,
  onProgress: AnalyzeProgressCallback,
): Promise<ViralMoment[]> {
  onProgress(10);

  // Step 1: Parse the transcript into timestamped segments
  const segments = parseTranscript(transcript);
  onProgress(30);

  if (segments.length === 0) {
    throw new Error(
      'Cannot analyze transcript: no timestamped segments found. ' +
      'The transcript format may be unsupported. Try a different video.',
    );
  }

  // Step 2: Score each segment
  const scoredSegments = segments.map((seg) => ({
    ...seg,
    score: scoreSegment(seg.text),
  }));
  onProgress(60);

  // Step 3: Sort by score descending
  scoredSegments.sort((a, b) => b.score - a.score);
  onProgress(80);

  // Step 4: Pick top 3 non-overlapping segments, ensuring 30-90s duration
  const selected = selectTopSegments(scoredSegments, 3);
  onProgress(90);

  // Step 5: Assign reasons based on what made the segment score high
  const moments: ViralMoment[] = selected.map((seg, i) => {
    const reason = generateReason(seg, i + 1);
    return {
      startTime: Math.round(seg.start * 10) / 10,
      endTime: Math.round(seg.end * 10) / 10,
      reason,
    };
  });
  onProgress(100);

  return moments;
}

interface TimestampedSegment {
  start: number;
  end: number;
  text: string;
  score: number;
}

/**
 * Parse transcript text with [TIMESTAMP: X -> Y] markers into segments.
 */
function parseTranscript(transcript: string): Omit<TimestampedSegment, 'score'>[] {
  const segments: Omit<TimestampedSegment, 'score'>[] = [];
  const lines = transcript.split('\n');

  let currentStart = 0;
  let currentEnd = 0;
  let currentText: string[] = [];

  for (const line of lines) {
    const timestampMatch = line.match(/\[TIMESTAMP:\s*([\d.]+)\s*->\s*([\d.]+)\]/i);
    if (timestampMatch) {
      // Flush previous segment
      if (currentText.length > 0) {
        segments.push({
          start: currentStart,
          end: currentEnd,
          text: currentText.join(' ').trim(),
        });
      }
      currentStart = parseFloat(timestampMatch[1]);
      currentEnd = parseFloat(timestampMatch[2]);
      // Skip segments with 0 duration (bad timestamps from Whisper)
      if (currentEnd <= currentStart) {
        currentEnd = currentStart + 5; // default to 5s minimum
      }
      currentText = [];
    } else {
      const text = line.trim();
      if (text) {
        currentText.push(text);
      }
    }
  }

  // Flush last segment
  if (currentText.length > 0) {
    segments.push({
      start: currentStart,
      end: currentEnd,
      text: currentText.join(' ').trim(),
    });
  }

  return segments;
}

/**
 * Score a text segment for viral potential (0-100).
 */
function scoreSegment(text: string): number {
  if (!text || text.length < 10) return 0;

  const lower = text.toLowerCase();
  let score = 0;

  // 1. Viral keyword score (max 50)
  let keywordScore = 0;
  for (const [word, weight] of VIRAL_KEYWORDS) {
    if (lower.includes(word)) {
      keywordScore += weight;
    }
  }
  score += Math.min(keywordScore, 50);

  // 2. Filler/boring keyword penalty (max -20)
  let fillerPenalty = 0;
  for (const [word, weight] of FILLER_KEYWORDS) {
    if (lower.includes(word)) {
      fillerPenalty += weight;
    }
  }
  score -= Math.min(fillerPenalty, 20);

  // 3. Punctuation score (max 15)
  const exclamationCount = (text.match(/!/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;
  const ellipsisCount = (text.match(/\.\.\./g) || []).length;
  score += Math.min(exclamationCount * 5, 10);
  score += Math.min(questionCount * 4, 8);
  score += Math.min(ellipsisCount * 3, 5);

  // 4. Drama score — repetition, emphasis (max 10)
  // Check for repeated words (e.g. "sangat sangat", "benar benar")
  const repeatedWords = lower.match(/\b(\w+)\s+\1\b/g);
  if (repeatedWords) {
    score += Math.min(repeatedWords.length * 3, 5);
  }

  // Check for all-caps words (shouting/emphasis)
  const allCapsWords = text.match(/\b[A-Z]{3,}\b/g);
  if (allCapsWords) {
    score += Math.min(allCapsWords.length * 2, 5);
  }

  // 5. Length bonus (max 5)
  // Segments that are long enough to have substance but not too long
  const wordCount = text.split(/\s+/).length;
  if (wordCount >= 15 && wordCount <= 80) {
    score += 5;
  } else if (wordCount > 80 && wordCount <= 150) {
    score += 3;
  }

  // 6. Short/punchy segment bonus (max 5)
  if (wordCount >= 5 && wordCount <= 15) {
    // Short punchy segments can be very engaging
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Select top N non-overlapping segments from scored segments.
 * Prefers higher-scoring segments and ensures they don't overlap too much.
 */
function selectTopSegments(
  segments: TimestampedSegment[],
  count: number,
): TimestampedSegment[] {
  const selected: TimestampedSegment[] = [];
  const MIN_GAP = 5; // minimum 5 seconds gap between selected segments

  for (const seg of segments) {
    if (selected.length >= count) break;

    // Check overlap with already selected
    const overlaps = selected.some(
      (s) => Math.abs(seg.start - s.start) < MIN_GAP || Math.abs(seg.end - s.end) < MIN_GAP,
    );

    if (!overlaps) {
      // Ensure minimum 30s and maximum 90s duration
      const duration = seg.end - seg.start;
      if (duration >= 30 || duration >= 20) {
        // Accept 20s+ for short-form content
        const adjustedEnd = Math.min(seg.end, seg.start + 90);
        selected.push({
          ...seg,
          end: adjustedEnd,
        });
      }
    }
  }

  // If we couldn't find enough non-overlapping segments, relax constraints
  if (selected.length < count) {
    for (const seg of segments) {
      if (selected.length >= count) break;
      const alreadySelected = selected.some((s) => s.start === seg.start);
      const duration = seg.end - seg.start;
      if (!alreadySelected && duration >= 5) {
        selected.push(seg);
      }
    }
  }

  return selected.slice(0, count);
}

/**
 * Generate a human-readable reason for why a segment was selected as viral.
 */
function generateReason(seg: TimestampedSegment, index: number): string {
  const lower = seg.text.toLowerCase();

  // Check for specific high-scoring keywords
  if (lower.includes('mengejutkan') || lower.includes('gila') || lower.includes('astaga')) {
    return `Momen mengejutkan dengan intensitas emosi tinggi — cocok untuk hook`;
  }
  if (lower.includes('luar biasa') || lower.includes('fantastis') || lower.includes('brilian')) {
    return `Momen puncak dengan energi positif tinggi — engagement kuat`;
  }
  if (lower.includes('tidak pernah') || lower.includes('pertama') || lower.includes('baru saja')) {
    return `Momen eksklusif atau pertama kali — memicu rasa penasaran`;
  }
  if (lower.includes('bahaya') || lower.includes('mengerikan') || lower.includes('terburuk')) {
    return `Momen dramatis dengan ketegangan tinggi — membuat penonton terus menonton`;
  }
  if (lower.includes('wow') || lower.includes('keren') || lower.includes('lucu') || lower.includes('kocak')) {
    return `Momen menghibur dengan reaksi alami — potensi share tinggi`;
  }
  if (seg.text.includes('!') || seg.text.includes('?')) {
    return `Momen interaktif dengan pertanyaan atau seruan — engagement tinggi`;
  }
  if (seg.score >= 30) {
    return `Momen paling engaging dengan potensi viral tertinggi`;
  }

  return `Momen menarik dengan durasi optimal untuk short clip`;
}