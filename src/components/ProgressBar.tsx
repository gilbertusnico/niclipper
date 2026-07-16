import { Check, Loader2 } from 'lucide-react';

interface ProgressBarProps {
  currentStage: string;
  progress: number;
  detail?: string;
}

interface StageInfo {
  key: string;
  label: string;
}

const STAGES: StageInfo[] = [
  { key: 'downloading', label: 'Downloading' },
  { key: 'transcribing', label: 'Transcribing' },
  { key: 'analyzing', label: 'Analyzing' },
  { key: 'cropping', label: 'Cropping' },
  { key: 'rendering', label: 'Rendering' },
  { key: 'done', label: 'Done' },
];

export default function ProgressBar({ currentStage, progress, detail }: ProgressBarProps) {
  const currentIndex = STAGES.findIndex((s) => s.key === currentStage);

  return (
    <div className="w-full max-w-2xl mx-auto" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Video processing progress">
      {/* Progress percentage bar */}
      <div className="relative h-2 bg-muted rounded-full overflow-hidden mb-6">
        <div
          className="absolute inset-y-0 left-0 bg-accent rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {/* Stage labels */}
      <div className="grid grid-cols-6 gap-1">
        {STAGES.map((stage, index) => {
          const isCompleted = index < currentIndex || (currentStage === 'error' && index < currentIndex);
          const isCurrent = index === currentIndex && currentStage !== 'error' && currentStage !== 'done';
          const isPending = index > currentIndex || currentStage === '';
          const isDone = currentStage === 'done' && stage.key === 'done';
          const isError = currentStage === 'error' && index === currentIndex;

          return (
            <div
              key={stage.key}
              className={`
                flex flex-col items-center gap-2 transition-all duration-300
                ${isCompleted || isDone ? 'opacity-100' : ''}
                ${isPending ? 'opacity-30' : ''}
                ${isCurrent ? 'opacity-100' : ''}
              `}
            >
              {/* Stage icon */}
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center
                  transition-all duration-300 ease-out
                  ${isCompleted || isDone
                    ? 'bg-accent text-white'
                    : isCurrent
                      ? 'bg-accent/20 text-accent border-2 border-accent'
                      : isError
                        ? 'bg-destructive/20 text-destructive border-2 border-destructive'
                        : 'bg-muted text-foreground/30'
                  }
                `}
              >
                {isCompleted || isDone ? (
                  <Check className="w-4 h-4" aria-hidden="true" />
                ) : isCurrent ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-current" />
                )}
              </div>

              {/* Stage label */}
              <span
                className={`
                  text-[10px] leading-tight text-center font-medium
                  transition-colors duration-200
                  ${isCompleted || isDone ? 'text-accent' : ''}
                  ${isCurrent ? 'text-foreground' : ''}
                  ${isPending ? 'text-foreground/30' : ''}
                `}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress text & detail */}
      <div className="text-center mt-4 space-y-1">
        <p className="text-sm text-foreground/50">
          {currentStage === 'done' ? (
            'All clips generated!'
          ) : currentStage === 'error' ? (
            <span className="text-destructive">An error occurred</span>
          ) : currentStage ? (
            <>
              {STAGES.find((s) => s.key === currentStage)?.label || 'Processing'}... {Math.round(progress)}%
            </>
          ) : null}
        </p>

        {/* Detail message — shows model download progress, etc. */}
        {detail && currentStage !== 'done' && currentStage !== 'error' && (
          <p className="text-xs text-foreground/40 font-mono animate-pulse">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}