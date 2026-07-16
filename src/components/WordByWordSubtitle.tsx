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
  segmentIndex: number;
}

interface WordByWordSubtitleProps {
  segments: TranscriptSegment[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

/**
 * TikTok-style word-by-word subtitle overlay.
 * Renders words one at a time, synced to the video's currentTime.
 * Current word is highlighted in a contrasting color.
 * Positioned at 1/3 from bottom of the video.
 */
export default function WordByWordSubtitle({ segments, videoRef }: WordByWordSubtitleProps) {
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const wordsRef = useRef<WordTiming[]>([]);
  const rafRef = useRef<number>(0);

  // Build word timing array from segments — stable across renders
  useEffect(() => {
    const wordTimings: WordTiming[] = [];
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      const duration = seg.end - seg.start;
      if (duration <= 0) continue;

      // Split text into words, preserving punctuation
      const words = seg.text.match(/\S+\s*/g) || [seg.text];
      const wordDuration = duration / words.length;

      for (let wi = 0; wi < words.length; wi++) {
        wordTimings.push({
          word: words[wi],
          start: seg.start + wi * wordDuration,
          end: seg.start + (wi + 1) * wordDuration,
          segmentIndex: si,
        });
      }
    }
    wordsRef.current = wordTimings;
  }, [segments]);

  // Sync with video currentTime using requestAnimationFrame
  const syncWithVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused || video.ended) {
      rafRef.current = requestAnimationFrame(syncWithVideo);
      return;
    }

    const currentTime = video.currentTime;
    const wordTimings = wordsRef.current;
    let found = false;

    // Binary search would be faster but linear is fine for typical subtitle lengths
    for (let i = wordTimings.length - 1; i >= 0; i--) {
      const wt = wordTimings[i];
      if (currentTime >= wt.start && currentTime < wt.end) {
        setActiveWordIndex(i);
        found = true;
        break;
      }
    }

    if (!found) {
      setActiveWordIndex(-1);
    }

    rafRef.current = requestAnimationFrame(syncWithVideo);
  }, [videoRef]);

  // Start/stop the sync loop when video plays/pauses
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      rafRef.current = requestAnimationFrame(syncWithVideo);
    };

    const handlePause = () => {
      cancelAnimationFrame(rafRef.current);
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    const handleSeeked = () => {
      // Force a sync on seek
      if (!video.paused) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(syncWithVideo);
      }
    };

    video.addEventListener('seeked', handleSeeked);

    return () => {
      cancelAnimationFrame(rafRef.current);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [videoRef, syncWithVideo]);

  if (segments.length === 0) return null;

  const wordTimings = wordsRef.current;
  if (wordTimings.length === 0) return null;

  return (
    <div
      className="absolute left-0 right-0 pointer-events-none z-30 select-none"
      style={{
        // Position at 1/3 from bottom of the video container
        bottom: '33%',
        padding: '0 16px',
      }}
      aria-live="polite"
      aria-label="Subtitles"
    >
      <div className="flex flex-wrap justify-center gap-x-0 gap-y-0.5 text-center">
        {wordTimings.map((wt, i) => {
          const isActive = i === activeWordIndex;
          const isPast = i < activeWordIndex;

          return (
            <span
              key={i}
              className={`
                inline-block transition-all duration-150 ease-out
                text-[22px] sm:text-[26px] md:text-[28px]
                font-bold leading-tight
                px-[1px]
                ${isActive
                  ? 'text-yellow-300 scale-110 drop-shadow-[0_0_8px_rgba(253,224,71,0.6)]'
                  : isPast
                    ? 'text-white/90'
                    : 'text-white/40'
                }
              `}
              style={{
                textShadow: isActive
                  ? '2px 2px 0 rgba(0,0,0,0.9), -1px -1px 0 rgba(0,0,0,0.9), 1px -1px 0 rgba(0,0,0,0.9), -1px 1px 0 rgba(0,0,0,0.9)'
                  : '2px 2px 0 rgba(0,0,0,0.8), -1px -1px 0 rgba(0,0,0,0.8), 1px -1px 0 rgba(0,0,0,0.8), -1px 1px 0 rgba(0,0,0,0.8)',
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