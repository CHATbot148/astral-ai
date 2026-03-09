import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ThumbsUp, ThumbsDown, Heart, Sparkles, FileText, Volume2, Download, Pencil, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { AudioPlayer } from './AudioPlayer';
import { ImagePreviewModal } from './ImagePreviewModal';
import { MediaRenderer } from './MediaRenderer';
import { resolveFileUrl } from '@/lib/storageRef';
import { extractMediaFromMessage } from '@/utils/mediaDetector';
import { useToast } from '@/hooks/use-toast';


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

function extractListItemFromLine(line: string): { key: string; query: string } | null {
  const trimmed = line.trim();
  const numbered = trimmed.match(/^(\d+)[\.)]\s+(.+)$/);
  const bullet = trimmed.match(/^[-•]\s+(.+)$/);
  const body = (numbered?.[2] ?? bullet?.[1])?.trim();
  if (!body) return null;

  const bold = body.match(/^\*\*(.+?)\*\*/);
  const titleRaw = (bold?.[1] ?? body).split(/(?:\s+[-—–:]\s+|:\s+)/)[0].trim();
  const query = stripMarkdownInline(titleRaw);
  const key = normalizeListKey(query);
  if (!key) return null;
  return { key, query };
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
  code: { bg: 'bg-muted', text: 'text-muted-foreground', label: 'Code' },
};

