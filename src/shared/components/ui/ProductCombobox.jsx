import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, X } from 'lucide-react';

export default function ProductCombobox({ value, onChange, options, placeholder = 'Selecione ou busque...', allowFreeText = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const selected = options.find(o => o.value === value);
  const exactMatch = options.some(o => o.label.toLowerCase() === query.toLowerCase());
  const showCreateOption = allowFreeText && query.trim() && !exactMatch;

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    const handleClick = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (val) => { onChange(val); setQuery(''); setOpen(false); };
  const handleClear = (e) => { e.stopPropagation(); onChange(''); setQuery(''); };
  const handleCreate = () => { onChange(query.trim()); setQuery(''); setOpen(false); };

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm cursor-pointer focus-within:ring-1 focus-within:ring-ring"
        onClick={() => setOpen(o => !o)}
      >
        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={selected?.label || placeholder}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className={selected ? 'text-sm' : 'text-muted-foreground text-sm'}>{selected?.label || placeholder}</span>
        )}
        <div className="flex items-center gap-1 ml-1">
          {value && !open && (
            <button type="button" onClick={handleClear} className="opacity-50 hover:opacity-100">
              <X className="w-3 h-3" />
            </button>
          )}
          <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden">
          <div className="max-h-64 overflow-y-auto p-1">
            {showCreateOption && (
              <div
                className="px-3 py-1.5 text-sm rounded cursor-pointer hover:bg-accent hover:text-accent-foreground border-b border-border mb-1 font-medium"
                style={{ color: '#2575D1' }}
                onMouseDown={handleCreate}
              >
                Usar: "{query.trim()}"
              </div>
            )}
            {filtered.length === 0 && !showCreateOption ? (
              <p className="py-2 px-3 text-sm text-muted-foreground">Nenhum resultado.</p>
            ) : (
              filtered.map(o => (
                <div
                  key={o.value}
                  className={`px-3 py-1.5 text-sm rounded cursor-pointer hover:bg-accent hover:text-accent-foreground ${o.value === value ? 'bg-accent font-medium' : ''}`}
                  onMouseDown={() => handleSelect(o.value)}
                >
                  {o.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
