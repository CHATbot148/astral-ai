import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  BarChart3,
  Copy,
  Check,
  Download,
  Pause,
  Play,
  RotateCcw,
  ZapOff,
  Image as ImageIcon,
  FileJson,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * GraphBlock — animated, accessible graphs from a fenced ```graph``` block.
 *
 * Extended schema:
 * {
 *   "type": "line" | "bar" | "scatter",
 *   "title"?: string,
 *   "xLabel"?: string,
 *   "yLabel"?: string,         // primary (left) y-axis label
 *   "yLabelRight"?: string,    // optional right y-axis label
 *   "smooth"?: boolean,        // catmull-rom smoothing for line series
 *   "area"?: boolean,          // default fill-under for line series
 *   "xAxis"?: (number|string)[],
 *   "series": [
 *     {
 *       "name": string,
 *       "color"?: string,
 *       "axis"?: "left" | "right",
 *       "smooth"?: boolean,
 *       "area"?: boolean,
 *       "data": ({x, y}|number)[]
 *     }
 *   ]
 * }
 */

const PALETTE = [
  'hsl(217 91% 60%)',
  'hsl(340 82% 60%)',
  'hsl(45 93% 55%)',
  'hsl(160 84% 45%)',
  'hsl(280 80% 65%)',
  'hsl(15 90% 60%)',
  'hsl(190 90% 55%)',
  'hsl(120 60% 55%)',
];

type Pt = { x: number; y: number; xLabel?: string };
type Series = {
  name: string;
  color?: string;
  points: Pt[];
  axis: 'left' | 'right';
  smooth: boolean;
  area: boolean;
};
type Parsed = {
  type: 'line' | 'bar' | 'scatter';
  title?: string;
  xLabel?: string;
  yLabel?: string;
  yLabelRight?: string;
  smooth: boolean;
  area: boolean;
  hasRightAxis: boolean;
  series: Series[];
};

function tryParseGraph(raw: string): Parsed | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: 'Empty graph spec' };
  let json: any;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { error: 'Waiting for graph data…' };
  }

  const type =
    json.type === 'bar' || json.type === 'scatter' ? json.type : 'line';
  const xAxis: (number | string)[] | undefined = Array.isArray(json.xAxis)
    ? json.xAxis
    : undefined;
  const seriesRaw = Array.isArray(json.series) ? json.series : [];
  if (seriesRaw.length === 0) return { error: 'No series provided' };

  const globalSmooth = !!json.smooth;
  const globalArea = !!json.area;

  const series: Series[] = seriesRaw
    .map((s: any, idx: number) => {
      const data = Array.isArray(s?.data) ? s.data : [];
      const points: Pt[] = data
        .map((d: any, i: number) => {
          if (typeof d === 'number') {
            const xv = xAxis?.[i];
            const xNum = typeof xv === 'number' ? xv : i;
            return {
              x: xNum,
              y: d,
              xLabel: typeof xv === 'string' ? xv : undefined,
            };
          }
          if (d && typeof d === 'object') {
            const xv = d.x ?? xAxis?.[i] ?? i;
            const xNum = typeof xv === 'number' ? xv : i;
            const xLabel =
              typeof xv === 'string'
                ? xv
                : typeof d.x === 'string'
                ? d.x
                : undefined;
            return { x: xNum, y: Number(d.y ?? 0), xLabel };
          }
          return { x: i, y: 0 };
        })
        .filter((p: Pt) => Number.isFinite(p.y));
      const axis: 'left' | 'right' = s?.axis === 'right' ? 'right' : 'left';
      return {
        name: typeof s?.name === 'string' && s.name ? s.name : `Series ${idx + 1}`,
        color: typeof s?.color === 'string' ? s.color : undefined,
        points,
        axis,
        smooth: typeof s?.smooth === 'boolean' ? s.smooth : globalSmooth,
        area: typeof s?.area === 'boolean' ? s.area : globalArea,
      };
    })
    .filter((s: Series) => s.points.length > 0);

  if (series.length === 0) return { error: 'No data points' };

  return {
    type,
    title: typeof json.title === 'string' ? json.title : undefined,
    xLabel: typeof json.xLabel === 'string' ? json.xLabel : undefined,
    yLabel: typeof json.yLabel === 'string' ? json.yLabel : undefined,
    yLabelRight:
      typeof json.yLabelRight === 'string' ? json.yLabelRight : undefined,
    smooth: globalSmooth,
    area: globalArea,
    hasRightAxis: series.some((s) => s.axis === 'right'),
    series,
  };
}

