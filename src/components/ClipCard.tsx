import { Download, FolderOpen, Clock, Timer, Brain, Target, Sparkles, BarChart3, FileText } from 'lucide-react';

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

interface ClipCardProps {
  clip: ClipData;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function ClipCard({ clip }: ClipCardProps) {
  const downloadUrl = `/api/clips/${clip.filename}`;

  const handleDownload = () => {
    window.location.href = downloadUrl;
  };

  const handleOpenFolder = async () => {
    try {
      const response = await fetch('/api/open-folder');
      if (!response.ok) {
        console.error('Failed to open folder');
      }
    } catch {
      console.error('Failed to open folder');
    }
  };

  return (
    <div
      className="group relative bg-muted border border-border rounded-2xl overflow-hidden transition-all duration-200 ease-out hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5"
    >
      {/* Video placeholder / gradient background */}
      <div className="aspect-[9/16] bg-gradient-to-br from-accent/10 via-background to-muted flex items-center justify-center">
        <div className="text-center p-4">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-accent/20 flex items-center justify-center">
            <Timer className="w-6 h-6 text-accent" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-foreground/70">Clip {clip.id}</p>
          <p className="text-xs text-foreground/40 mt-1">
            {formatTime(clip.startTime)} — {formatTime(clip.endTime)}
          </p>
        </div>
      </div>

      {/* Info bar */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Clip {clip.id}</h3>
          <span className="flex items-center gap-1 text-xs text-foreground/50">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {formatTime(clip.duration)}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-foreground/40">
          <Timer className="w-3 h-3" aria-hidden="true" />
          <span>
            {formatTime(clip.startTime)} — {formatTime(clip.endTime)}
          </span>
        </div>

        {/* Rich analysis metadata */}
        {clip.reason && (
          <div className="flex items-start gap-2 text-xs">
            <Brain className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0" aria-hidden="true" />
            <p className="text-foreground/60 leading-relaxed">{clip.reason}</p>
          </div>
        )}

        {clip.finalScore !== undefined && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
              <span className="text-xs text-foreground/50">Score</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-20 rounded-full bg-muted/80 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500"
                  style={{ width: `${Math.min(clip.finalScore * 10, 100)}%` }}
                />
              </div>
              <span className="text-xs font-medium text-foreground/70">{clip.finalScore.toFixed(1)}</span>
            </div>
          </div>
        )}

        {clip.contentType && (
          <div className="flex items-center gap-2 text-xs">
            <FileText className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
            <span className="text-foreground/50">Type:</span>
            <span className="font-medium text-foreground/70 capitalize">{clip.contentType}</span>
            {clip.confidence !== undefined && (
              <span className="text-foreground/40">
                ({(clip.confidence * 100).toFixed(0)}% confidence)
              </span>
            )}
          </div>
        )}

        {clip.narrativeStages && clip.narrativeStages.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-accent" aria-hidden="true" />
            {clip.narrativeStages.map((stage, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent/80"
              >
                {stage}
              </span>
            ))}
          </div>
        )}

        {clip.retentionScore && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
              <span className="text-xs font-medium text-foreground/60">Retention</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Hook (3s)', value: clip.retentionScore.hook3s },
                { label: 'Maintain (10s)', value: clip.retentionScore.maintain10s },
                { label: 'Payoff', value: clip.retentionScore.payoffFull },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <span className="block text-xs font-semibold text-foreground/70">
                    {(value * 100).toFixed(0)}%
                  </span>
                  <span className="block text-[10px] text-foreground/40 truncate">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <a
            href={downloadUrl}
            download
            onClick={(e) => {
              e.preventDefault();
              handleDownload();
            }}
            className={`
              flex-1 flex items-center justify-center gap-2
              py-2.5 px-4 rounded-lg text-sm font-medium
              bg-accent text-white
              transition-all duration-200 ease-out
              hover:opacity-90 active:scale-[0.97]
              focus:outline-none focus:ring-2 focus:ring-accent/40
              cursor-pointer
            `}
            aria-label={`Download clip ${clip.id}`}
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Download
          </a>

          <button
            onClick={handleOpenFolder}
            className={`
              flex items-center justify-center gap-2
              py-2.5 px-4 rounded-lg text-sm font-medium
              bg-muted border border-border text-foreground/70
              transition-all duration-200 ease-out
              hover:bg-muted/80 hover:text-foreground active:scale-[0.97]
              focus:outline-none focus:ring-2 focus:ring-primary/40
              cursor-pointer
            `}
            aria-label="Open output folder"
          >
            <FolderOpen className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}