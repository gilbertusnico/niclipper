import { useEffect, useRef, useState } from 'react';

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

interface WordByWordSubtitleProps {
  segments: TranscriptSegment[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export default function WordByWordSubtitle({ segments, videoRef }: WordByWordSubtitleProps) {
  const [currentText, setCurrentText] = useState<string | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !segments || segments.length === 0) {
      setCurrentText(null);
      return;
    }

    function tick() {
      if (video.paused || video.ended) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      const time = video.currentTime;
      const active = segments.find((s) => time >= s.start && time < s.end);
      setCurrentText(active ? active.text : null);

      animRef.current = requestAnimationFrame(tick);
    }

    // Kick off on first play
    const onPlay = () => {
      animRef.current = requestAnimationFrame(tick);
    };

    const onPause = () => {
      // Keep showing the current subtitle while paused
      if (video.currentTime !== undefined) {
        const time = video.currentTime;
        const active = segments.find((s) => time >= s.start && time < s.end);
        setCurrentText(active ? active.text : null);
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', () => {
      const time = video.currentTime;
      const active = segments.find((s) => time >= s.start && time < s.end);
      setCurrentText(active ? active.text : null);
    });

    return () => {
      cancelAnimationFrame(animRef.current);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [segments, videoRef]);

  if (!currentText) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
      style={{ top: '55%' }}>
      <span
        className="inline-block max-w-[85%] text-center text-lg leading-relaxed text-white select-none"
        style={{
          textShadow:
            '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 4px rgba(0,0,0,0.8)',
        }}
      >
        {currentText}
      </span>
    </div>
  );
}