// Parse and render code blocks with syntax highlighting
const CodeBlock = ({ language, code }: { language: string; code: string }) => {
  const [copied, setCopied] = useState(false);
  const lang = language.toLowerCase();
  const colors = LANGUAGE_COLORS[lang] || LANGUAGE_COLORS['code'];

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-border bg-secondary/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border">
        <span className={cn("text-xs font-mono px-2 py-0.5 rounded", colors.bg, colors.text)}>
          {colors.label}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={copyCode}
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
      <div className="relative">
        <pre className="p-3 overflow-x-auto text-sm max-w-full">
          <code className="font-mono text-foreground whitespace-pre-wrap break-words">{code}</code>
        </pre>
      </div>
    </div>
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
  parts: Array<{ type: 'text' | 'code' | 'media' | 'table'; content: string; language?: string; tableData?: { headers: string[]; rows: string[][] } }>
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

export const ChatMessage = ({ role, content, isStreaming, streamingStyle, fileUrls, userAvatar, userName, onEdit, canEdit = true, onNotificationAction }: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  const [reaction, setReaction] = useState<Reaction>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [showAudioPlayer, setShowAudioPlayer] = useState(false);
  const [resolvedFiles, setResolvedFiles] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [failedInlineImages, setFailedInlineImages] = useState<Set<string>>(new Set());
  const [notificationActed, setNotificationActed] = useState(false);
  const { toast } = useToast();
  const isUser = role === 'user';

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

    const parts: Array<{ type: 'text' | 'code' | 'media' | 'table'; content: string; language?: string; tableData?: { headers: string[]; rows: string[][] } }> = [];
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    
    let lastIndex = 0;
    let match;
    
    while ((match = codeBlockRegex.exec(mainText)) !== null) {
      if (match.index > lastIndex) {
        const textPart = mainText.slice(lastIndex, match.index).trim();
        if (textPart) splitTextAndTables(textPart, parts);
      }
      parts.push({ type: 'code', language: match[1] || 'code', content: match[2].trim() });
      lastIndex = match.index + match[0].length;
    }
    
    if (lastIndex < mainText.length) {
      const textPart = mainText.slice(lastIndex).trim();
      if (textPart) splitTextAndTables(textPart, parts);
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

    // Render inline [IMG:url|source] tags as a horizontal image row
    const renderInlineImages = (imgTags: { url: string; source: string }[], lineIndex: number) => {
      const visibleInlineImages = imgTags.filter((img) => !failedInlineImages.has(img.url));
      if (visibleInlineImages.length === 0) return null;

      return (
        <div key={`inline-imgs-${lineIndex}`} className="flex gap-2 overflow-x-auto pb-2 my-2 overscroll-x-contain [touch-action:pan-x] [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          {visibleInlineImages.map((img, idx) => (
            <button
              key={`iimg-${lineIndex}-${idx}`}
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

    return lines.map((rawLine, lineIndex) => {
      const line = rawLine.trim();

      if (!line) return <div key={`space-${lineIndex}`} className="h-1.5" />;
      if (/^---+$/.test(line)) return <hr key={`hr-${lineIndex}`} className="my-3 border-0 border-t border-border/70" />;

      // Check if this line is an [IMG:url|source] tag
      const imgTagMatch = line.match(/^\[IMG:(https?:\/\/[^|\]]+)\|?([^\]]*)\]$/);
      if (imgTagMatch) {
        // Collect consecutive IMG tags
        const imgGroup: { url: string; source: string }[] = [{ url: imgTagMatch[1], source: imgTagMatch[2] || '' }];
        // Look ahead for more consecutive IMG tags (they'll be rendered when we hit the first one)
        let nextIdx = lineIndex + 1;
        while (nextIdx < lines.length) {
          const nextLine = lines[nextIdx].trim();
          const nextMatch = nextLine.match(/^\[IMG:(https?:\/\/[^|\]]+)\|?([^\]]*)\]$/);
          if (nextMatch) {
            imgGroup.push({ url: nextMatch[1], source: nextMatch[2] || '' });
            nextIdx++;
          } else {
            break;
          }
        }
        // Only render the group on the first IMG line; skip subsequent ones
        if (lineIndex === 0 || !lines[lineIndex - 1]?.trim().match(/^\[IMG:/)) {
          return renderInlineImages(imgGroup, lineIndex);
        }
        return null; // Skip, already rendered by the first IMG in the group
      }

      const markdownHeader = line.match(/^(#{1,3})\s+(.+)$/);
      if (markdownHeader) {
        const level = markdownHeader[1].length;
        const body = formatInline(markdownHeader[2]);
        const headerClass = level === 1 ? 'text-xl font-semibold mt-3' : level === 2 ? 'text-lg font-semibold mt-2.5' : 'text-base font-semibold mt-2';
        return <p key={`header-${lineIndex}`} className={headerClass} dangerouslySetInnerHTML={{ __html: body }} />;
      }

      const bulletMatch = line.match(/^[-•]\s+(.+)$/);
      if (bulletMatch) {
        return (
          <div key={`bullet-${lineIndex}`} className="my-1 grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2 pl-3 pr-1">
            <span className="pt-0.5 text-muted-foreground">•</span>
            <span className="min-w-0 text-[0.95rem] leading-7 text-foreground" dangerouslySetInnerHTML={{ __html: formatInline(bulletMatch[1]) }} />
          </div>
        );
      }

      const numberedMatch = line.match(/^(\d+)[\.)]\s+(.+)$/);
      if (numberedMatch) {
        return (
          <div key={`number-${lineIndex}`} className="my-1 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 pl-3 pr-1">
            <span className="pt-0.5 text-muted-foreground">{numberedMatch[1]}.</span>
            <span className="min-w-0 text-[0.95rem] leading-7 text-foreground" dangerouslySetInnerHTML={{ __html: formatInline(numberedMatch[2]) }} />
          </div>
        );
      }

      return (
        <p
          key={`paragraph-${lineIndex}`}
          className="my-1.5 text-[0.95rem] leading-7 text-foreground"
          dangerouslySetInnerHTML={{ __html: formatInline(rawLine) }}
        />
      );
    });
  };

  const isImageLike = (url: string) => {
    if (url.startsWith('data:image/')) return true;
    if (url.startsWith('storage:')) return url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i);
    return url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i) || (url.includes('supabase') && url.includes('storage'));
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
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(
        "px-4 py-4 group w-full overflow-x-clip",
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
                  <div className="relative">
                    <button
                      type="button"
                      className={cn(
                        "rounded-lg overflow-hidden border border-border bg-secondary cursor-pointer",
                        isUser ? "w-20 h-20" : "w-64 max-w-full"
                      )}
                      onClick={() => setPreviewImage(url)}
                    >
                      <img
                        src={url}
                        alt={`${!isUser ? 'Generated image' : 'Attachment'} ${index + 1}`}
                        className={cn(
                          "w-full h-full",
                          isUser ? "object-cover" : "object-contain max-h-72"
                        )}
                        onError={(e) => {
                          const target = e.currentTarget;
                          target.style.display = 'none';
                          target.parentElement!.innerHTML = '<div class="p-4 text-sm text-muted-foreground">Image failed to load</div>';
                        }}
                      />
                    </button>

                    {!isUser && (
                      <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2 rounded-lg">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewImage(url);
                          }}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="gap-1"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const response = await fetch(url);
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
                        >
                          <Download className="h-3 w-3" />
                          Save
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <a 
                    href={url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 transition-colors"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">View Attachment</span>
                  </a>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Image Preview Modal */}
        <ImagePreviewModal 
          isOpen={!!previewImage} 
          imageUrl={previewImage || ''} 
          onClose={() => setPreviewImage(null)} 
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
              <CodeBlock key={index} language={part.language || 'code'} code={part.content} />
            ) : part.type === 'table' && part.tableData ? (
              <TableBlock key={index} data={part.tableData} />
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
    </motion.div>
  );
};
