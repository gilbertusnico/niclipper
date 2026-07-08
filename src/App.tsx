import { useState, useCallback } from 'react';
import { Scissors, AlertCircle } from 'lucide-react';
import UrlInput from './components/UrlInput';
import ProgressBar from './components/ProgressBar';
import ClipCard from './components/ClipCard';

interface ClipData {
  id: number;
  filename: string;
  duration: number;
  startTime: number;
  endTime: number;
}

type AppStage = '' | 'downloading' | 'transcribing' | 'analyzing' | 'cropping' | 'subtitles' | 'rendering' | 'done' | 'error';

export default function App() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStage, setCurrentStage] = useState<AppStage>('');
  const [progress, setProgress] = useState(0);
  const [clips, setClips] = useState<ClipData[]>([]);
  const [error, setError] = useState('');

  const handleGenerate = useCallback(async (url: string) => {
    // Reset state
    setIsProcessing(true);
    setCurrentStage('');
    setProgress(0);
    setClips([]);
    setError('');

    try {
      // Use direct server URL to avoid Vite proxy buffering SSE events
      const apiUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3001'
        : '';
      const response = await fetch(`${apiUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response stream available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep last incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const { stage, progress: prog, clips: newClips, message } = data;

              if (stage === 'error') {
                setError(message || 'An error occurred during processing');
                setCurrentStage('error');
                setIsProcessing(false);
                return;
              }

              if (stage === 'done') {
                setCurrentStage('done');
                setProgress(100);
                setClips(newClips || []);
                setIsProcessing(false);
                return;
              }

              setCurrentStage(stage);
              setProgress(prog || 0);
            } catch {
              // Skip malformed JSON events
            }
          }
        }
      }

      // Stream ended without a done event
      setIsProcessing(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(message);
      setCurrentStage('error');
      setIsProcessing(false);
    }
  }, []);

  const isDone = currentStage === 'done';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="pt-8 pb-4 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Scissors className="w-6 h-6 text-accent" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Niclipper
            </h1>
          </div>
          <p className="text-sm text-foreground/50">
            Paste a YouTube URL and get 3 AI-curated short clips with Indonesian subtitles
          </p>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 pb-12">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* URL Input */}
          <section className="pt-4">
            <UrlInput onSubmit={handleGenerate} isProcessing={isProcessing} />
          </section>

          {/* Progress Section */}
          {(isProcessing || isDone || currentStage === 'error') && (
            <section className="pt-2">
              <ProgressBar currentStage={currentStage} progress={progress} />
            </section>
          )}

          {/* Error Message */}
          {error && !isProcessing && (
            <div
              role="alert"
              className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive"
            >
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium text-sm">Something went wrong</p>
                <p className="text-sm text-destructive/80 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Clip Results */}
          {isDone && clips.length > 0 && (
            <section>
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold text-foreground">
                  Your Clips Are Ready
                </h2>
                <p className="text-sm text-foreground/50 mt-1">
                  {clips.length} clip{clips.length > 1 ? 's' : ''} generated from your video
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {clips.map((clip) => (
                  <ClipCard key={clip.id} clip={clip} />
                ))}
              </div>
            </section>
          )}

          {/* Empty State */}
          {!isProcessing && !isDone && !error && clips.length === 0 && (
            <section className="pt-8">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted border border-border flex items-center justify-center">
                  <Scissors className="w-7 h-7 text-foreground/30" aria-hidden="true" />
                </div>
                <h2 className="text-lg font-medium text-foreground/70">
                  Ready to clip
                </h2>
                <p className="text-sm text-foreground/40 mt-1 max-w-md mx-auto">
                  Paste a YouTube URL above and click "Generate Clips" to create 3 AI-curated short clips with Indonesian subtitles — perfect for TikTok, Reels, and Shorts.
                </p>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 px-4 text-center space-y-2">
        <p className="text-xs text-foreground/30">
          Niclipper — Local AI Video Clipper
        </p>
        <a
          href="/api/download-code"
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors duration-150"
          download
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Download Source Code
        </a>
      </footer>
    </div>
  );
}