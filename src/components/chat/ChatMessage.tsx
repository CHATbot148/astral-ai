import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ThumbsUp, ThumbsDown, Heart, Sparkles, FileText, Volume2, Download, Pencil } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AudioPlayer } from './AudioPlayer';
import { ImagePreviewModal } from './ImagePreviewModal';
import { resolveFileUrl } from '@/lib/storageRef';
import { useToast } from '@/hooks/use-toast';
import xaiLogo from '@/assets/xai-logo.png';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  fileUrls?: string[] | null;
  userAvatar?: string | null;
  userName?: string | null;
  onEdit?: (content: string) => void;
  canEdit?: boolean;
}

type Reaction = 'like' | 'dislike' | 'love' | 'sparkle' | null;

const reactionIcons = {
  like: ThumbsUp,
  dislike: ThumbsDown,
  love: Heart,
  sparkle: Sparkles,
};

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

export const ChatMessage = ({ role, content, isStreaming, fileUrls, userAvatar, userName, onEdit, canEdit = true }: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  const [reaction, setReaction] = useState<Reaction>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [showAudioPlayer, setShowAudioPlayer] = useState(false);
  const [resolvedFiles, setResolvedFiles] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
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

  // Parse content into parts (text, code blocks, links)
  const parsedContent = useMemo(() => {
    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    
    let lastIndex = 0;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
      }
      parts.push({ 
        type: 'code', 
        language: match[1] || 'code', 
        content: match[2].trim() 
      });
      lastIndex = match.index + match[0].length;
    }
    
    if (lastIndex < content.length) {
      parts.push({ type: 'text', content: content.slice(lastIndex) });
    }
    
    return parts;
  }, [content]);

  // Format text with markdown-like features
  const formatText = (text: string) => {
    const lines = text.split('\n');
    
    return lines.map((line, lineIndex) => {
      line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      line = line.replace(/\*(.*?)\*/g, '<em>$1</em>');
      line = line.replace(/`([^`]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');
      
      line = line.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, 
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-xai-cyan hover:underline inline-flex items-center gap-1">$1<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>'
      );
      
      line = line.replace(
        /(?<!\])\((https?:\/\/[^\s\)]+)\)|(?<!["\(])(https?:\/\/[^\s<]+)(?!["\)])/g,
        (match, p1, p2) => {
          const url = p1 || p2;
          if (!url) return match;
          return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-xai-cyan hover:underline inline-flex items-center gap-1">${url}<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>`;
        }
      );
      
      if (line.startsWith('### ')) {
        line = `<h3 class="text-lg font-semibold mt-4 mb-2">${line.slice(4)}</h3>`;
      } else if (line.startsWith('## ')) {
        line = `<h2 class="text-xl font-semibold mt-4 mb-2">${line.slice(3)}</h2>`;
      } else if (line.startsWith('# ')) {
        line = `<h1 class="text-2xl font-bold mt-4 mb-2">${line.slice(2)}</h1>`;
      }
      
      if (line.startsWith('- ') || line.startsWith('• ')) {
        line = `<li class="ml-4 list-disc">${line.slice(2)}</li>`;
      }
      
      const numberedMatch = line.match(/^(\d+)\.\s(.+)/);
      if (numberedMatch) {
        line = `<li class="ml-4 list-decimal" value="${numberedMatch[1]}">${numberedMatch[2]}</li>`;
      }
      
      return <span key={lineIndex} dangerouslySetInnerHTML={{ __html: line || '<br/>' }} />;
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
        "flex gap-3 px-4 py-4 group w-full",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Avatar */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden",
          isUser
            ? "bg-secondary"
            : "bg-gradient-to-br from-xai-cyan to-xai-purple xai-glow"
        )}
      >
        {isUser ? (
          userAvatar ? (
            <img src={userAvatar} alt="User" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-semibold">
              {userName?.[0]?.toUpperCase() || 'U'}
            </span>
          )
        ) : (
          <img src={xaiLogo} alt="X-AI" className="w-full h-full object-cover" />
        )}
      </motion.div>

      {/* Content */}
      <div className={cn(
        "flex-1 min-w-0 space-y-2 overflow-hidden",
        isUser ? "text-right" : "text-left"
      )}>
        <div className={cn("flex items-center gap-2", isUser ? "justify-end" : "justify-start")}>
          <span className="font-semibold text-sm">
            {isUser ? (userName || 'You') : 'X-AI'}
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
                              a.download = `x-ai-image-${Date.now()}.png`;
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

        <motion.div 
          className={cn(
            "text-foreground leading-relaxed inline-block",
            isUser ? "bg-secondary rounded-2xl rounded-tr-sm px-4 py-2 max-w-[85%] break-words" : "max-w-full"
          )}
          layout
        >
          {parsedContent.map((part, index) => 
            part.type === 'code' ? (
              <CodeBlock key={index} language={part.language || 'code'} code={part.content} />
            ) : (
              <div key={index} className="whitespace-pre-wrap break-words">{formatText(part.content)}</div>
            )
          )}
        </motion.div>

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
