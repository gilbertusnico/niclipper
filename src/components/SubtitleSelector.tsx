import { Languages, Ban, PenLine } from 'lucide-react';

export type SubtitleMode = 'auto' | 'none' | 'manual';

interface SubtitleSelectorProps {
  value: SubtitleMode;
  onChange: (mode: SubtitleMode) => void;
  disabledOptions?: SubtitleMode[];
}

const OPTIONS: { value: SubtitleMode; label: string; description: string; icon: typeof Languages }[] = [
  { value: 'auto', label: 'Auto-generate', description: 'Whisper AI generates subtitles from audio', icon: Languages },
  { value: 'none', label: 'No Subtitles', description: 'Skip subtitles in output clips', icon: Ban },
  { value: 'manual', label: 'Manual Transcript', description: 'Write your own transcript per clip', icon: PenLine },
];

export default function SubtitleSelector({ value, onChange, disabledOptions = [] }: SubtitleSelectorProps) {
  const isDisabled = (mode: SubtitleMode) => disabledOptions.includes(mode);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-foreground/70 flex items-center gap-1.5">
          <Languages className="w-4 h-4" aria-hidden="true" />
          Subtitles
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Subtitle mode">
        {OPTIONS.map(({ value: optVal, label, description, icon: Icon }) => {
          const disabled = isDisabled(optVal);
          const selected = value === optVal;

          return (
            <button
              key={optVal}
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => !disabled && onChange(optVal)}
              className={`
                flex items-start gap-3 p-3 rounded-xl border text-left
                transition-all duration-200 ease-out cursor-pointer
                ${selected
                  ? 'bg-accent/10 border-accent/40'
                  : 'bg-muted/20 border-border hover:border-foreground/20'
                }
                ${disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-muted/30'
                }
                focus:outline-none focus:ring-2 focus:ring-accent/40
              `}
              title={disabled ? 'Not available in AI Generate mode' : undefined}
            >
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${selected ? 'text-accent' : 'text-foreground/40'}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className={`text-xs font-medium ${selected ? 'text-accent' : 'text-foreground/70'}`}>
                  {label}
                </p>
                <p className="text-[11px] text-foreground/40 mt-0.5 leading-tight">
                  {description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}