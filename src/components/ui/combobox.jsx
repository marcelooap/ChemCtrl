import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Combobox({ value, onValueChange, options = [], placeholder = '', onSelect, inputClassName }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef(null);
  const listRef = useRef(null);

  const q = value.toLowerCase().trim();
  const filtered = q
    ? options.filter(o => (o.label || '').toLowerCase().includes(q))
    : options;

  useEffect(() => {
    if (!open) { setHighlight(-1); return; }
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (highlight >= 0 && listRef.current) {
      const el = listRef.current.children[highlight];
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight]);

  const pick = (opt) => {
    onValueChange(opt.label);
    if (onSelect) onSelect(opt.item);
    setOpen(false);
  };

  const onKey = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && highlight >= 0 && filtered[highlight]) { e.preventDefault(); pick(filtered[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value || ''}
        onChange={e => { onValueChange(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className={cn("flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", inputClassName)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setOpen(o => !o)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div ref={listRef} className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover shadow-md">
          {filtered.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {options.length === 0 ? t('common.comboboxNoRawMaterial') : t('common.comboboxNoResult')}
            </div>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected = value === opt.label;
              return (
                <div
                  key={opt.value}
                  onClick={() => pick(opt)}
                  onMouseEnter={() => setHighlight(idx)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer',
                    highlight === idx && 'bg-accent',
                    isSelected && 'font-medium'
                  )}
                >
                  <Check className={cn('w-4 h-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{opt.label}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
