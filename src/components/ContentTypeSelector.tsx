import { Mic, Church, Shapes } from 'lucide-react';

export type ContentType = 'podcast' | 'sermon';

interface ContentTypeSelectorProps {
  value: ContentType;
  onChange: (type: ContentType) => void;
  disabled?: boolean;
}

const OPTIONS: { value: ContentType; label: string; description: string; icon: typeof Mic }[] = [
  { value: 'podcast', label: 'Podcast', description: 'Conversation between 2+ people', icon: Mic },
  { value: 'sermon', label: 'Khotbah', description: 'Christian sermon: skips prayer, offering & announcements', icon: Church },
];

/** Which analysis profile AI mode uses to pick moments. */
export default function ContentTypeSelector({ value, onChange, disabled = false }: ContentTypeSelectorProps) {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-foreground/70 flex items-center gap-1.5">
          <Shapes className="w-4 h-4" aria-hidden="true" />
          Content type
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Content type">
        {OPTIONS.map(({ value: optVal, label, description, icon: Icon }) => {
          const selected = value === optVal;
          return (
            <button
              key={optVal}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(optVal)}
              className={`
                flex items-start gap-3 p-3 rounded-xl border text-left
                transition-all duration-200 ease-out cursor-pointer
                ${selected ? 'bg-accent/10 border-accent/40' : 'bg-muted/20 border-border hover:border-foreground/20 hover:bg-muted/30'}
                disabled:opacity-50 disabled:cursor-not-allowed
                focus:outline-none focus:ring-2 focus:ring-accent/40
              `}
            >
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${selected ? 'text-accent' : 'text-foreground/40'}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className={`text-xs font-medium ${selected ? 'text-accent' : 'text-foreground/70'}`}>{label}</p>
                <p className="text-[11px] text-foreground/40 mt-0.5 leading-tight">{description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
