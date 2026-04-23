'use client';

import { useChartPalette } from '@/lib/theme/useChartPalette';

interface ActivitySparklineProps {
  timestamps: string[];
  width?: number;
  height?: number;
}

const CELLS = 60;

export function ActivitySparkline({
  timestamps,
  width = 120,
  height = 16,
}: ActivitySparklineProps) {
  const palette = useChartPalette();
  const filledColor = palette.accent || 'var(--accent-primary)';
  const emptyColor = palette.grid || 'var(--border)';

  const now = Date.now();
  const cellWidth = width / CELLS;
  const gap = 1;
  const barWidth = cellWidth - gap;

  // Build a Set of second-offsets that have tool use
  const activeSeconds = new Set<number>();
  for (const ts of timestamps) {
    const diffMs = now - new Date(ts).getTime();
    if (diffMs >= 0 && diffMs < 60_000) {
      const secondAgo = Math.floor(diffMs / 1000);
      activeSeconds.add(secondAgo);
    }
  }

  // cells: index 0 = most recent second, index 59 = 60s ago
  // render left-to-right as oldest→newest so we flip: cell i → second (59-i) ago
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const secondAgo = CELLS - 1 - i;
    return activeSeconds.has(secondAgo);
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Tool use activity over last 60 seconds"
      role="img"
      style={{ display: 'block' }}
    >
      {cells.map((active, i) => (
        <rect
          key={i}
          x={i * cellWidth + gap / 2}
          y={active ? 0 : height * 0.4}
          width={barWidth}
          height={active ? height : height * 0.6}
          rx={1}
          fill={active ? filledColor : emptyColor}
          opacity={active ? 1 : 0.5}
          style={
            active
              ? { filter: `drop-shadow(0 0 3px ${filledColor}88)` }
              : undefined
          }
        />
      ))}
    </svg>
  );
}
