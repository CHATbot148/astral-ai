import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ThumbsUp, ThumbsDown, Heart, Sparkles, FileText, Volume2, Download, Pencil, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { AudioPlayer } from './AudioPlayer';
import { MediaViewer } from './MediaViewer';
import { MediaRenderer } from './MediaRenderer';
import { MapEmbed } from './MapEmbed';
import { GraphBlock } from './GraphBlock';
import { VizBlock } from './VizBlock';
import { PronounceCard } from './PronounceCard';
import { LinkPreview, extractPreviewableUrls } from './LinkPreview';
import { resolveFileUrl } from '@/lib/storageRef';
import { extractMediaFromMessage } from '@/utils/mediaDetector';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/hooks/useTheme';


interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  streamingStyle?: string;
  fileUrls?: string[] | null;
  userAvatar?: string | null;
  userName?: string | null;
  onEdit?: (content: string) => void;
  canEdit?: boolean;
  onNotificationAction?: (action: 'accept' | 'cancel', data: any) => void;
  enableAutoListImages?: boolean;
}

type Reaction = 'like' | 'dislike' | 'love' | 'sparkle' | null;

type InlineListImage = { url: string; source: string };

const reactionIcons = {
  like: ThumbsUp,
  dislike: ThumbsDown,
  love: Heart,
  sparkle: Sparkles,
};

const VISUAL_LIST_HINT_RE = /\b(cars?|super\s*cars?|hyper\s*cars?|animals?|breeds?|foods?|dishes?|cuisines?|buildings?|cities?|countries?|places?|phones?|laptops?|sneakers?|shoes?|watches?|fashion|outfits?|hotels?|resorts?|yachts?|motorcycles?|bikes?)\b/i;
const ABSTRACT_LIST_ITEM_RE = /\b(life|justice|punishment|reason|morals?|ethics?|rights?|law|policy|pros?|cons?|summary|verdict|analysis|argument|debate)\b/i;

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function normalizeListKey(value: string): string {
  const stripped = stripMarkdownInline(value).toLowerCase();
  return stripped.replace(/[^a-z0-9\s]/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function desiredInlineImageCount(key: string): number {
  return 3 + (fnv1aHash(key) % 3);
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function extractListKeyFromLine(line: string): string | null {
  return extractListItemFromLine(line)?.key ?? null;
}

function extractListItemFromLine(
  line: string
): { key: string; query: string; kind: 'numbered' | 'bullet' } | null {
  const trimmed = line.trim();
  const numbered = trimmed.match(/^(\d+)[\.)]\s+(.+)$/);
  const bullet = trimmed.match(/^[-•]\s+(.+)$/);
  const body = (numbered?.[2] ?? bullet?.[1])?.trim();
  const kind: 'numbered' | 'bullet' | null = numbered ? 'numbered' : bullet ? 'bullet' : null;
  if (!body || !kind) return null;

  const bold = body.match(/^\*\*(.+?)\*\*/);
  const titleCandidate = (bold?.[1] ?? body).trim();
  const titleRaw = titleCandidate
    .split(/(?:\s+[-—–:]\s+|:\s+)/)[0]
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim();

  const query = stripMarkdownInline(titleRaw);
  const key = normalizeListKey(query);
  if (!key) return null;
  return { key, query, kind };
}

const GENERIC_LIST_SECTION_KEYS = new Set([
  'performance',
  'design',
  'value',
  'pros',
  'cons',
  'overview',
  'summary',
  'verdict',
  'features',
  'specs',
  'pricing',
  'price',
  'cost',
  'why',
  'how',
]);

// (escapeRegExp removed - no longer needed)

/**
 * Only attach auto-fetched images to “real” list items (entity names),
 * not explanatory bullets like “Performance:” or sentence-long bullets.
 */
function isEligibleAutoImageListItem(
  lineRaw: string,
  item: { key: string; query: string; kind: 'numbered' | 'bullet' } | null
): boolean {
  if (!item) return false;

  // Only numbered entity items get images
  if (item.kind !== 'numbered') return false;

  const trimmedRaw = lineRaw.trim();
  const query = stripMarkdownInline(item.query);
  const queryKey = normalizeListKey(query);

  if (!query || /[><=≠±]/.test(query) || ABSTRACT_LIST_ITEM_RE.test(query)) return false;

  // If line contains ":" it's likely a key/value explanation
  if (trimmedRaw.includes(':')) return false;

  if (GENERIC_LIST_SECTION_KEYS.has(queryKey)) return false;

  const wordCount = query.split(/\s+/).filter(Boolean).length;
  if (wordCount > 8) return false;

  return true;
}


// Language color mapping for syntax highlighting
const LANGUAGE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  javascript: { bg: 'bg-yellow-500/20', text: 'text-yellow-500', label: 'JavaScript' },
  js: { bg: 'bg-yellow-500/20', text: 'text-yellow-500', label: 'JavaScript' },
  typescript: { bg: 'bg-blue-500/20', text: 'text-blue-500', label: 'TypeScript' },
  ts: { bg: 'bg-blue-500/20', text: 'text-blue-500', label: 'TypeScript' },
  tsx: { bg: 'bg-blue-500/20', text: 'text-blue-500', label: 'TSX' },
  jsx: { bg: 'bg-cyan-500/20', text: 'text-cyan-500', label: 'JSX' },
  python: { bg: 'bg-green-500/20', text: 'text-green-500', label: 'Python' },
  py: { bg: 'bg-green-500/20', text: 'text-green-500', label: 'Python' },
  html: { bg: 'bg-orange-500/20', text: 'text-orange-500', label: 'HTML' },
  css: { bg: 'bg-pink-500/20', text: 'text-pink-500', label: 'CSS' },
  json: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'JSON' },
  bash: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Bash' },
  sh: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Shell' },
  sql: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'SQL' },
  java: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Java' },
  cpp: { bg: 'bg-blue-600/20', text: 'text-blue-400', label: 'C++' },
  c: { bg: 'bg-blue-600/20', text: 'text-blue-400', label: 'C' },
  go: { bg: 'bg-cyan-600/20', text: 'text-cyan-400', label: 'Go' },
  rust: { bg: 'bg-orange-600/20', text: 'text-orange-400', label: 'Rust' },
  ruby: { bg: 'bg-red-600/20', text: 'text-red-400', label: 'Ruby' },
  php: { bg: 'bg-indigo-500/20', text: 'text-indigo-400', label: 'PHP' },
  swift: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Swift' },
  kotlin: { bg: 'bg-purple-600/20', text: 'text-purple-400', label: 'Kotlin' },
  dart: { bg: 'bg-sky-500/20', text: 'text-sky-400', label: 'Dart' },
  yaml: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'YAML' },
  yml: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'YAML' },
  markdown: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Markdown' },
  md: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Markdown' },
  graph: { bg: 'bg-primary/20', text: 'text-primary', label: 'Graph' },
  code: { bg: 'bg-muted', text: 'text-muted-foreground', label: 'Code' },
};

