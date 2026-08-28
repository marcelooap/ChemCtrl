/**
 * Lista virtualizada leve (windowing) sem dependência externa.
 * Renderiza apenas as linhas visíveis + overscan.
 */
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';

/**
 * @param {object} props
 * @param {Array} props.items
 * @param {number} [props.rowHeight=44]
 * @param {number} [props.height=480]
 * @param {number} [props.overscan=8]
 * @param {(item: any, index: number) => React.ReactNode} props.renderRow
 * @param {string} [props.className]
 */
export default function VirtualList({
  items = [],
  rowHeight = 44,
  height = 480,
  overscan = 8,
  renderRow,
  className = '',
}) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const handler = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, []);

  const total = items.length;
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(total, startIndex + visibleCount);

  const slice = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex]
  );

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={className}
      style={{ height, overflow: 'auto', position: 'relative' }}
    >
      <div style={{ height: total * rowHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${startIndex * rowHeight}px)` }}>
          {slice.map((item, i) => (
            <div key={item?.id ?? startIndex + i} style={{ height: rowHeight }}>
              {renderRow(item, startIndex + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
