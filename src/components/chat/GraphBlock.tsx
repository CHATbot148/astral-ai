import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * GraphBlock — renders an animated, colorful graph from a fenced ```graph``` block.
 *
 * Spec (JSON inside the fence):
 * {
 *   "type": "line" | "bar" | "scatter",          // optional, default "line"
 *   "title": "string",                            // optional
 *   "xLabel": "string",                           // optional
 *   "yLabel": "string",                           // optional
 *   "xAxis": [number|string, ...]?,               // optional shared x values
 *   "series": [
 *     { "name": "Series A", "color": "#hex"?, "data": [{x, y}, ...] | [number, ...] }
 *   ]
 * }
 *
 * - The container is rendered immediately (even while streaming / parsing).
 * - Lines animate as if being drawn (stroke-dashoffset).
 */

const PALETTE = [
  'hsl(217 91% 60%)', // blue
  'hsl(340 82% 60%)', // pink
  'hsl(45 93% 55%)',  // amber
  'hsl(160 84% 45%)', // emerald
  'hsl(280 80% 65%)', // violet
  'hsl(15 90% 60%)',  // orange
  'hsl(190 90% 55%)', // cyan
  'hsl(120 60% 55%)', // green
];

type Pt = { x: number; y: number; xLabel?: string };
type Series = { name: string; color?: string; points: Pt[] };
type Parsed = {
  type: 'line' | 'bar' | 'scatter';
  title?: string;
  xLabel?: string;
  yLabel?: string;
  series: Series[];
};

function tryParseGraph(raw: string): Parsed | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: 'Empty graph spec' };
  let json: any;
  try {
    json = JSON.parse(trimmed);
  } catch (e: any) {
    return { error: 'Waiting for graph data…' };
  }

  const type = (json.type === 'bar' || json.type === 'scatter') ? json.type : 'line';
  const xAxis: (number | string)[] | undefined = Array.isArray(json.xAxis) ? json.xAxis : undefined;
  const seriesRaw = Array.isArray(json.series) ? json.series : [];
  if (seriesRaw.length === 0) return { error: 'No series provided' };

  const series: Series[] = seriesRaw.map((s: any, idx: number) => {
    const data = Array.isArray(s?.data) ? s.data : [];
    const points: Pt[] = data.map((d: any, i: number) => {
      if (typeof d === 'number') {
        const xv = xAxis?.[i];
        const xNum = typeof xv === 'number' ? xv : i;
        return { x: xNum, y: d, xLabel: typeof xv === 'string' ? xv : undefined };
      }
      if (d && typeof d === 'object') {
        const xv = d.x ?? xAxis?.[i] ?? i;
        const xNum = typeof xv === 'number' ? xv : i;
        const xLabel = typeof xv === 'string' ? xv : (typeof d.x === 'string' ? d.x : undefined);
        return { x: xNum, y: Number(d.y ?? 0), xLabel };
      }
      return { x: i, y: 0 };
    }).filter((p: Pt) => Number.isFinite(p.y));
    return {
      name: typeof s?.name === 'string' && s.name ? s.name : `Series ${idx + 1}`,
      color: typeof s?.color === 'string' ? s.color : undefined,
      points,
    };
  }).filter((s: Series) => s.points.length > 0);

  if (series.length === 0) return { error: 'No data points' };

  return {
    type,
    title: typeof json.title === 'string' ? json.title : undefined,
    xLabel: typeof json.xLabel === 'string' ? json.xLabel : undefined,
    yLabel: typeof json.yLabel === 'string' ? json.yLabel : undefined,
    series,
  };
}

const W = 560;
const H = 320;
const PAD_L = 44;
const PAD_R = 16;
const PAD_T = 28;
const PAD_B = 40;

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    const v = min;
    return [v - 1, v - 0.5, v, v + 0.5, v + 1];
  }
  const range = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(range / count)));
  const err = (count / range) * step;
  let stepNice = step;
  if (err <= 0.15) stepNice *= 10;
  else if (err <= 0.35) stepNice *= 5;
  else if (err <= 0.75) stepNice *= 2;
  const niceMin = Math.floor(min / stepNice) * stepNice;
  const niceMax = Math.ceil(max / stepNice) * stepNice;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + stepNice / 2; v += stepNice) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(2)));
};

