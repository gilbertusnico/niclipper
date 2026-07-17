import { useState } from 'react';
import { Loader2, Clock, Plus, Trash2, FileVideo, FileText, ChevronDown } from 'lucide-react';
import type { SubtitleMode } from './SubtitleSelector';

interface TimeRange {
  id: number;
  label: string;
  title: string;
  startMin: string;
  startSec: string;
  endMin: string;
  endSec: string;
}

interface TimeRangeInputProps {
  onSubmit: (url: string, ranges: { start: number; end: number; title?: string }[], transcript?: string) => void;
  isProcessing: boolean;
  hideUrlInput?: boolean;
  fileLabel?: string;
  subtitleMode?: SubtitleMode;
}

const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;

function createEmptyRange(id: number, label: string): TimeRange {
  return { id, label, title: '', startMin: '', startSec: '', endMin: '', endSec: '' };
}

function toSeconds(min: string, sec: string): number | null {
  const m = parseInt(min, 10);
  const s = parseInt(sec, 10);
  if (isNaN(m) || isNaN(s) || m < 0 || s < 0 || s > 59) return null;
  return m * 60 + s;
}

function formatTimeDisplay(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Convert user's per-line "MM:SS text" into server's "[TIMESTAMP: X -> Y]\ntext" format.
 * End time = next segment start - 0.1s, or +3s for the last segment.
 */
function convertToServerFormat(userText: string): string {
  const lines = userText.split('\n');
  const segments: { start: number; text: string }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
    if (!match) continue;
    const start = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    segments.push({ start, text: match[3].trim() });
  }

  if (segments.length === 0) return '';

  segments.sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const end = i < segments.length - 1
      ? Math.max(segments[i + 1].start - 0.1, segments[i].start + 0.5)
      : segments[i].start + 3;
    parts.push(`[TIMESTAMP: ${segments[i].start} -> ${end}]`);
    parts.push(segments[i].text);
    if (i < segments.length - 1) parts.push('');
  }

  return parts.join('\n');
}

const DEFAULT_RANGES: TimeRange[] = [
  createEmptyRange(1, 'Clip 1'),
  createEmptyRange(2, 'Clip 2'),
  createEmptyRange(3, 'Clip 3'),
];

