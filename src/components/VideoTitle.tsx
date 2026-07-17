import { useEffect, useRef, useState } from 'react';

interface VideoTitleProps {
  title: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export default function VideoTitle({ title, videoRef }: VideoTitleProps) {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !title) {
      setVisible(false);
      return;
    }

    function tick() {
      if (video.paused || video.ended) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      const time = video.currentTime;

      if (time >= 0 && time < 3.5) {
        setVisible(true);
        setFading(false);
      } else if (time >= 3.5 && time < 4) {
        // Start fading during the last 0.5s
        setVisible(true);
        setFading(true);
      } else if (time >= 4) {
        setVisible(false);
        setFading(false);
      }

      animRef.current = requestAnimationFrame(tick);
    }

    const onPlay = () => {
      animRef.current = requestAnimationFrame(tick);
    };

    const onPause = () => {
      // Keep whatever state it was at
      if (video.currentTime !== undefined) {
        const time = video.currentTime;
        if (time >= 0 && time < 3.5) {
          setVisible(true);
          setFading(false);
        } else if (time >= 3.5 && time < 4) {
          setVisible(true);
          setFading(true);
        } else {
          setVisible(false);
          setFading(false);
        }
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', () => {
      const time = video.currentTime;
      if (time >= 0 && time < 3.5) {
        setVisible(true);
        setFading(false);
      } else if (time >= 3.5 && time < 4) {
        setVisible(true);
        setFading(true);
      } else {
        setVisible(false);
        setFading(false);
      }
    });

    return () => {
      cancelAnimationFrame(animRef.current);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [title, videoRef]);

  if (!visible || !title) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex justify-center"
      style={{ top: '15%' }}>
      <span
        className={`
          block w-[80%] px-6 py-3 rounded-lg
          bg-white text-black
          font-bold uppercase
          text-xl tracking-wide text-center
          select-none
          transition-opacity duration-500 ease-out
          ${fading ? 'opacity-0' : 'opacity-100'}
        `}
      >
        {title}
      </span>
    </div>
  );
}