// Map common aliases to Prism-supported language ids
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  html: 'markup',
  xml: 'markup',
  vue: 'markup',
  text: 'plaintext',
  txt: 'plaintext',
  code: 'plaintext',
};

// Parse and render code blocks with syntax highlighting
const CodeBlock = ({ language, code, isStreaming }: { language: string; code: string; isStreaming?: boolean }) => {
  const [copied, setCopied] = useState(false);
  const { resolvedTheme } = useTheme();
  const lang = language.toLowerCase();
  const prismLang = LANG_ALIAS[lang] || lang || 'plaintext';
  const colors = LANGUAGE_COLORS[lang] || LANGUAGE_COLORS['code'];

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const themeStyle = resolvedTheme === 'light' ? oneLight : oneDark;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-3 block w-full min-w-0 max-w-[calc(100vw-2.5rem)] sm:max-w-full rounded-lg overflow-hidden border border-border bg-secondary/50"
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("text-xs font-mono px-2 py-0.5 rounded", colors.bg, colors.text)}>
            {colors.label}
          </span>
          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              writing
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={copyCode}
          disabled={!code}
          className="h-6 px-2 text-xs shrink-0"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1" />
              Copy
            </>
          )}
        </Button>
      </div>
      <div className="relative w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain [touch-action:pan-x] [-webkit-overflow-scrolling:touch]">
        {code ? (
          <SyntaxHighlighter
            language={prismLang}
            style={themeStyle as any}
            PreTag="pre"
            customStyle={{
              margin: 0,
              padding: '0.75rem',
              background: 'transparent',
              fontSize: '0.8125rem',
              lineHeight: 1.55,
            }}
            codeTagProps={{
              style: {
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              },
            }}
            wrapLongLines={false}
          >
            {code}
          </SyntaxHighlighter>
        ) : (
          <div className="px-3 py-4 text-xs text-muted-foreground">Preparing code…</div>
        )}
      </div>
    </motion.div>
  );
};

// Parse markdown table from lines
function parseMarkdownTable(lines: string[]): { headers: string[]; rows: string[][] } | null {
  if (lines.length < 2) return null;
  const parseRow = (line: string) =>
    line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
  const headers = parseRow(lines[0]);
  if (headers.length === 0) return null;
  if (!lines[1].match(/^\|?[\s-:|]+\|?$/)) return null;
  const rows = lines.slice(2).map(parseRow);
  return { headers, rows };
}