const GraphChart: React.FC<{ parsed: Parsed }> = ({ parsed }) => {
  const allX = parsed.series.flatMap(s => s.points.map(p => p.x));
  const allY = parsed.series.flatMap(s => s.points.map(p => p.y));
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yMinRaw = Math.min(...allY);
  const yMaxRaw = Math.max(...allY);
  const yTicks = niceTicks(yMinRaw, yMaxRaw, 5);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];

  const sx = (x: number) =>
    PAD_L + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  const sy = (y: number) =>
    H - PAD_B - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);

  // x-axis labels: prefer string xLabels from first series if present
  const firstSeries = parsed.series[0];
  const useStringXLabels = firstSeries.points.every(p => p.xLabel !== undefined);
  const xTickValues: { x: number; label: string }[] = useStringXLabels
    ? firstSeries.points.map(p => ({ x: p.x, label: p.xLabel! }))
    : niceTicks(xMin, xMax, Math.min(6, firstSeries.points.length)).map(v => ({ x: v, label: fmt(v) }));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto max-w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid */}
        {yTicks.map((t, i) => (
          <line
            key={`gy-${i}`}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={sy(t)}
            y2={sy(t)}
            stroke="hsl(var(--border))"
            strokeWidth={1}
            strokeDasharray="3 4"
            opacity={0.6}
          />
        ))}

        {/* Axes */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={H - PAD_B}
          y2={H - PAD_B}
          stroke="hsl(var(--foreground))"
          strokeWidth={1.2}
          opacity={0.7}
        />
        <line
          x1={PAD_L}
          x2={PAD_L}
          y1={PAD_T}
          y2={H - PAD_B}
          stroke="hsl(var(--foreground))"
          strokeWidth={1.2}
          opacity={0.7}
        />

        {/* Y ticks + labels */}
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line
              x1={PAD_L - 4}
              x2={PAD_L}
              y1={sy(t)}
              y2={sy(t)}
              stroke="hsl(var(--foreground))"
              opacity={0.7}
            />
            <text
              x={PAD_L - 8}
              y={sy(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="hsl(var(--muted-foreground))"
              fontFamily="ui-sans-serif, system-ui"
            >
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* X ticks + labels */}
        {xTickValues.map((t, i) => (
          <g key={`xt-${i}`}>
            <line
              x1={sx(t.x)}
              x2={sx(t.x)}
              y1={H - PAD_B}
              y2={H - PAD_B + 4}
              stroke="hsl(var(--foreground))"
              opacity={0.7}
            />
            <text
              x={sx(t.x)}
              y={H - PAD_B + 16}
              textAnchor="middle"
              fontSize={11}
              fill="hsl(var(--muted-foreground))"
              fontFamily="ui-sans-serif, system-ui"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Axis labels */}
        {parsed.xLabel && (
          <text
            x={(W + PAD_L) / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize={12}
            fill="hsl(var(--foreground))"
            opacity={0.85}
          >
            {parsed.xLabel}
          </text>
        )}
        {parsed.yLabel && (
          <text
            x={-(H / 2)}
            y={14}
            transform="rotate(-90)"
            textAnchor="middle"
            fontSize={12}
            fill="hsl(var(--foreground))"
            opacity={0.85}
          >
            {parsed.yLabel}
          </text>
        )}

        {/* Series */}
        {parsed.series.map((s, si) => {
          const color = s.color || PALETTE[si % PALETTE.length];

          if (parsed.type === 'bar') {
            const groupCount = parsed.series.length;
            const slotW = (W - PAD_L - PAD_R) / Math.max(s.points.length, 1);
            const barW = Math.max(4, (slotW * 0.7) / groupCount);
            return (
              <g key={`bar-${si}`}>
                {s.points.map((p, i) => {
                  const cx = sx(p.x) - (slotW * 0.35) + si * barW + barW / 2;
                  const y0 = sy(0 < yMin ? yMin : 0 > yMax ? yMax : 0);
                  const yT = sy(p.y);
                  const top = Math.min(y0, yT);
                  const h = Math.abs(yT - y0);
                  return (
                    <motion.rect
                      key={i}
                      x={cx - barW / 2}
                      width={barW}
                      y={top}
                      height={h}
                      fill={color}
                      rx={3}
                      initial={{ scaleY: 0, transformOrigin: `${cx}px ${y0}px` }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.5, delay: 0.05 * i + 0.2 * si, ease: 'easeOut' }}
                    />
                  );
                })}
              </g>
            );
          }

          if (parsed.type === 'scatter') {
            return (
              <g key={`sc-${si}`}>
                {s.points.map((p, i) => (
                  <motion.circle
                    key={i}
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r={4.5}
                    fill={color}
                    stroke="hsl(var(--background))"
                    strokeWidth={1.5}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.3, delay: 0.04 * i + 0.15 * si }}
                  />
                ))}
              </g>
            );
          }

          // line (default) — animated draw
          const d = s.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
            .join(' ');

          return (
            <g key={`ln-${si}`}>
              <motion.path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  pathLength: { duration: 1.4, ease: 'easeInOut', delay: 0.15 * si },
                  opacity: { duration: 0.2, delay: 0.15 * si },
                }}
              />
              {s.points.map((p, i) => (
                <motion.circle
                  key={i}
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={3.5}
                  fill="hsl(var(--background))"
                  stroke={color}
                  strokeWidth={2}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    duration: 0.25,
                    delay: 0.15 * si + 1.4 * (i / Math.max(s.points.length - 1, 1)),
                  }}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      {parsed.series.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-3 pb-3 pt-1">
          {parsed.series.map((s, si) => (
            <div key={si} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: s.color || PALETTE[si % PALETTE.length] }}
              />
              <span className="text-foreground/90">{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const GraphBlock: React.FC<{ raw: string; isStreaming?: boolean }> = ({ raw, isStreaming }) => {
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => tryParseGraph(raw), [raw]);
  const hasError = (result as any).error !== undefined;
  const parsed = !hasError ? (result as Parsed) : null;

  const copy = async () => {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'my-3 rounded-xl overflow-hidden border border-border bg-secondary/40'
      )}
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">
            {parsed?.title || 'Graph'}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={copy} className="h-6 px-2 text-xs shrink-0">
          {copied ? (
            <><Check className="h-3 w-3 mr-1" />Copied</>
          ) : (
            <><Copy className="h-3 w-3 mr-1" />Copy</>
          )}
        </Button>
      </div>

      <div className="p-2 sm:p-3">
        {parsed ? (
          <GraphChart key={raw.length} parsed={parsed} />
        ) : (
          <div className="flex items-center gap-2 px-3 py-8 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span>{isStreaming ? 'Drawing graph…' : (result as any).error || 'Preparing graph…'}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default GraphBlock;
