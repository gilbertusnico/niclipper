import { useState } from 'react';
import { Loader2 } from 'lucide-react';

interface UrlInputProps {
  onSubmit: (url: string) => void;
  isProcessing: boolean;
}

const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;

export default function UrlInput({ onSubmit, isProcessing }: UrlInputProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const trimmed = url.trim();

    if (!trimmed) {
      setError('Please enter a YouTube URL');
      return;
    }

    if (!YOUTUBE_REGEX.test(trimmed)) {
      setError('Please enter a valid YouTube URL (e.g. https://youtube.com/watch?v=...)');
      return;
    }

    setError('');
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isProcessing) {
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <label htmlFor="youtube-url" className="sr-only">
            YouTube URL
          </label>
          <input
            id="youtube-url"
            type="url"
            placeholder="Paste YouTube URL here..."
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={handleKeyDown}
            disabled={isProcessing}
            aria-describedby={error ? 'url-error' : undefined}
            aria-invalid={!!error}
            className={`
              w-full px-4 py-3.5 rounded-xl
              bg-muted border
              text-foreground placeholder:text-foreground/30
              text-base font-normal
              outline-none
              transition-all duration-200 ease-out
              ${error
                ? 'border-destructive/60 focus:border-destructive focus:ring-2 focus:ring-destructive/20'
                : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/20'
              }
              ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          />
          {error && (
            <p id="url-error" role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={isProcessing}
          className={`
            px-6 py-3.5 rounded-xl font-semibold text-base
            bg-accent text-white
            transition-all duration-200 ease-out
            ${isProcessing
              ? 'opacity-60 cursor-not-allowed'
              : 'hover:opacity-90 active:scale-[0.97] hover:shadow-lg hover:shadow-accent/20'
            }
            focus:outline-none focus:ring-2 focus:ring-accent/40
            cursor-pointer
            flex items-center justify-center gap-2
            min-w-[140px]
          `}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              <span>Processing</span>
            </>
          ) : (
            <span>Generate Clips</span>
          )}
        </button>
      </div>
    </div>
  );
}