// Split text into text parts and table parts
function splitTextAndTables(
  text: string,
  parts: Array<{ type: 'text' | 'code' | 'media' | 'table' | 'graph' | 'mapEmbed' | 'viz' | 'pronounce'; content: string; language?: string; open?: boolean; tableData?: { headers: string[]; rows: string[][] }; mapEmbed?: any }>
) {
  const lines = text.split('\n');
  let buffer: string[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  const flushBuffer = () => {
    const t = buffer.join('\n').trim();
    if (t) parts.push({ type: 'text', content: t });
    buffer = [];
  };

  const flushTable = () => {
    const parsed = parseMarkdownTable(tableLines);
    if (parsed) {
      parts.push({ type: 'table', content: '', tableData: parsed });
    } else {
      buffer.push(...tableLines);
      flushBuffer();
    }
    tableLines = [];
  };

  for (const line of lines) {
    const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|') && line.includes('|');
    if (isTableLine) {
      if (!inTable) {
        flushBuffer();
        inTable = true;
      }
      tableLines.push(line);
    } else {
      if (inTable) {
        flushTable();
        inTable = false;
      }
      buffer.push(line);
    }
  }
  if (inTable) flushTable();
  flushBuffer();
}

// ChatGPT-style table component
const TableBlock = ({ data }: { data: { headers: string[]; rows: string[][] } }) => {
  return (
    <div className="my-2 block w-full min-w-0 max-w-[calc(100vw-2.5rem)] sm:max-w-full overflow-hidden">
      <div className="w-full min-w-0 rounded-lg border border-border bg-background/40 overflow-hidden">
        <div className="w-full min-w-0 overflow-x-auto [overflow-y:hidden] overscroll-x-contain [touch-action:auto] [-webkit-overflow-scrolling:touch]">
          <table className="w-max min-w-full table-auto text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {data.headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-3 py-2.5 text-left align-top font-semibold text-foreground min-w-[7.5rem] max-w-[18rem] whitespace-normal break-words [overflow-wrap:anywhere]"
                  >
                    <span dangerouslySetInnerHTML={{ __html: h.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border last:border-0">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-3 py-2.5 align-top text-foreground/90 min-w-[7.5rem] max-w-[18rem] whitespace-normal break-words [overflow-wrap:anywhere]"
                    >
                      <span dangerouslySetInnerHTML={{ __html: cell.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// Inline sources chip like ChatGPT
const SourcesChip = ({ sources }: { sources: { title: string; url: string; favicon: string }[] }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary border border-border text-xs font-medium hover:bg-secondary/80 transition-colors"
      >
        {sources.slice(0, 3).map((s, i) => (
          <img key={i} src={s.favicon} alt="" className="w-3.5 h-3.5 rounded-sm" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ))}
        <span>Sources</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 space-y-1.5 overflow-hidden"
          >
            {sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-secondary/80 transition-colors group"
              >
                <img src={s.favicon} alt="" className="w-4 h-4 rounded-sm flex-shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span className="text-xs text-muted-foreground group-hover:text-foreground truncate">{s.title}</span>
                <Globe className="h-3 w-3 text-muted-foreground flex-shrink-0 ml-auto" />
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Animated reveal for line_fade and slide_down styles
const AnimatedLines = ({ text, style, formatText }: { text: string; style: string; formatText: (t: string) => React.ReactNode }) => {
  const chunks = useMemo(() => {
    const lines = text.split('\n');
    const segmented: string[] = [];

    lines.forEach((line, index) => {
      const sentenceParts = line.match(/[^.!?\n]+[.!?\n]?/g) || [line];
      sentenceParts
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => segmented.push(part));

      if (index < lines.length - 1) segmented.push('\n');
    });

    return segmented.length ? segmented : [text];
  }, [text]);

  const [visibleCount, setVisibleCount] = useState(0);
  const previousChunkCountRef = useRef(0);

  useEffect(() => {
    if (chunks.length < previousChunkCountRef.current) {
      setVisibleCount(0);
    }
    previousChunkCountRef.current = chunks.length;
  }, [chunks.length]);

  useEffect(() => {
    if (visibleCount < chunks.length) {
      const timer = setTimeout(() => setVisibleCount((prev) => prev + 1), style === 'line_fade' ? 70 : 90);
      return () => clearTimeout(timer);
    }
  }, [visibleCount, chunks.length, style]);

  return (
    <div className="whitespace-pre-wrap break-words">
      {chunks.slice(0, visibleCount).map((chunk, i) => {
        if (chunk === '\n') {
          return <br key={`br-${i}`} />;
        }

        return (
          <motion.span
            key={`${chunk}-${i}`}
            initial={style === 'slide_down' ? { opacity: 0, y: -8 } : { opacity: 0 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: style === 'line_fade' ? 0.35 : 0.25, ease: 'easeOut' }}
            className="inline"
          >
            {formatText(chunk)}{' '}
          </motion.span>
        );
      })}
    </div>
  );
};

const FileImageWithLoader = ({ url, index, isUser, onPreview, onDownload }: { url: string; index: number; isUser: boolean; onPreview: (url: string) => void; onDownload?: (url: string) => void }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative">
      {!loaded && (
        <div className={cn("rounded-lg bg-muted animate-pulse border border-border", isUser ? "w-20 h-20" : "w-64 h-48")} />
      )}
      <button
        type="button"
        className={cn(
          "rounded-lg overflow-hidden border border-border bg-secondary cursor-pointer",
          isUser ? "w-20 h-20" : "w-64 max-w-full",
          !loaded && "absolute inset-0 opacity-0"
        )}
        onClick={() => onPreview(url)}
      >
        <img
          src={url}
          alt={`${!isUser ? 'Generated image' : 'Attachment'} ${index + 1}`}
          className={cn("w-full h-full", isUser ? "object-cover" : "object-contain max-h-72")}
          onLoad={() => setLoaded(true)}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </button>
      {!isUser && loaded && (
        <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2 rounded-lg">
          <Button size="sm" variant="secondary" className="gap-1" onClick={(e) => { e.stopPropagation(); onPreview(url); }}>View</Button>
          {onDownload && <Button size="sm" variant="secondary" className="gap-1" onClick={(e) => { e.stopPropagation(); onDownload(url); }}><Download className="h-3 w-3" />Save</Button>}
        </div>
      )}
    </div>
  );
};

export const ChatMessage = ({ role, content, isStreaming, streamingStyle, fileUrls, userAvatar, userName, onEdit, canEdit = true, onNotificationAction, enableAutoListImages = false }: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  const [reaction, setReaction] = useState<Reaction>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [showAudioPlayer, setShowAudioPlayer] = useState(false);
  const [resolvedFiles, setResolvedFiles] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; name: string; mime?: string } | null>(null);
  const [failedInlineImages, setFailedInlineImages] = useState<Set<string>>(new Set());
  const [notificationActed, setNotificationActed] = useState(false);
  const [autoListImagesByKey, setAutoListImagesByKey] = useState<Record<string, InlineListImage[]>>({});
  const [autoListImagesLoading, setAutoListImagesLoading] = useState(false);
  const { toast } = useToast();
  const isUser = role === 'user';

  const listItemsInMessage = useMemo(() => {
    if (role !== 'assistant') return [] as Array<{ key: string; query: string; kind: 'numbered' | 'bullet' }>;

    const withoutCode = content.replace(/```[\s\S]*?```/g, '');
    const lines = withoutCode.split('\n');
    const items: Array<{ key: string; query: string; kind: 'numbered' | 'bullet' }> = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const item = extractListItemFromLine(line);
      if (!item) continue;
      if (!isEligibleAutoImageListItem(line, item)) continue;
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      items.push(item);
      if (items.length >= 8) break;
    }

    return items;
  }, [content, role]);

  const shouldAutoFetchListImages =
    role === 'assistant' &&
    enableAutoListImages &&
    listItemsInMessage.length > 0 &&
    VISUAL_LIST_HINT_RE.test(content);

  useEffect(() => {
    if (!shouldAutoFetchListImages) {
      setAutoListImagesByKey({});
      setAutoListImagesLoading(false);
      return;
    }

    let cancelled = false;
    setAutoListImagesLoading(true);

    (async () => {
      try {
        const entries = await Promise.all(
          listItemsInMessage.map(async ({ key, query }) => {
            const desiredCount = desiredInlineImageCount(key);

            const { data, error } = await supabase.functions.invoke('web-search', {
              body: { query, type: 'images', count: 30 },
            });

            const results: any[] = !error && Array.isArray(data?.results) ? data.results : [];

            const urls: InlineListImage[] = (results || [])
              .map((r: any) => ({ url: r.imageUrl, source: r.source || '' }))
              .filter((r: InlineListImage) => !!r.url);

            const seed = fnv1aHash(key);
            const shuffled = seededShuffle(urls, seed);

            const picked: InlineListImage[] = [];
            for (let i = 0; i < shuffled.length && picked.length < desiredCount; i++) {
              picked.push(shuffled[i]);
            }
            while (picked.length < desiredCount && shuffled.length > 0) {
              picked.push(shuffled[picked.length % shuffled.length]);
            }

            return [key, picked] as const;
          })
        );

        if (cancelled) return;
        setAutoListImagesByKey(Object.fromEntries(entries));
      } catch (e) {
        console.warn('Auto list image fetch failed:', e);
      } finally {
        if (!cancelled) setAutoListImagesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldAutoFetchListImages, listItemsInMessage]);

  const copyToClipboardUser = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEdit = () => {
    if (onEdit && canEdit) {
      onEdit(content);
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleReaction = (r: Reaction) => {
    setReaction(prev => prev === r ? null : r);
    setShowReactions(false);
  };
  // Parse content using the new media detector
  const parsedContent = useMemo(() => {
    const { cleanText, mediaItems } = extractMediaFromMessage(content);

    // Extract [Sources] section
    let mainText = cleanText;
    const sources: { title: string; url: string; favicon: string }[] = [];
    const sourcesMap = new Map<string, { title: string; url: string; favicon: string }>();

    const sourcesSectionMatch = cleanText.match(/\n{1,2}(?:\*{0,2}\[?sources?\]?\*{0,2}\s*:?\s*)\n([\s\S]+?)$/i);
    if (sourcesSectionMatch) {
      mainText = cleanText.slice(0, sourcesSectionMatch.index!).trim();
      const sourcesText = sourcesSectionMatch[1];

      const sourcePattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s),]+)/gi;
      let sourceMatch: RegExpExecArray | null;

      while ((sourceMatch = sourcePattern.exec(sourcesText)) !== null) {
        const markdownTitle = sourceMatch[1]?.trim();
        const rawUrl = (sourceMatch[2] || sourceMatch[3] || '').replace(/[.,;:]+$/, '');
        if (!rawUrl || sourcesMap.has(rawUrl)) continue;

        try {
          const hostname = new URL(rawUrl).hostname;
          const fallbackTitle = hostname.replace(/^www\./, '');
          sourcesMap.set(rawUrl, {
            title: markdownTitle || fallbackTitle,
            url: rawUrl,
            favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`,
          });
        } catch {
          sourcesMap.set(rawUrl, { title: markdownTitle || rawUrl, url: rawUrl, favicon: '' });
        }
      }
    }

    sources.push(...sourcesMap.values());

    const parts: Array<{
      type: 'text' | 'code' | 'media' | 'table' | 'graph' | 'mapEmbed' | 'viz' | 'pronounce';
      content: string;
      language?: string;
      open?: boolean;
      tableData?: { headers: string[]; rows: string[][] };
      mapEmbed?: { mode: 'place' | 'directions'; query?: string; origin?: string; destination?: string; travelMode?: 'driving' | 'walking' | 'bicycling' | 'transit' };
    }> = [];

    // Extract map embed tokens BEFORE other parsing so they always render as one block at the top.
    // Tokens: [[MAP_EMBED q="..."]] or [[MAP_DIRECTIONS origin="..." destination="..." mode="..."]]
    const mapTokens: typeof parts = [];
    mainText = mainText.replace(/\[\[MAP_DIRECTIONS\s+origin="([^"]+)"\s+destination="([^"]+)"(?:\s+mode="([^"]+)")?\s*\]\]/g, (_m, o, d, mode) => {
      mapTokens.push({ type: 'mapEmbed', content: '', mapEmbed: { mode: 'directions', origin: o, destination: d, travelMode: (mode || 'driving') as any } });
      return '';
    });
    mainText = mainText.replace(/\[\[MAP_EMBED\s+q="([^"]+)"\s*\]\]/g, (_m, q) => {
      mapTokens.push({ type: 'mapEmbed', content: '', mapEmbed: { mode: 'place', query: q } });
      return '';
    });
    mainText = mainText.trim();
    parts.push(...mapTokens);

    // Match closed fences first; then handle a single trailing unclosed fence so the
    // container shows up immediately while streaming.
    const closedFenceRegex = /```(\w+)?\n?([\s\S]*?)```/g;

    let lastIndex = 0;
    let match;

    while ((match = closedFenceRegex.exec(mainText)) !== null) {
      if (match.index > lastIndex) {
        const textPart = mainText.slice(lastIndex, match.index).trim();
        if (textPart) splitTextAndTables(textPart, parts);
      }
      const lang = (match[1] || 'code').toLowerCase();
      const body = match[2].trim();
      if (lang === 'graph') {
        parts.push({ type: 'graph', content: body, language: 'graph', open: false });
      } else if (lang === 'viz' || lang === 'astraz-viz' || lang === 'visualization' || lang === 'widget') {
        parts.push({ type: 'viz', content: body, language: 'viz', open: false });
      } else {
        parts.push({ type: 'code', language: lang, content: body, open: false });
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < mainText.length) {
      const remaining = mainText.slice(lastIndex);
      // Detect a trailing unclosed fence: ```lang\n...  with no closing ```
      const openFenceMatch = remaining.match(/```(\w+)?\n?([\s\S]*)$/);
      if (openFenceMatch && !openFenceMatch[2].includes('```')) {
        const before = remaining.slice(0, openFenceMatch.index!).trim();
        if (before) splitTextAndTables(before, parts);
        const lang = (openFenceMatch[1] || 'code').toLowerCase();
        const body = openFenceMatch[2];
        if (lang === 'graph') {
          parts.push({ type: 'graph', content: body, language: 'graph', open: true });
        } else if (lang === 'viz' || lang === 'astraz-viz' || lang === 'visualization' || lang === 'widget') {
          parts.push({ type: 'viz', content: body, language: 'viz', open: true });
        } else {
          parts.push({ type: 'code', language: lang, content: body, open: true });
        }
      } else {
        const textPart = remaining.trim();
        if (textPart) splitTextAndTables(textPart, parts);
      }
    }

    return { parts, mediaItems, sources };
  }, [content]);

  // Format text with strict sections + compact spacing for readability
  const formatText = (text: string) => {
    const formatInline = (value: string) => {
      let formatted = value;
      formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
      formatted = formatted.replace(/`([^`]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');
      formatted = formatted.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline break-all">$1 ↗</a>'
      );
      formatted = formatted.replace(
        /(?<!\])\((https?:\/\/[^\s\)]+)\)|(?<!["\(])(https?:\/\/[^\s<]+)(?!["\)])/g,
        (match, p1, p2) => {
          const url = p1 || p2;
          if (!url) return match;
          const shortUrl = url.length > 50 ? `${url.slice(0, 47)}...` : url;
          return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline break-all">${shortUrl} ↗</a>`;
        }
      );
      return formatted;
    };

    const lines = text.split('\n');

    const IMG_TAG_RE = /^\[IMG:(https?:\/\/[^|\]]+)\|?([^\]]*)\]$/;
    const isImgTagLine = (value: string) => IMG_TAG_RE.test(value.trim());

    const renderInlineImages = (imgTags: InlineListImage[], keySuffix: string) => {
      const visibleInlineImages = imgTags.filter((img) => !failedInlineImages.has(img.url));
      if (visibleInlineImages.length === 0) return null;

      return (
        <div
          key={`inline-imgs-${keySuffix}`}
          className="flex gap-2 overflow-x-auto pb-2 my-2 overscroll-x-contain [touch-action:pan-x] [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
        >
          {visibleInlineImages.map((img, idx) => (
            <button
              key={`iimg-${keySuffix}-${idx}`}
              type="button"
              onClick={() => setPreviewImage(img.url)}
              className="flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity group relative"
            >
              <img
                src={img.url}
                alt={img.source ? `${img.source} image` : 'Inline image'}
                loading="lazy"
                className="h-40 w-52 object-cover rounded-lg border border-border"
                onError={() => {
                  setFailedInlineImages((prev) => {
                    const next = new Set(prev);
                    next.add(img.url);
                    return next;
                  });
                }}
              />
              {img.source && (
                <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded truncate max-w-[90%]">
                  {img.source}
                </span>
              )}
            </button>
          ))}
        </div>
      );
    };

    const renderLoadingImagesRow = (count: number, keySuffix: string) => {
      if (count <= 0) return null;

      return (
        <div key={`inline-loading-${keySuffix}`} className="my-2">
          <div className="text-xs font-medium leading-5 text-transparent bg-clip-text bg-[linear-gradient(90deg,hsl(var(--muted-foreground))_0%,hsl(var(--foreground))_45%,hsl(var(--muted-foreground))_100%)] bg-[length:220%_100%] animate-[shimmer_1.8s_linear_infinite]">
            Loading images…
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-2 overscroll-x-contain [touch-action:pan-x] [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
            {Array.from({ length: count }).map((_, i) => (
              <div
                key={`sk-${keySuffix}-${i}`}
                className="relative h-40 w-52 rounded-lg border border-border bg-muted overflow-hidden"
              >
                <div className="absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--muted))_0%,hsl(var(--background))_45%,hsl(var(--muted))_100%)] bg-[length:220%_100%] animate-[shimmer_1.8s_linear_infinite]" />
              </div>
            ))}
          </div>
        </div>
      );
    };

    const mergeUniqueByUrl = (base: InlineListImage[], extra: InlineListImage[], limit: number) => {
      const seen = new Set<string>();
      const merged: InlineListImage[] = [];
      for (const img of [...base, ...extra]) {
        if (!img?.url) continue;
        if (seen.has(img.url)) continue;
        seen.add(img.url);
        merged.push(img);
        if (merged.length >= limit) break;
      }
      return merged;
    };

    const getNextNonEmptyLine = (fromIndex: number) => {
      for (let i = fromIndex + 1; i < lines.length; i++) {
        const t = lines[i]?.trim();
        if (!t) continue;
        return t;
      }
      return '';
    };

    const out: React.ReactNode[] = [];
    let activeListKey: string | null = null;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const rawLine = lines[lineIndex];
      const line = rawLine.trim();

      if (!line) {
        out.push(<div key={`space-${lineIndex}`} className="h-1.5" />);
        continue;
      }
      if (/^---+$/.test(line)) {
        out.push(<hr key={`hr-${lineIndex}`} className="my-3 border-0 border-t border-border/70" />);
        continue;
      }

      const listItem = extractListItemFromLine(line);
      const isListLine = /^(\d+)[\.)]\s+/.test(line) || /^[-•]\s+/.test(line);
      const canAttachAutoImages = !!listItem && isEligibleAutoImageListItem(rawLine, listItem);

      // Only treat eligible list items as “active” (prevents images for explanatory bullets)
      if (isListLine) {
        activeListKey = canAttachAutoImages ? listItem!.key : null;
      }

      // Inline IMG group (may need supplementation to reach 3-5)
      const imgTagMatch = line.match(IMG_TAG_RE);
      if (imgTagMatch) {
        const imgGroup: InlineListImage[] = [{ url: imgTagMatch[1], source: imgTagMatch[2] || '' }];
        let nextIdx = lineIndex + 1;
        while (nextIdx < lines.length) {
          const nextLine = lines[nextIdx].trim();
          const nextMatch = nextLine.match(IMG_TAG_RE);
          if (nextMatch) {
            imgGroup.push({ url: nextMatch[1], source: nextMatch[2] || '' });
            nextIdx++;
          } else {
            break;
          }
        }

        const isFirstInGroup = lineIndex === 0 || !lines[lineIndex - 1]?.trim().startsWith('[IMG:');
        if (isFirstInGroup) {
          const keyForImgs = activeListKey;
          const desired = keyForImgs ? desiredInlineImageCount(keyForImgs) : imgGroup.length;
          const supplemental = keyForImgs ? (autoListImagesByKey[keyForImgs] ?? []) : [];
          const merged = mergeUniqueByUrl(imgGroup, supplemental, desired);

          out.push(renderInlineImages(merged, `${lineIndex}`));

          if (keyForImgs && merged.length < desired && autoListImagesLoading) {
            out.push(renderLoadingImagesRow(desired - merged.length, `${keyForImgs}-${lineIndex}`));
          }
        }

        lineIndex = nextIdx - 1;
        continue;
      }

      const markdownHeader = line.match(/^(#{1,3})\s+(.+)$/);
      if (markdownHeader) {
        activeListKey = null;
        const level = markdownHeader[1].length;
        const body = formatInline(markdownHeader[2]);
        const headerClass = level === 1 ? 'text-xl font-semibold mt-3' : level === 2 ? 'text-lg font-semibold mt-2.5' : 'text-base font-semibold mt-2';
        out.push(<p key={`header-${lineIndex}`} className={headerClass} dangerouslySetInnerHTML={{ __html: body }} />);
        continue;
      }

      const maybeAppendAutoImages = (key: string, suffix: string) => {
        if (!shouldAutoFetchListImages) return;

        const nextLine = getNextNonEmptyLine(lineIndex);
        if (nextLine && isImgTagLine(nextLine)) return; // IMG group will render itself

        const desired = desiredInlineImageCount(key);
        const imgs = autoListImagesByKey[key] ?? [];
        if (imgs.length > 0) {
          out.push(renderInlineImages(imgs.slice(0, desired), suffix));
        } else if (autoListImagesLoading) {
          out.push(renderLoadingImagesRow(desired, suffix));
        }
      };

      const bulletMatch = line.match(/^[-•]\s+(.+)$/);
      if (bulletMatch) {
        out.push(
          <div key={`bullet-${lineIndex}`} className="my-1 grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2 pl-3 pr-1">
            <span className="pt-0.5 text-muted-foreground">•</span>
            <span className="min-w-0 text-[0.95rem] leading-7 text-foreground" dangerouslySetInnerHTML={{ __html: formatInline(bulletMatch[1]) }} />
          </div>
        );
        if (canAttachAutoImages && listItem) maybeAppendAutoImages(listItem.key, `bullet-${listItem.key}-${lineIndex}`);
        continue;
      }

      const numberedMatch = line.match(/^(\d+)[\.)]\s+(.+)$/);
      if (numberedMatch) {
        out.push(
          <div key={`number-${lineIndex}`} className="my-1 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 pl-3 pr-1">
            <span className="pt-0.5 text-muted-foreground">{numberedMatch[1]}.</span>
            <span className="min-w-0 text-[0.95rem] leading-7 text-foreground" dangerouslySetInnerHTML={{ __html: formatInline(numberedMatch[2]) }} />
          </div>
        );
        if (canAttachAutoImages && listItem) maybeAppendAutoImages(listItem.key, `number-${listItem.key}-${lineIndex}`);
        continue;
      }

      out.push(
        <p
          key={`paragraph-${lineIndex}`}
          className="my-1.5 text-[0.95rem] leading-7 text-foreground"
          dangerouslySetInnerHTML={{ __html: formatInline(rawLine) }}
        />
      );
    }

    return out;
  };

  const isImageLike = (url: string) => {
    if (url.startsWith('data:image/')) return true;
    if (url.startsWith('storage:')) return url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i);
    return url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i) || (url.includes('supabase') && url.includes('storage') && !url.match(/\.(mp4|webm|mov|m4v)(\?.*)?$/i));
  };

  const isVideoLike = (url: string) => {
    return url.match(/\.(mp4|webm|mov|m4v)(\?.*)?$/i) != null;
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!fileUrls?.length) {
        setResolvedFiles([]);
        return;
      }

      const resolved = await Promise.all(
        fileUrls.map((u) => resolveFileUrl(u, { expiresIn: 60 * 60 * 24 * 7 }))
      );
      if (!cancelled) setResolvedFiles(resolved);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [fileUrls]);

  return (
    <div
      className={cn(
        "px-4 py-3 group w-full overflow-x-clip chat-message-enter",
        isUser ? "flex justify-end" : "",
      )}
    >
      {/* Content */}
      <div className={cn(
        "min-w-0 space-y-2",
        isUser ? "text-right max-w-full ml-auto" : "text-left w-full"
      )}>
        <div className={cn("flex items-center gap-2", isUser ? "justify-end" : "justify-start")}>
          <span className="font-semibold text-sm">
            {isUser ? (userName || 'You') : 'Astraz'}
          </span>
          {isStreaming && (
            <span className="flex gap-1">
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-xai-cyan"
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1, repeat: Infinity, delay: 0 }}
              />
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-xai-cyan"
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
              />
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-xai-cyan"
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
              />
            </span>
          )}
        </div>

        {/* File Attachments / Generated Images */}
        {fileUrls && fileUrls.length > 0 && resolvedFiles.length === 0 && (
          <div className={cn("flex flex-wrap gap-2 my-2", isUser ? "justify-end" : "justify-start")}>
            {fileUrls.map((_, index) => (
              <div key={`skeleton-${index}`} className={cn(
                "rounded-lg bg-muted animate-pulse border border-border",
                isUser ? "w-20 h-20" : "w-64 h-48"
              )} />
            ))}
          </div>
        )}
        {resolvedFiles.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn("flex flex-wrap gap-2 my-2", isUser ? "justify-end" : "justify-start")}
          >
            {resolvedFiles.map((url, index) => (
              <motion.div 
                key={index} 
                className="relative group/img"
                whileHover={{ scale: 1.02 }}
              >
                {isImageLike(url) ? (
                  <FileImageWithLoader
                    url={url}
                    index={index}
                    isUser={isUser}
                    onPreview={setPreviewImage}
                    onDownload={async (downloadUrl: string) => {
                      try {
                        const response = await fetch(downloadUrl);
                        const blob = await response.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = `astraz-image-${Date.now()}.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(blobUrl);
                      } catch {
                        toast({ title: 'Failed to save', variant: 'destructive' });
                      }
                    }}
                  />
                ) : isVideoLike(url) ? (
                  <button
                    type="button"
                    onClick={() => setPreviewVideo(url)}
                    aria-label="Play video"
                    className="group/vid relative w-40 h-40 sm:w-44 sm:h-44 rounded-2xl overflow-hidden border border-border/60 bg-black shadow-[0_10px_40px_-14px_hsl(var(--xai-purple)/0.5)] flex-shrink-0"
                  >
                    <video
                      src={url}
                      muted
                      playsInline
                      preload="metadata"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-12 w-12 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center group-hover/vid:scale-110 group-active/vid:scale-95 transition-transform shadow-lg">
                        <span className="block w-0 h-0 border-y-[8px] border-y-transparent border-l-[12px] border-l-white ml-[3px]" />
                      </div>
                    </div>
                  </button>
                ) : (() => {
                  // ChatGPT-style document/file pill: type icon square + name + PDF/type label
                  let filename = 'Attachment';
                  let ext = '';
                  try {
                    const u = new URL(url);
                    const pathname = decodeURIComponent(u.pathname);
                    filename = pathname.split('/').pop() || 'Attachment';
                    ext = (filename.split('.').pop() || '').toLowerCase();
                  } catch { /* ignore */ }
                  const isPdf = ext === 'pdf';
                  const isDoc = ['doc', 'docx', 'odt', 'rtf'].includes(ext);
                  const isSheet = ['xls', 'xlsx', 'csv', 'ods'].includes(ext);
                  const isText = ['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml'].includes(ext);
                  const typeLabel = isPdf ? 'PDF'
                    : isDoc ? 'DOC'
                    : isSheet ? 'SHEET'
                    : isText ? 'TEXT'
                    : ext ? ext.toUpperCase()
                    : 'FILE';
                  const tint = isPdf ? 'bg-gradient-to-br from-red-500 to-rose-600'
                    : isDoc ? 'bg-gradient-to-br from-sky-500 to-blue-600'
                    : isSheet ? 'bg-gradient-to-br from-emerald-500 to-green-600'
                    : 'bg-gradient-to-br from-xai-purple to-xai-cyan';
                  const mime = isPdf ? 'application/pdf' : undefined;
                  return (
                    <button
                      type="button"
                      onClick={() => setPreviewDoc({ url, name: filename, mime })}
                      className="group/file flex items-center gap-3 pl-2 pr-4 py-2 rounded-2xl bg-secondary/70 hover:bg-secondary border border-border/60 hover:border-xai-cyan/40 shadow-sm hover:shadow-md transition-all max-w-[300px] text-left"
                      title={filename}
                    >
                      <div className={cn("relative flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center shadow-inner text-white", tint)}>
                        <FileText className="h-5 w-5" strokeWidth={2.2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-semibold text-foreground truncate leading-tight">{filename}</p>
                        <p className="text-[11px] text-muted-foreground/90 mt-0.5 font-medium tracking-wide">{typeLabel}</p>
                      </div>
                    </button>
                  );
                })()}
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Media Viewer (images, AI images, video, documents) */}
        <MediaViewer
          open={!!previewImage}
          url={previewImage || ''}
          kind={isUser ? 'image' : 'ai-image'}
          onClose={() => setPreviewImage(null)}
        />
        <MediaViewer
          open={!!previewVideo}
          url={previewVideo || ''}
          kind="video"
          onClose={() => setPreviewVideo(null)}
        />
        <MediaViewer
          open={!!previewDoc}
          url={previewDoc?.url || ''}
          fileName={previewDoc?.name}
          mimeType={previewDoc?.mime}
          kind="document"
          onClose={() => setPreviewDoc(null)}
        />

        {/* Render extracted media using MediaRenderer */}
        {parsedContent.mediaItems.length > 0 && (
          <MediaRenderer 
            mediaItems={parsedContent.mediaItems} 
            isUser={isUser}
            onImageClick={(url) => setPreviewImage(url)}
          />
        )}

        {/* Notification approval prompt */}
        {content.startsWith('[NOTIFICATION_PROMPT]') ? (() => {
          let promptData: any = {};
          try {
            promptData = JSON.parse(content.replace('[NOTIFICATION_PROMPT] ', ''));
          } catch {}
          return (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-block px-4 py-3 rounded-xl bg-secondary border border-border space-y-3"
            >
              <p className="text-sm text-foreground">
                🔔 I'd like to set a reminder for <strong>{promptData.displayTime}</strong>: "{promptData.message}". 
                Would you like to enable notifications so I can alert you? (You'll get push notifications on supported devices, or email/chat reminders on iOS)
              </p>
              {!notificationActed ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="xai" onClick={() => { setNotificationActed(true); onNotificationAction?.('accept', promptData); }}>
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setNotificationActed(true); onNotificationAction?.('cancel', promptData); }}>
                    No, just remind in chat
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">✅ Reminder scheduled</p>
              )}
            </motion.div>
          );
        })()
        : content.startsWith('[REMINDER_SET]') ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30"
          >
            <span className="text-red-500 font-semibold text-sm">
              {content.replace('[REMINDER_SET] ', '')}
            </span>
          </motion.div>
        ) : content.startsWith('[REMINDER]') ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30"
          >
            <span className="text-red-400 font-semibold text-sm">
              {content.replace('[REMINDER] ', '')}
            </span>
          </motion.div>
        ) : (
        <div 
          className={cn(
            "text-foreground leading-relaxed inline-block max-w-full min-w-0",
            isUser
              ? "bg-secondary rounded-2xl rounded-tr-sm px-4 py-2 w-fit max-w-[85vw] sm:max-w-[70ch] ml-auto break-words [overflow-wrap:anywhere]"
              : "w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere]"
          )}
        >
          {parsedContent.parts.map((part, index) =>
            part.type === 'code' ? (
              <CodeBlock
                key={index}
                language={part.language || 'code'}
                code={part.content}
                isStreaming={!!part.open}
              />
            ) : part.type === 'graph' ? (
              <GraphBlock key={index} raw={part.content} isStreaming={!!part.open} />
            ) : part.type === 'viz' ? (
              <VizBlock key={index} code={part.content} isStreaming={!!part.open} />
            ) : part.type === 'table' && part.tableData ? (
              <TableBlock key={index} data={part.tableData} />
            ) : part.type === 'mapEmbed' && part.mapEmbed ? (
              <MapEmbed key={index} {...part.mapEmbed} />
            ) : isStreaming && (streamingStyle === 'line_fade' || streamingStyle === 'slide_down') ? (
              <AnimatedLines key={index} text={part.content} style={streamingStyle} formatText={formatText} />
            ) : (
              <div key={index} className="whitespace-pre-wrap break-words">{formatText(part.content)}</div>
            )
          )}
        </div>
        )}

        {/* Inline Sources - ChatGPT style */}
        {!isUser && parsedContent.sources.length > 0 && (
          <SourcesChip sources={parsedContent.sources} />
        )}

        {/* Link previews (Firecrawl-powered) — auto-detect first 2 URLs in message */}
        {!isStreaming && content && (() => {
          const urls = extractPreviewableUrls(content, 2);
          if (urls.length === 0) return null;
          return (
            <div className="mt-2 space-y-2">
              {urls.map((u) => <LinkPreview key={u} url={u} />)}
            </div>
          );
        })()}


        {/* Audio Player */}
        <AnimatePresence>
          {showAudioPlayer && !isUser && !isStreaming && content && (
            <AudioPlayer text={content} onClose={() => setShowAudioPlayer(false)} />
          )}
        </AnimatePresence>

        {/* Actions & Reactions */}
        {!isUser && !isStreaming && content && (
          <div className={cn(
            "flex items-center gap-1 pt-2 opacity-0 group-hover:opacity-100 transition-opacity",
            isUser ? "justify-end" : "justify-start"
          )}>
            {/* Listen Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAudioPlayer(!showAudioPlayer)}
              className={cn(
                "h-7 px-2 text-xs",
                showAudioPlayer ? "text-xai-cyan" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Volume2 className="h-3 w-3 mr-1" />
              Listen
            </Button>

            {/* Copy Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={copyToClipboard}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </>
              )}
            </Button>

            {/* Reaction Button */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowReactions(!showReactions)}
                aria-label={reaction ? `Change reaction (current: ${reaction})` : 'Add reaction'}
                className={cn(
                  "h-7 px-2 text-xs",
                  reaction ? "text-xai-cyan" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {reaction ? (
                  (() => {
                    const Icon = reactionIcons[reaction];
                    return <Icon className="h-3 w-3" />;
                  })()
                ) : (
                  <ThumbsUp className="h-3 w-3" />
                )}
              </Button>
              
              {/* Reaction Picker */}
              <AnimatePresence>
                {showReactions && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className="absolute bottom-full left-0 mb-1 flex gap-1 p-1.5 rounded-lg bg-popover border border-border shadow-lg"
                  >
                    {(Object.keys(reactionIcons) as Reaction[]).filter(Boolean).map((r) => {
                      const Icon = reactionIcons[r!];
                      return (
                        <motion.button
                          key={r}
                          whileHover={{ scale: 1.2 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => toggleReaction(r)}
                          aria-label={`React with ${r}`}
                          className={cn(
                            "p-1.5 rounded-full transition-colors",
                            reaction === r ? "bg-xai-cyan/20 text-xai-cyan" : "hover:bg-secondary text-muted-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </motion.button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Actions for user messages */}
        {isUser && !isStreaming && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 justify-end text-xs text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {canEdit && onEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleEdit}
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={copyToClipboardUser}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3" />
              Sent
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
};
