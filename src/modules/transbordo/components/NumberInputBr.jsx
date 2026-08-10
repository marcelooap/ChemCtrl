import { useEffect, useState } from 'react';
import { Input } from '@shared/components/ui/input';
import { formatNum, parseNumero } from '@transbordo/lib/format';

/**
 * Campo numérico com exibição e digitação no padrão PT-BR
 * (milhar ".", decimal ",").
 *
 * `value` / `onChange` trabalham com número (ou "" quando vazio).
 */
export default function NumberInputBr({
  value,
  onChange,
  decimals = 0,
  disabled = false,
  placeholder = '0',
  className = '',
  max,
  min,
  id,
  name,
  'aria-label': ariaLabel,
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatDisplay(value, decimals));

  useEffect(() => {
    if (!focused) {
      setText(formatDisplay(value, decimals));
    }
  }, [value, decimals, focused]);

  const handleChange = (e) => {
    const next = sanitizeTyping(e.target.value, decimals);
    setText(next);
    if (next.trim() === '' || next === '-' || next === ',') {
      onChange?.('');
      return;
    }
    onChange?.(parseNumero(next));
  };

  const handleFocus = () => {
    if (disabled) return;
    setFocused(true);
    if (value === '' || value == null) {
      setText('');
      return;
    }
    const n = parseNumero(value);
    if (!Number.isFinite(n)) {
      setText('');
    } else if (decimals <= 0) {
      setText(String(Math.round(n)));
    } else {
      setText(String(n).replace('.', ','));
    }
  };

  const handleBlur = () => {
    setFocused(false);
    if (text == null || String(text).trim() === '') {
      onChange?.('');
      setText('');
      return;
    }
    let n = parseNumero(text);
    if (typeof min === 'number' && Number.isFinite(min) && n < min) n = min;
    if (typeof max === 'number' && Number.isFinite(max) && n > max) n = max;
    onChange?.(n);
    setText(formatDisplay(n, decimals));
  };

  return (
    <Input
      id={id}
      name={name}
      type="text"
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      aria-label={ariaLabel}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  );
}

function formatDisplay(value, decimals) {
  if (value === '' || value == null) return '';
  const n = parseNumero(value);
  if (!Number.isFinite(n)) return '';
  return formatNum(n, decimals, { empty: '' });
}

function sanitizeTyping(raw, decimals) {
  let s = String(raw || '');
  s = s.replace(/[^\d.,-]/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (neg) s = `-${s}`;

  if (decimals <= 0) {
    const digits = s.replace(/\D/g, '');
    return neg && digits ? `-${digits}` : digits;
  }

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '');
    } else {
      s = s.replace(/,/g, '');
      s = s.replace('.', ',');
    }
  } else if (lastDot >= 0 && lastComma < 0) {
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length <= decimals) {
      s = `${parts[0]},${parts[1]}`;
    } else {
      s = s.replace(/\./g, '');
    }
  }

  const parts = s.split(',');
  if (parts.length > 2) {
    s = `${parts[0]},${parts.slice(1).join('')}`;
  }
  const [intPart, decPart] = s.split(',');
  if (decPart != null) {
    s = `${intPart},${decPart.slice(0, decimals)}`;
  }
  return s;
}