const W = 560;
const H = 320;
const PAD_T = 28;
const PAD_B = 40;

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
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

// Catmull-Rom -> Bezier path for smooth lines
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2)
    return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(
      2
    )},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function linearPath(pts: { x: number; y: number }[]): string {
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
}

type AnimMode = 'playing' | 'paused' | 'static' | 'off';

const GraphChart: React.FC<{
  parsed: Parsed;
  animMode: AnimMode;
  playKey: number;
  svgRef: React.RefObject<SVGSVGElement>;
}> = ({ parsed, animMode, playKey, svgRef }) => {
  const PAD_L = 44;
  const PAD_R = parsed.hasRightAxis ? 56 : 16;

  const allX = parsed.series.flatMap((s) => s.points.map((p) => p.x));
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);

  const leftYs = parsed.series
    .filter((s) => s.axis === 'left')
    .flatMap((s) => s.points.map((p) => p.y));
  const rightYs = parsed.series
    .filter((s) => s.axis === 'right')
    .flatMap((s) => s.points.map((p) => p.y));

  const leftRaw = leftYs.length ? leftYs : [0, 1];
  const rightRaw = rightYs.length ? rightYs : [0, 1];

  const yTicksLeft = niceTicks(Math.min(...leftRaw), Math.max(...leftRaw), 5);
  const yLeftMin = yTicksLeft[0];
  const yLeftMax = yTicksLeft[yTicksLeft.length - 1];

  const yTicksRight = parsed.hasRightAxis
    ? niceTicks(Math.min(...rightRaw), Math.max(...rightRaw), 5)
    : [];
  const yRightMin = yTicksRight[0] ?? 0;
  const yRightMax = yTicksRight[yTicksRight.length - 1] ?? 1;

  const sx = (x: number) =>
    PAD_L + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  const syLeft = (y: number) =>
    H -
    PAD_B -
    ((y - yLeftMin) / (yLeftMax - yLeftMin || 1)) * (H - PAD_T - PAD_B);
  const syRight = (y: number) =>
    H -
    PAD_B -
    ((y - yRightMin) / (yRightMax - yRightMin || 1)) * (H - PAD_T - PAD_B);
  const syFor = (axis: 'left' | 'right') => (axis === 'right' ? syRight : syLeft);

  const firstSeries = parsed.series[0];
  const useStringXLabels = firstSeries.points.every(
    (p) => p.xLabel !== undefined
  );
  const plotWidth = W - PAD_L - PAD_R;
  const categoryCenters = firstSeries.points.map((_, index) =>
    PAD_L + plotWidth * ((index + 0.5) / Math.max(firstSeries.points.length, 1))
  );
  const xTickValues: { x: number; label: string; px?: number }[] = useStringXLabels
    ? firstSeries.points.map((p, index) => ({
        x: p.x,
        label: p.xLabel!,
        px: categoryCenters[index],
      }))
    : niceTicks(xMin, xMax, Math.min(6, firstSeries.points.length)).map(
        (v) => ({ x: v, label: fmt(v) })
      );

  // Animation control
  const animate = animMode === 'playing';
  const showFinal = animMode === 'static' || animMode === 'off';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto block"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={parsed.title || 'Graph'}
    >
      <rect width={W} height={H} fill="hsl(var(--background))" />

      {/* Grid (left axis) */}
      {yTicksLeft.map((t, i) => (
        <line
          key={`gy-${i}`}
          x1={PAD_L}
          x2={W - PAD_R}
          y1={syLeft(t)}
          y2={syLeft(t)}
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
      {parsed.hasRightAxis && (
        <line
          x1={W - PAD_R}
          x2={W - PAD_R}
          y1={PAD_T}
          y2={H - PAD_B}
          stroke="hsl(var(--foreground))"
          strokeWidth={1.2}
          opacity={0.7}
        />
      )}

      {/* Y-left ticks */}
      {yTicksLeft.map((t, i) => (
        <g key={`ytl-${i}`}>
          <line
            x1={PAD_L - 4}
            x2={PAD_L}
            y1={syLeft(t)}
            y2={syLeft(t)}
            stroke="hsl(var(--foreground))"
            opacity={0.7}
          />
          <text
            x={PAD_L - 8}
            y={syLeft(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={11}
            fill="hsl(var(--muted-foreground))"
          >
            {fmt(t)}
          </text>
        </g>
      ))}

      {/* Y-right ticks */}
      {parsed.hasRightAxis &&
        yTicksRight.map((t, i) => (
          <g key={`ytr-${i}`}>
            <line
              x1={W - PAD_R}
              x2={W - PAD_R + 4}
              y1={syRight(t)}
              y2={syRight(t)}
              stroke="hsl(var(--foreground))"
              opacity={0.7}
            />
            <text
              x={W - PAD_R + 8}
              y={syRight(t)}
              textAnchor="start"
              dominantBaseline="middle"
              fontSize={11}
              fill="hsl(var(--muted-foreground))"
            >
              {fmt(t)}
            </text>
          </g>
        ))}

      {/* X ticks */}
      {xTickValues.map((t, i) => (
        <g key={`xt-${i}`}>
          <line
            x1={t.px ?? sx(t.x)}
            x2={t.px ?? sx(t.x)}
            y1={H - PAD_B}
            y2={H - PAD_B + 4}
            stroke="hsl(var(--foreground))"
            opacity={0.7}
          />
          <text
            x={t.px ?? sx(t.x)}
            y={H - PAD_B + 16}
            textAnchor="middle"
            fontSize={11}
            fill="hsl(var(--muted-foreground))"
          >
            {t.label}
          </text>
        </g>
      ))}

      {/* Axis labels */}
      {parsed.xLabel && (
        <text
          x={(W + PAD_L - PAD_R) / 2}
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
      {parsed.yLabelRight && (
        <text
          x={H / 2}
          y={-(W - 14)}
          transform="rotate(90)"
          textAnchor="middle"
          fontSize={12}
          fill="hsl(var(--foreground))"
          opacity={0.85}
        >
          {parsed.yLabelRight}
        </text>
      )}

      {/* Series */}
      {parsed.series.map((s, si) => {
        const color = s.color || PALETTE[si % PALETTE.length];
        const sy = syFor(s.axis);

        if (parsed.type === 'bar') {
          const groupCount = parsed.series.length;
          const slotW = plotWidth / Math.max(s.points.length, 1);
          const barW = Math.min(28, Math.max(4, (slotW * 0.64) / groupCount));
          const groupWidth = barW * groupCount;
          return (
            <g key={`bar-${si}`}>
              {s.points.map((p, i) => {
                const centerX = useStringXLabels ? categoryCenters[i] : sx(p.x);
                const x = centerX - groupWidth / 2 + si * barW;
                const baselineY =
                  s.axis === 'right'
                    ? sy(0 < yRightMin ? yRightMin : 0 > yRightMax ? yRightMax : 0)
                    : sy(0 < yLeftMin ? yLeftMin : 0 > yLeftMax ? yLeftMax : 0);
                const yT = sy(p.y);
                const top = Math.min(baselineY, yT);
                const h = Math.abs(yT - baselineY);
                return (
                  <motion.rect
                    key={`${playKey}-${i}`}
                    x={x}
                    width={barW}
                    y={top}
                    height={h}
                    fill={color}
                    rx={3}
                    initial={
                      animate
                        ? { scaleY: 0, transformOrigin: `${x + barW / 2}px ${baselineY}px` }
                        : false
                    }
                    animate={animate ? { scaleY: 1 } : { scaleY: 1 }}
                    transition={{
                      duration: animate ? 0.5 : 0,
                      delay: animate ? 0.04 * i + 0.15 * si : 0,
                      ease: 'easeOut',
                    }}
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
                  key={`${playKey}-${i}`}
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={4.5}
                  fill={color}
                  stroke="hsl(var(--background))"
                  strokeWidth={1.5}
                  initial={animate ? { scale: 0, opacity: 0 } : false}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    duration: animate ? 0.3 : 0,
                    delay: animate ? 0.03 * i + 0.1 * si : 0,
                  }}
                />
              ))}
            </g>
          );
        }

        // line
        const screenPts = s.points.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
        const d = s.smooth ? smoothPath(screenPts) : linearPath(screenPts);

        // area path
        const baselineY = sy(
          s.axis === 'right'
            ? 0 < yRightMin
              ? yRightMin
              : 0 > yRightMax
              ? yRightMax
              : 0
            : 0 < yLeftMin
            ? yLeftMin
            : 0 > yLeftMax
            ? yLeftMax
            : 0
        );
        const areaD =
          s.area && screenPts.length
            ? `${d} L${screenPts[screenPts.length - 1].x.toFixed(
                2
              )},${baselineY.toFixed(2)} L${screenPts[0].x.toFixed(
                2
              )},${baselineY.toFixed(2)} Z`
            : '';

        const gradId = `gfill-${si}-${playKey}`;

        return (
          <g key={`ln-${si}-${playKey}`}>
            {s.area && (
              <>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <motion.path
                  d={areaD}
                  fill={`url(#${gradId})`}
                  stroke="none"
                  initial={animate ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{
                    duration: animate ? 0.6 : 0,
                    delay: animate ? 0.15 * si + 0.6 : 0,
                  }}
                />
              </>
            )}
            <motion.path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={animate ? { pathLength: 0, opacity: 0 } : false}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{
                pathLength: {
                  duration: animate ? 1.4 : 0,
                  ease: 'easeInOut',
                  delay: animate ? 0.15 * si : 0,
                },
                opacity: {
                  duration: animate ? 0.2 : 0,
                  delay: animate ? 0.15 * si : 0,
                },
              }}
            />
            {screenPts.map((p, i) => (
              <motion.circle
                key={`${playKey}-${i}`}
                cx={p.x}
                cy={p.y}
                r={3.5}
                fill="hsl(var(--background))"
                stroke={color}
                strokeWidth={2}
                initial={animate ? { scale: 0, opacity: 0 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  duration: animate ? 0.25 : 0,
                  delay: animate
                    ? 0.15 * si +
                      1.4 * (i / Math.max(screenPts.length - 1, 1))
                    : 0,
                }}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSVG(svg: SVGSVGElement, filename: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone);
  downloadBlob(
    new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }),
    filename
  );
}

async function exportPNG(svg: SVGSVGElement, filename: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
    img.src = 'data:image/svg+xml;base64,' + svg64;
  });
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename);
  }, 'image/png');
}

function exportCSV(parsed: Parsed, filename: string) {
  const header = ['x', ...parsed.series.map((s) => s.name)];
  // Build by index union of series points (longest)
  const maxLen = Math.max(...parsed.series.map((s) => s.points.length));
  const rows: string[] = [header.join(',')];
  for (let i = 0; i < maxLen; i++) {
    const xVal =
      parsed.series[0].points[i]?.xLabel ??
      parsed.series[0].points[i]?.x ??
      i;
    const row = [String(xVal)];
    for (const s of parsed.series) {
      const p = s.points[i];
      row.push(p ? String(p.y) : '');
    }
    rows.push(row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
  }
  downloadBlob(
    new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }),
    filename
  );
}

function exportJSON(raw: string, filename: string) {
  downloadBlob(
    new Blob([raw], { type: 'application/json;charset=utf-8' }),
    filename
  );
}

export const GraphBlock: React.FC<{ raw: string; isStreaming?: boolean }> = ({
  raw,
  isStreaming,
}) => {
  const [copied, setCopied] = useState(false);
  const reduced = useReducedMotion();
  const [animMode, setAnimMode] = useState<AnimMode>(
    reduced ? 'off' : 'playing'
  );
  const [playKey, setPlayKey] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  // When parsed result becomes available for the first time, start animation
  const result = useMemo(() => tryParseGraph(raw), [raw]);
  const hasError = (result as any).error !== undefined;
  const parsed = !hasError ? (result as Parsed) : null;

  // Auto-stop the animation flag once it completes (so toggling pause/replay is meaningful)
  useEffect(() => {
    if (animMode !== 'playing') return;
    const t = setTimeout(() => setAnimMode('static'), 2200);
    return () => clearTimeout(t);
  }, [animMode, playKey]);

  const copy = async () => {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const baseName = (parsed?.title || 'graph')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'graph';

  const handlePlayPause = () => {
    if (animMode === 'playing') setAnimMode('paused');
    else if (animMode === 'paused') setAnimMode('playing');
    else {
      setPlayKey((k) => k + 1);
      setAnimMode('playing');
    }
  };
  const handleReplay = () => {
    setPlayKey((k) => k + 1);
    setAnimMode('playing');
  };
  const handleToggleMotion = () => {
    setAnimMode((m) => (m === 'off' ? 'static' : 'off'));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'my-2 block w-full min-w-0 max-w-[calc(100vw-2.5rem)] sm:max-w-full overflow-hidden',
        'rounded-xl border border-border bg-secondary/40'
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-secondary border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">
            {parsed?.title || 'Graph'}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {parsed && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePlayPause}
                className="h-6 px-2 text-xs"
                aria-label={animMode === 'playing' ? 'Pause animation' : 'Play animation'}
                title={animMode === 'playing' ? 'Pause' : 'Play'}
              >
                {animMode === 'playing' ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReplay}
                className="h-6 px-2 text-xs"
                aria-label="Replay animation"
                title="Replay"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleMotion}
                className="h-6 px-2 text-xs"
                aria-label={animMode === 'off' ? 'Enable motion' : 'Disable motion'}
                title={animMode === 'off' ? 'Enable motion' : 'Reduce motion'}
              >
                <ZapOff className={cn('h-3 w-3', animMode === 'off' && 'text-primary')} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    aria-label="Export graph"
                    title="Export"
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                  <DropdownMenuItem
                    onClick={() =>
                      svgRef.current && exportPNG(svgRef.current, `${baseName}.png`)
                    }
                  >
                    <ImageIcon className="h-3.5 w-3.5 mr-2" /> PNG image
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      svgRef.current && exportSVG(svgRef.current, `${baseName}.svg`)
                    }
                  >
                    <ImageIcon className="h-3.5 w-3.5 mr-2" /> SVG vector
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => parsed && exportCSV(parsed, `${baseName}.csv`)}
                  >
                    <FileText className="h-3.5 w-3.5 mr-2" /> CSV data
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => exportJSON(raw, `${baseName}.json`)}
                  >
                    <FileJson className="h-3.5 w-3.5 mr-2" /> JSON spec
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={copy}
            className="h-6 px-2 text-xs"
            aria-label="Copy graph spec"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      <div className="w-full min-w-0 p-2 sm:p-3">
        {parsed ? (
          <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain [touch-action:pan-x] [-webkit-overflow-scrolling:touch]">
            <div className="min-w-[320px] w-full">
              <GraphChart
                key={playKey}
                parsed={parsed}
                animMode={animMode}
                playKey={playKey}
                svgRef={svgRef}
              />
            </div>
            {parsed.series.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 pt-2">
                {parsed.series.map((s, si) => (
                  <div
                    key={si}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor: s.color || PALETTE[si % PALETTE.length],
                      }}
                    />
                    <span className="text-foreground/90">
                      {s.name}
                      {s.axis === 'right' ? ' (right)' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-8 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span>
              {isStreaming
                ? 'Drawing graph…'
                : (result as any).error || 'Preparing graph…'}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default GraphBlock;
