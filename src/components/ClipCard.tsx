import { useState, useRef, useCallback, useEffect } from 'react';
import { Download, FolderOpen, Clock, Timer, Brain, Target, Sparkles, BarChart3, Play, Volume2, VolumeX, Pencil, Loader2, Check, X, FileText } from 'lucide-react';

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

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
  transcriptSegments?: TranscriptSegment[];
}

interface ClipCardProps {
  clip: ClipData;
  onRerender?: (transcript: string) => void;
  isProcessing?: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function ClipCard({ clip, onRerender, isProcessing }: ClipCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cache-busting: use startTime+endTime+id so browser re-fetches after re-render
  const downloadUrl = `/api/clips/${clip.filename}?v=${clip.startTime}-${clip.endTime}-${clip.id}`;
  const thumbnailUrl = `/api/clips/clip_${clip.id}.jpg`;

  const handleDownload = () => {
    window.location.href = downloadUrl;
  };

  const handleOpenFolder = async () => {
    try {
      await fetch('/api/open-folder');
    } catch {
      console.error('Failed to open folder');
    }
  };

  const openPreview = useCallback(() => {
    setPreviewOpen(true);
    setLoading(true);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    setMuted(true);
    setLoading(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewOpen) closePreview();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [previewOpen, closePreview]);

  // Close on outside click
  useEffect(() => {
    if (!previewOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePreview();
      }
    };
    const timeout = setTimeout(() => {
      document.addEventListener('click', handleClick);
    }, 100);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('click', handleClick);
    };
  }, [previewOpen, closePreview]);

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMuted(prev => !prev);
  };

  const hasTranscript = clip.transcriptSegments && clip.transcriptSegments.length > 0;

  const segmentCount = clip.transcriptSegments?.length ?? 0;

  const handleStartEdit = useCallback(() => {
    if (!clip.transcriptSegments) return;
    // Show timestamp prefix so user knows which segment they're editing
    setEditedText(
      clip.transcriptSegments
        .map(s => `${formatTime(s.start)} ${s.text}`)
        .join('\n')
    );
    setEditing(true);
  }, [clip.transcriptSegments]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setEditedText('');
  }, []);

  /**
   * Strip a leading MM:SS or M:SS timestamp prefix from a line.
   * e.g. "03:21 Hello world" → "Hello world"
   *      "3:21 Hello world"  → "Hello world"
   */
  function stripTimestampPrefix(line: string): string {
    return line.replace(/^\d{1,2}:\d{2}\s+/, '');
  }

  const handleSaveEdit = useCallback(() => {
    if (!onRerender || !clip.transcriptSegments || !editedText.trim()) return;
    setEditing(false);

    const lines = editedText.split('\n');
    const segments = clip.transcriptSegments;
    const rebuilt: string[] = [];
    const targetCount = segments.length;

    for (let i = 0; i < targetCount; i++) {
      const seg = segments[i];
      let text: string;

      if (i < lines.length) {
        text = stripTimestampPrefix(lines[i]).trim() || seg.text;
      } else {
        text = seg.text;
      }

      // Convert offset timestamps (0-based relative to clip start) back
      // to absolute timestamps matching the original video. The server's
      // cropClips uses these absolute timestamps to filter which segments
      // fall within each clip's time range.
      const absStart = seg.start + clip.startTime;
      const absEnd = seg.end + clip.startTime;
      rebuilt.push(
        `[TIMESTAMP: ${absStart.toFixed(1)} -> ${absEnd.toFixed(1)}]\n${text}`
      );
    }

    // Extra lines from user → merge into last segment so nothing is lost
    if (lines.length > targetCount) {
      const extra = lines.slice(targetCount).filter(l => l.trim()).join(' ');
      if (extra) {
        const lastIdx = rebuilt.length - 1;
        const lastSeg = segments[targetCount - 1];
        const mergedText = stripTimestampPrefix(lines[targetCount - 1]).trim() + ' ' + extra;
        const absStart = lastSeg.start + clip.startTime;
        const absEnd = lastSeg.end + clip.startTime;
        rebuilt[lastIdx] =
          `[TIMESTAMP: ${absStart.toFixed(1)} -> ${absEnd.toFixed(1)}]\n${mergedText}`;
      }
    }

    onRerender(rebuilt.join('\n\n'));
  }, [editedText, onRerender, clip.transcriptSegments]);

  return (
    <div
      ref={containerRef}
      className="group relative bg-muted border border-border rounded-2xl overflow-hidden transition-all duration-200 ease-out hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5"
    >
      {/* ── Video / Thumbnail Area ─────────────────────────────── */}
      <div className="relative aspect-[9/16] bg-gradient-to-br from-accent/10 via-background to-muted overflow-hidden">
        {previewOpen ? (
          <>
            <video
              ref={videoRef}
              src={downloadUrl}
              autoPlay
              muted={muted}
              playsInline
              controls
              className="absolute inset-0 w-full h-full object-cover"
              onLoadedData={() => setLoading(false)}
              onError={() => setLoading(false)}
            />
            {/* Mute toggle button */}
            <button
              onClick={toggleMute}
              className={`
                absolute top-3 right-3 z-10
                w-8 h-8 rounded-full
                bg-black/50 backdrop-blur-sm
                flex items-center justify-center
                text-white
                transition-all duration-150
                hover:bg-black/70
                cursor-pointer
                focus:outline-none focus:ring-2 focus:ring-white/40
              `}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            {/* Loading spinner */}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm z-20">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Thumbnail image */}
            {!thumbError ? (
              <img
                src={thumbnailUrl}
                alt={`Thumbnail for clip ${clip.id}`}
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setThumbError(true)}
                loading="lazy"
              />
            ) : (
              /* Fallback gradient when thumbnail unavailable */
              <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-background to-muted flex items-center justify-center">
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
            )}

            {/* Dark gradient overlay at bottom */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

            {/* Play button overlay */}
            <button
              onClick={openPreview}
              className={`
                absolute inset-0 z-10
                flex items-center justify-center
                cursor-pointer
                group/play
                transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent/40
              `}
              aria-label={`Preview clip ${clip.id}`}
            >
              <div className="
                w-16 h-16 rounded-full
                bg-accent/90 backdrop-blur-sm
                flex items-center justify-center
                transition-all duration-200 ease-out
                group-hover/play:scale-110 group-hover/play:bg-accent
                group-hover/play:shadow-[0_0_20px_rgba(124,58,237,0.5)]
                active:scale-95
              ">
                <Play className="w-7 h-7 text-white ml-0.5" aria-hidden="true" />
              </div>
            </button>

            {/* Time badge at bottom */}
            <div className="absolute bottom-3 left-3 z-10">
              <span className="px-2 py-1 rounded-md text-[10px] font-medium bg-black/50 backdrop-blur-sm text-white/90">
                {formatTime(clip.startTime)} — {formatTime(clip.endTime)}
              </span>
            </div>

            {/* Duration badge at bottom right */}
            <div className="absolute bottom-3 right-3 z-10">
              <span className="px-2 py-1 rounded-md text-[10px] font-medium bg-black/50 backdrop-blur-sm text-white/90 flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden="true" />
                {formatTime(clip.duration)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Info bar ────────────────────────────────────────────── */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground truncate">Clip {clip.id}</h3>
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

        {/* ── Transcript Editing ────────────────────────────── */}
        {hasTranscript && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground/50 flex items-center gap-1">
                <FileText className="w-3 h-3" aria-hidden="true" />
                Transcript ({segmentCount} segment{segmentCount !== 1 ? 's' : ''})
              </span>
              {!editing && (
                <button
                  onClick={handleStartEdit}
                  disabled={isProcessing}
                  className={`
                    flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                    transition-all duration-150 cursor-pointer
                    focus:outline-none focus:ring-2 focus:ring-accent/40
                    ${isProcessing
                      ? 'text-foreground/20 cursor-not-allowed'
                      : 'text-accent/70 hover:text-accent hover:bg-accent/10 active:scale-[0.97]'
                    }
                  `}
                  aria-label="Edit transcript"
                >
                  <Pencil className="w-3 h-3" aria-hidden="true" />
                  Edit
                </button>
              )}
            </div>

            {editing ? (
              <div className="space-y-2">
                <textarea
                  value={editedText}
                  onChange={e => setEditedText(e.target.value)}
                  rows={Math.min(segmentCount, 6)}
                  className={`
                    w-full px-3 py-2 rounded-lg text-xs leading-relaxed
                    bg-background border border-border
                    text-foreground
                    placeholder:text-foreground/30
                    resize-y
                    transition-all duration-150
                    focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50
                  `}
                  aria-label="Edit transcript text, one line per segment. Timestamps (MM:SS) are shown but will be stripped on save."
                  placeholder="Edit each line — timestamp (MM:SS) prefix is optional"
                  spellCheck
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={isProcessing}
                    className={`
                      flex items-center justify-center gap-1.5
                      flex-1 py-2 px-3 rounded-lg text-xs font-medium
                      transition-all duration-150
                      focus:outline-none focus:ring-2 focus:ring-accent/40
                      cursor-pointer
                      ${isProcessing
                        ? 'bg-accent/40 text-white/60 cursor-not-allowed'
                        : 'bg-accent text-white hover:opacity-90 active:scale-[0.97]'
                      }
                    `}
                    aria-label="Update subtitles with edited transcript"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {isProcessing ? 'Rerendering...' : 'Update Subtitles'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={isProcessing}
                    className={`
                      flex items-center justify-center gap-1.5
                      py-2 px-3 rounded-lg text-xs font-medium
                      border border-border text-foreground/60
                      transition-all duration-150
                      focus:outline-none focus:ring-2 focus:ring-primary/40
                      cursor-pointer
                      ${isProcessing
                        ? 'opacity-40 cursor-not-allowed'
                        : 'hover:bg-muted/80 hover:text-foreground active:scale-[0.97]'
                      }
                    `}
                    aria-label="Cancel editing transcript"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-foreground/50 leading-relaxed line-clamp-3">
                {clip.transcriptSegments!.map(s => s.text).join(' ')}
              </p>
            )}
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