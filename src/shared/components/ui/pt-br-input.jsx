import React, { useState, useEffect } from 'react';

function formatPtBR(num) {
  if (num == null || num === '' || isNaN(num)) return '';
  return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function parsePtBR(str) {
  if (!str || !str.trim()) return null;
  const cleaned = str.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

export default function PtBRInput({ value, onChange, placeholder, className }) {
  const [text, setText] = useState(formatPtBR(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatPtBR(value));
  }, [value, focused]);

  return (
    <input
      type="text"
      value={text}
      onChange={e => { setText(e.target.value); onChange(parsePtBR(e.target.value)); }}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setText(formatPtBR(value)); }}
      placeholder={placeholder}
      className={className}
    />
  );
}