export default function TimeRangeInput({ onSubmit, isProcessing, hideUrlInput, fileLabel, subtitleMode = 'auto' }: TimeRangeInputProps) {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [ranges, setRanges] = useState<TimeRange[]>(DEFAULT_RANGES);
  const [rangeErrors, setRangeErrors] = useState<string[]>([]);

  // Transcript state per range
  const [transcripts, setTranscripts] = useState<Record<number, string>>({});
  const [expandedTranscripts, setExpandedTranscripts] = useState<Record<number, boolean>>({});
  const [transcriptErrors, setTranscriptErrors] = useState<Record<number, string>>({});

  const updateRange = (id: number, field: keyof TimeRange, value: string) => {
    setRanges(prev =>
      prev.map(r => (r.id === id ? { ...r, [field]: value } : r))
    );
    setRangeErrors([]);
  };

  const addRange = () => {
    if (ranges.length >= 5) return;
    const nextId = Math.max(...ranges.map(r => r.id)) + 1;
    setRanges(prev => [...prev, createEmptyRange(nextId, `Clip ${nextId}`)]);
  };

  const removeRange = (id: number) => {
    if (ranges.length <= 1) return;
    setRanges(prev => {
      const updated = prev.filter(r => r.id !== id);
      return updated.map((r, i) => ({ ...r, label: `Clip ${i + 1}` }));
    });
    // Clean up transcript state for removed range
    setTranscripts(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setExpandedTranscripts(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setTranscriptErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const toggleTranscript = (id: number) => {
    setExpandedTranscripts(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSubmit = () => {
    // Validate URL only in URL mode
    if (!hideUrlInput) {
      const trimmed = url.trim();
      if (!trimmed) {
        setUrlError('Please enter a YouTube URL');
        return;
      }
      if (!YOUTUBE_REGEX.test(trimmed)) {
        setUrlError('Please enter a valid YouTube URL (e.g. https://youtube.com/watch?v=...)');
        return;
      }
    }
    setUrlError('');

    // Validate each range
    const errors: string[] = [];
    const parsedRanges: { start: number; end: number; title?: string }[] = [];

    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const start = toSeconds(r.startMin, r.startSec);
      const end = toSeconds(r.endMin, r.endSec);

      if (start === null || end === null) {
        errors.push(`Clip ${i + 1}: enter valid minutes & seconds (e.g. 1:30)`);
        continue;
      }

      if (end <= start) {
        errors.push(`Clip ${i + 1}: end time must be after start time`);
        continue;
      }

      if (end - start > 120) {
        errors.push(`Clip ${i + 1}: max clip duration is 2 minutes`);
        continue;
      }

      parsedRanges.push({ start, end, ...(r.title.trim() ? { title: r.title.trim() } : {}) });
    }

    // If range errors exist, stop here
    if (errors.length > 0) {
      setRangeErrors(errors);
      setTranscriptErrors({});
      return;
    }

    // Validate transcripts per range (only in manual subtitle mode)
    const newTranscriptErrors: Record<number, string> = {};
    const transcriptParts: string[] = [];
    let hasTranscript = false;

    if (subtitleMode === 'manual') {
      for (const r of ranges) {
        const text = (transcripts[r.id] || '').trim();
        if (!text) continue;

        hasTranscript = true;
        const lineErrors: string[] = [];
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const match = line.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
          if (!match) {
            lineErrors.push(`Line ${i + 1}: use format "MM:SS teks"`);
            continue;
          }
          const sec = parseInt(match[2], 10);
          if (sec > 59) {
            lineErrors.push(`Line ${i + 1}: seconds must be 0-59`);
          }
          if (!match[3].trim()) {
            lineErrors.push(`Line ${i + 1}: text cannot be empty`);
          }
        }

        if (lineErrors.length > 0) {
          newTranscriptErrors[r.id] = `${r.label}: ${lineErrors.join('; ')}`;
        } else {
          const serverText = convertToServerFormat(text);
          if (serverText) transcriptParts.push(serverText);
        }
      }
    }

    // If any transcript errors, show them and stop
    if (Object.keys(newTranscriptErrors).length > 0) {
      setTranscriptErrors(newTranscriptErrors);
      setRangeErrors([]);
      return;
    }

    setRangeErrors([]);
    setTranscriptErrors({});

    const combinedTranscript = subtitleMode === 'manual' && hasTranscript && transcriptParts.length > 0
      ? transcriptParts.join('\n\n')
      : undefined;

    onSubmit(hideUrlInput ? '' : url.trim(), parsedRanges, combinedTranscript);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isProcessing) {
      handleSubmit();
    }
  };

  const totalClips = ranges.length;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5">
      {/* URL Input / File label */}
      {hideUrlInput ? (
        <div className="p-4 rounded-xl bg-muted/30 border border-border">
          <div className="flex items-center gap-3">
            <FileVideo className="w-5 h-5 text-accent" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {fileLabel || 'Local file'}
              </p>
              <p className="text-xs text-foreground/40">Uploaded file — set time ranges below</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <label htmlFor="manual-url" className="sr-only">YouTube URL</label>
            <input
              id="manual-url"
              type="url"
              placeholder="Paste YouTube URL here..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (urlError) setUrlError('');
              }}
              onKeyDown={handleKeyDown}
              disabled={isProcessing}
              aria-describedby={urlError ? 'manual-url-error' : undefined}
              aria-invalid={!!urlError}
              className={`
                w-full px-4 py-3.5 rounded-xl
                bg-muted border
                text-foreground placeholder:text-foreground/30
                text-base font-normal
                outline-none
                transition-all duration-200 ease-out
                ${urlError
                  ? 'border-destructive/60 focus:border-destructive focus:ring-2 focus:ring-destructive/20'
                  : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/20'
                }
                ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            />
            {urlError && (
              <p id="manual-url-error" role="alert" className="mt-2 text-sm text-destructive">
                {urlError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Time Range Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground/70 flex items-center gap-1.5">
            <Clock className="w-4 h-4" aria-hidden="true" />
            Time Ranges ({totalClips})
          </label>
          {ranges.length < 5 && !isProcessing && (
            <button
              onClick={addRange}
              className="text-xs text-accent hover:text-accent/80 transition-colors duration-150 flex items-center gap-1 cursor-pointer"
              aria-label="Add another time range"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Range
            </button>
          )}
        </div>

        {ranges.map((range, index) => (
          <div
            key={range.id}
            className="p-4 rounded-xl bg-muted/30 border border-border transition-all duration-200"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground/80">{range.label}</span>
              {ranges.length > 1 && !isProcessing && (
                <button
                  onClick={() => removeRange(range.id)}
                  className="text-foreground/30 hover:text-destructive transition-colors duration-150 p-1 cursor-pointer"
                  aria-label={`Remove ${range.label}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Optional Title */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="Title (optional) — will use first 4 words of transcript if empty"
                value={range.title}
                onChange={(e) => updateRange(range.id, 'title', e.target.value)}
                disabled={isProcessing}
                className="w-full px-3 py-1.5 rounded-lg text-xs bg-background border border-border text-foreground placeholder:text-foreground/25 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-150"
                aria-label={`Title for ${range.label}`}
              />
            </div>

            <div className="flex items-center gap-3">
              {/* Start Time */}
              <div className="flex-1">
                <span className="text-xs text-foreground/40 block mb-1.5">Start</span>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={range.startMin}
                    onChange={(e) => updateRange(range.id, 'startMin', e.target.value.replace(/\D/g, ''))}
                    disabled={isProcessing}
                    className="w-14 px-2 py-2 rounded-lg bg-muted border border-border text-center text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all duration-150"
                    aria-label={`${range.label} start minutes`}
                  />
                  <span className="text-foreground/40 text-sm">m</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="00"
                    value={range.startSec}
                    onChange={(e) => updateRange(range.id, 'startSec', e.target.value.replace(/\D/g, '').slice(0, 2))}
                    disabled={isProcessing}
                    className="w-14 px-2 py-2 rounded-lg bg-muted border border-border text-center text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all duration-150"
                    aria-label={`${range.label} start seconds`}
                  />
                  <span className="text-foreground/40 text-sm">s</span>
                </div>
              </div>

              {/* Separator */}
              <div className="flex items-center pt-5">
                <span className="text-foreground/20 text-lg">→</span>
              </div>

              {/* End Time */}
              <div className="flex-1">
                <span className="text-xs text-foreground/40 block mb-1.5">End</span>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={range.endMin}
                    onChange={(e) => updateRange(range.id, 'endMin', e.target.value.replace(/\D/g, ''))}
                    disabled={isProcessing}
                    className="w-14 px-2 py-2 rounded-lg bg-muted border border-border text-center text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all duration-150"
                    aria-label={`${range.label} end minutes`}
                  />
                  <span className="text-foreground/40 text-sm">m</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="00"
                    value={range.endSec}
                    onChange={(e) => updateRange(range.id, 'endSec', e.target.value.replace(/\D/g, '').slice(0, 2))}
                    disabled={isProcessing}
                    className="w-14 px-2 py-2 rounded-lg bg-muted border border-border text-center text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all duration-150"
                    aria-label={`${range.label} end seconds`}
                  />
                  <span className="text-foreground/40 text-sm">s</span>
                </div>
              </div>
            </div>

            {/* Live duration preview */}
            {(() => {
              const start = toSeconds(range.startMin, range.startSec);
              const end = toSeconds(range.endMin, range.endSec);
              if (start !== null && end !== null && end > start) {
                const duration = end - start;
                return (
                  <p className="mt-2 text-xs text-foreground/40">
                    Duration: <span className="text-foreground/60 font-mono">{formatTimeDisplay(duration)}</span>
                    {duration > 120 && (
                      <span className="text-destructive ml-1">(max 2:00)</span>
                    )}
                  </p>
                );
              }
              return null;
            })()}

            {/* Transcript Section — collapsible textarea per range (only in manual mode) */}
            {subtitleMode === 'manual' && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <button
                onClick={() => toggleTranscript(range.id)}
                className="flex items-center gap-2 text-xs font-medium text-foreground/50 hover:text-foreground/80 transition-colors duration-150 cursor-pointer"
                aria-expanded={!!expandedTranscripts[range.id]}
                aria-label={`${transcripts[range.id]?.trim() ? 'Edit' : 'Add'} transcript for ${range.label}`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>
                  {transcripts[range.id]?.trim()
                    ? `Transcript (${transcripts[range.id]!.trim().split('\n').filter(l => l.trim()).length} lines)`
                    : 'Add Transcript (optional)'}
                </span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform duration-200 ${
                    expandedTranscripts[range.id] ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {expandedTranscripts[range.id] && (
                <div className="mt-2">
                  <textarea
                    value={transcripts[range.id] || ''}
                    onChange={(e) => {
                      setTranscripts(prev => ({ ...prev, [range.id]: e.target.value }));
                      // Clear per-range error when user edits
                      if (transcriptErrors[range.id]) {
                        setTranscriptErrors(prev => {
                          const next = { ...prev };
                          delete next[range.id];
                          return next;
                        });
                      }
                    }}
                    placeholder={`Write transcript lines in this format:\nMM:SS subtitle text\n\nExample:\n01:23 Welcome to this video\n01:25 Let's get started\n01:28 Hope you enjoy\n\nLeave empty for auto-transcribe (Whisper)`}
                    disabled={isProcessing}
                    rows={5}
                    className={`w-full px-3 py-2.5 rounded-lg bg-muted border text-foreground text-sm font-mono outline-none transition-all duration-150 resize-y min-h-[100px] ${
                      transcriptErrors[range.id]
                        ? 'border-destructive/60 focus:border-destructive focus:ring-1 focus:ring-destructive/20'
                        : 'border-border focus:border-primary focus:ring-1 focus:ring-primary/20'
                    }`}
                    aria-label={`Transcript for ${range.label}`}
                    aria-invalid={!!transcriptErrors[range.id]}
                    aria-describedby={transcriptErrors[range.id] ? `transcript-error-${range.id}` : undefined}
                  />
                  {transcriptErrors[range.id] && (
                    <p id={`transcript-error-${range.id}`} role="alert" className="mt-1.5 text-xs text-destructive">
                      {transcriptErrors[range.id]}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-foreground/30">
                    Format: <code className="text-foreground/50">MM:SS subtitle text</code> — one line per subtitle segment
                  </p>
                </div>
              )}
            </div>
            )}
          </div>
        ))}

        {/* Range errors */}
        {rangeErrors.length > 0 && (
          <div className="space-y-1">
            {rangeErrors.map((err, i) => (
              <p key={i} role="alert" className="text-sm text-destructive">
                {err}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isProcessing}
        className={`
          w-full px-6 py-3.5 rounded-xl font-semibold text-base
          bg-accent text-white
          transition-all duration-200 ease-out
          ${isProcessing
            ? 'opacity-60 cursor-not-allowed'
            : 'hover:opacity-90 active:scale-[0.97] hover:shadow-lg hover:shadow-accent/20'
          }
          focus:outline-none focus:ring-2 focus:ring-accent/40
          cursor-pointer
          flex items-center justify-center gap-2
        `}
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            <span>Cropping...</span>
          </>
        ) : (
          <span>Crop {totalClips > 1 ? `${totalClips} Ranges` : 'Range'}</span>
        )}
      </button>
    </div>
  );
}