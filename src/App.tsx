import { useState, useCallback, useRef } from 'react';
import { Scissors, AlertCircle, Wand2, Clock } from 'lucide-react';
import UrlInput from './components/UrlInput';
import TimeRangeInput from './components/TimeRangeInput';
import ProgressBar from './components/ProgressBar';
import ClipCard from './components/ClipCard';

interface ClipData {
  id: number;
  filename: string;
  duration: number;
  startTime: number;
  endTime: number;
  reason?: string;
  finalScore?: number;
  retentionScore?: {
    hook3s: number;
    maintain10s: number;
    payoffFull: number;
    overall: number;
  };
  narrativeStages?: string[];
  contentType?: string;
  confidence?: number;
}

type AppStage = '' | 'downloading' | 'transcribing' | 'analyzing' | 'cropping' | 'rendering' | 'done' | 'error';

type CropMode = 'ai' | 'manual';

export default function App() {
  const [mode, setMode] = useState<CropMode>('ai');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStage, setCurrentStage] = useState<AppStage>('');
  const [progress, setProgress] = useState(0);
  const [clips, setClips] = useState<ClipData[]>([]);
  const [error, setError] = useState('');

  const resetState = useCallback(() => {
    setIsProcessing(true);
    setCurrentStage('');
    setProgress(0);
    setClips([]);
    setError('');
  }, []);

  const handleGenerate = useCallback((url: string) => {
    resetState();

    const terminalRef = { current: false };
    const encodedUrl = encodeURIComponent(url.trim());
    const eventSource = new EventSource(`/api/generate?url=${encodedUrl}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { stage, progress: prog, clips: newClips, message } = data;

        if (stage === 'error') {
          terminalRef.current = true;
          setError(message || 'An error occurred during processing');
          setCurrentStage('error');
          setIsProcessing(false);
          eventSource.close();
          return;
        }

        if (stage === 'done') {
          terminalRef.current = true;
          setCurrentStage('done');
          setProgress(100);
          setClips(newClips || []);
          setIsProcessing(false);
          eventSource.close();
          return;
        }

        setCurrentStage(stage);
        setProgress(prog || 0);
      } catch {
        // Skip malformed JSON events
      }
    };

    eventSource.onerror = () => {
      if (terminalRef.current) return;
      setError('Connection lost. Please try again.');
      setCurrentStage('error');
      setIsProcessing(false);
      eventSource.close();
    };
  }, [resetState]);

  const handleManualCrop = useCallback((url: string, ranges: { start: number; end: number }[]) => {
    resetState();

    const terminalRef = { current: false };
    const encodedUrl = encodeURIComponent(url.trim());
    const encodedRanges = encodeURIComponent(JSON.stringify(ranges));
    const eventSource = new EventSource(`/api/crop-manual?url=${encodedUrl}&ranges=${encodedRanges}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { stage, progress: prog, clips: newClips, message } = data;

        if (stage === 'error') {
          terminalRef.current = true;
          setError(message || 'An error occurred during processing');
          setCurrentStage('error');
          setIsProcessing(false);
          eventSource.close();
          return;
        }

        if (stage === 'done') {
          terminalRef.current = true;
          setCurrentStage('done');
          setProgress(100);
          setClips(newClips || []);
          setIsProcessing(false);
          eventSource.close();
          return;
        }

        setCurrentStage(stage);
        setProgress(prog || 0);
      } catch {
        // Skip malformed JSON events
      }
    };

    eventSource.onerror = () => {
      if (terminalRef.current) return;
      setError('Connection lost. Please try again.');
      setCurrentStage('error');
      setIsProcessing(false);
      eventSource.close();
    };
  }, [resetState]);

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

          {/* Mode Tabs */}
          <div className="mt-4 mx-auto max-w-xs">
            <div className="flex bg-muted border border-border rounded-xl p-1" role="tablist" aria-label="Crop mode">
              <button
                role="tab"
                aria-selected={mode === 'ai'}
                onClick={() => { if (!isProcessing) setMode('ai'); }}
                disabled={isProcessing}
                className={`
                  flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                  transition-all duration-200 cursor-pointer
                  ${mode === 'ai'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-foreground/40 hover:text-foreground/70'
                  }
                  ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <Wand2 className="w-4 h-4" aria-hidden="true" />
                <span>AI Generate</span>
              </button>
              <button
                role="tab"
                aria-selected={mode === 'manual'}
                onClick={() => { if (!isProcessing) setMode('manual'); }}
                disabled={isProcessing}
                className={`
                  flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                  transition-all duration-200 cursor-pointer
                  ${mode === 'manual'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-foreground/40 hover:text-foreground/70'
                  }
                  ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <Clock className="w-4 h-4" aria-hidden="true" />
                <span>Manual Crop</span>
              </button>
            </div>
          </div>

          <p className="text-sm text-foreground/50 mt-3">
            {mode === 'ai'
              ? 'Paste a YouTube URL and get 3 AI-curated short clips'
              : 'Paste a YouTube URL and choose your own time ranges to crop'
            }
          </p>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 pb-12">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* URL Input / Time Range Input */}
          <section className="pt-4">
            {mode === 'ai' ? (
              <UrlInput onSubmit={handleGenerate} isProcessing={isProcessing} />
            ) : (
              <TimeRangeInput onSubmit={handleManualCrop} isProcessing={isProcessing} />
            )}
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
                  {mode === 'ai'
                    ? 'Paste a YouTube URL above and click "Generate Clips" to create 3 AI-curated short clips — perfect for TikTok, Reels, and Shorts.'
                    : 'Paste a YouTube URL above, set your desired start and end times, and crop exactly the moments you want.'
                  }
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