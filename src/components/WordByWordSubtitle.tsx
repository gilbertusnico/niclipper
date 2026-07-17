import { useState, useEffect, useRef, useCallback } from 'react';

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface WordTiming {
  word: string;
  start: number;
  end: number;
}

interface WordByWordSubtitleProps {
  segments: TranscriptSegment[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

/**
 * TikTok-style word-by-word subtitle overlay.
 *
 * Behavior:
 * - Only shows the CURRENT subtitle segment at a time (not all segments at once)
 * - All words in the segment are visible
 * - Past words: white at 70% opacity
 * - Current word: yellow (#FFD700) with subtle glow, slightly larger font
 * - Future words: white at 40% opacity
 * - Positioned at 1/3 from bottom of video
 * - Bold white text with thick black stroke for readability on any background
 */
export default function WordByWordSubtitle({ segments, videoRef }: WordByWordSubtitleProps) {
  const [displayWords, setDisplayWords] = useState<WordTiming[]>([]);
  const [activeWordIdx, setActiveWordIdx] = useState(-1);

  // refs to avoid stale closures in RAF
  const wordsCacheRef = useRef<WordTiming[][]>([]);
  const activeSegmentRef = useRef(-1);
  const activeWordRef = useRef(-1);
  const rafRef = useRef(0);

  // Build per-segment word timings once (stable reference)
  useEffect(() => {
    const allWords: WordTiming[][] = [];
    for (const seg of segments) {
      const duration = seg.end - seg.start;
      if (duration <= 0) {
        allWords.push([]);
        continue;
      }
      // Split into words, preserving trailing spaces so text flows naturally
      const words = seg.text.match(/\S+\s*/g) || [seg.text];
      const wordDuration = duration / words.length;

      allWords.push(
        words.map((word, wi) => ({
          word,
          start: seg.start + wi * wordDuration,
          end: seg.start + (wi + 1) * wordDuration,
        })),
      );
    }
    wordsCacheRef.current = allWords;
  }, [segments]);

  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const ct = video.currentTime;
    const allWords = wordsCacheRef.current;

    // Find which segment the video is currently in
    let segIdx = -1;
    for (let i = 0; i < segments.length; i++) {
      if (ct >= segments[i].start && ct < segments[i].end) {
        segIdx = i;
        break;
      }
    }

    if (segIdx === -1) {
      // No active segment — clear display if we were showing something
      if (activeSegmentRef.current !== -1) {
        activeSegmentRef.current = -1;
        activeWordRef.current = -1;
        setDisplayWords([]);
        setActiveWordIdx(-1);
      }
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    // Update segment display only when segment changes
    const segWords = allWords[segIdx] || [];
    if (segIdx !== activeSegmentRef.current) {
      activeSegmentRef.current = segIdx;
      setDisplayWords(segWords);
    }

    // Find current word in segment (reverse search for efficiency)
    let wordIdx = -1;
    for (let i = segWords.length - 1; i >= 0; i--) {
      if (ct >= segWords[i].start && ct < segWords[i].end) {
        wordIdx = i;
        break;
      }
    }

    // Update active word only when it changes
    if (wordIdx !== activeWordRef.current) {
      activeWordRef.current = wordIdx;
      setActiveWordIdx(wordIdx);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [videoRef, segments]);

  // ── RAF lifecycle: start on play, stop on pause ──────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      rafRef.current = requestAnimationFrame(tick);
    };

    const handlePause = () => {
      cancelAnimationFrame(rafRef.current);
    };

    const handleSeeked = () => {
      if (!video.paused) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeked', handleSeeked);

    return () => {
      cancelAnimationFrame(rafRef.current);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [videoRef, tick]);

  // Nothing to render
  if (displayWords.length === 0) return null;

  return (
    <div
      className="absolute left-0 right-0 pointer-events-none z-30 select-none text-center"
      style={{
        // Position at 1/3 from bottom of the video container — matches TikTok style
        bottom: '33%',
        padding: '0 12px',
      }}
      aria-live="polite"
      aria-label="Subtitles"
    >
      <div className="inline-flex flex-wrap justify-center gap-x-0 gap-y-0.5 leading-snug">
        {displayWords.map((wt, i) => {
          const isActive = i === activeWordIdx;
          const isPast = i < activeWordIdx;

          return (
            <span
              key={i}
              className={`
                inline-block transition-all duration-150 ease-out
                text-[15px] sm:text-[17px] md:text-[19px]
                font-bold leading-snug
                px-[1px]
                ${isActive
                  ? 'text-[#FFD700] scale-110 drop-shadow-[0_0_6px_rgba(255,215,0,0.5)]'
                  : isPast
                    ? 'text-white/70'
                    : 'text-white/40'
                }
              `}
              style={{
                // Thick black stroke for readability on any video background
                textShadow: isActive
                  ? '2px 2px 0 rgba(0,0,0,0.95), -1px -1px 0 rgba(0,0,0,0.95), 1px -1px 0 rgba(0,0,0,0.95), -1px 1px 0 rgba(0,0,0,0.95)'
                  : '2px 2px 0 rgba(0,0,0,0.85), -1px -1px 0 rgba(0,0,0,0.85), 1px -1px 0 rgba(0,0,0,0.85), -1px 1px 0 rgba(0,0,0,0.85)',
              }}
            >
              {wt.word}
            </span>
          );
        })}
      </div>
    </div>
  );
}