import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ThumbsUp, ThumbsDown, Heart, Sparkles, FileText, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AudioPlayer } from './AudioPlayer';
import { resolveFileUrl } from '@/lib/storageRef';
import xaiLogo from '@/assets/xai-logo.png';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  fileUrls?: string[] | null;
  userAvatar?: string | null;
  userName?: string | null;
}

type Reaction = 'like' | 'dislike' | 'love' | 'sparkle' | null;

const reactionIcons = {
  like: ThumbsUp,
  dislike: ThumbsDown,
  love: Heart,
  sparkle: Sparkles,
};

export const ChatMessage = ({ role, content, isStreaming, fileUrls, userAvatar, userName }: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  const [reaction, setReaction] = useState<Reaction>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [showAudioPlayer, setShowAudioPlayer] = useState(false);
  const [resolvedFiles, setResolvedFiles] = useState<string[]>([]);
  const isUser = role === 'user';

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleReaction = (r: Reaction) => {
    setReaction(prev => prev === r ? null : r);
    setShowReactions(false);
  };

  // Simple markdown-like formatting
  const formatContent = (text: string) => {
    return text
      .split('\n')
      .map((line, i) => {
        // Code blocks
        if (line.startsWith('```')) {
          return null;
        }
        
        // Bold
        line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Italic
        line = line.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // Inline code
        line = line.replace(/`(.*?)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');
        // Headers
        if (line.startsWith('### ')) {
          line = `<h3 class="text-lg font-semibold mt-4 mb-2">${line.slice(4)}</h3>`;
        } else if (line.startsWith('## ')) {
          line = `<h2 class="text-xl font-semibold mt-4 mb-2">${line.slice(3)}</h2>`;
        } else if (line.startsWith('# ')) {
          line = `<h1 class="text-2xl font-bold mt-4 mb-2">${line.slice(2)}</h1>`;
        }
        // Lists
        if (line.startsWith('- ') || line.startsWith('• ')) {
          line = `<li class="ml-4">${line.slice(2)}</li>`;
        }
        if (/^\d+\.\s/.test(line)) {
          line = `<li class="ml-4 list-decimal">${line.slice(line.indexOf(' ') + 1)}</li>`;
        }
        
        return <span key={i} dangerouslySetInnerHTML={{ __html: line || '<br/>' }} />;
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
        "flex gap-3 px-4 py-4 group",
        isUser ? "flex-row-reverse" : "flex-row",
        isUser ? "bg-transparent" : "bg-muted/20"
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
      <div className={cn("flex-1 min-w-0 space-y-2", isUser ? "text-right" : "text-left")}>
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

        {/* File Attachments */}
        {resolvedFiles.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn("flex flex-wrap gap-2 my-2", isUser ? "justify-end" : "justify-start")}
          >
            {resolvedFiles.map((url, index) => (
              <motion.div 
                key={index} 
                className="relative"
                whileHover={{ scale: 1.02 }}
              >
                {isImageLike(url) ? (
                  <div className="w-48 max-w-full rounded-lg overflow-hidden border border-border bg-secondary">
                    <img 
                      src={url} 
                      alt={`Attachment ${index + 1}`} 
                      className="w-full h-auto max-h-64 object-contain"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        target.parentElement!.innerHTML = '<div class="p-4 text-sm text-muted-foreground">Image failed to load</div>';
                      }}
                    />
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

        <motion.div 
          className={cn(
            "text-foreground leading-relaxed whitespace-pre-wrap inline-block max-w-[85%]",
            isUser && "bg-secondary rounded-2xl rounded-tr-sm px-4 py-2"
          )}
          layout
        >
          {formatContent(content)}
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

        {/* Read receipt for user messages */}
        {isUser && !isStreaming && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-1 justify-end text-xs text-muted-foreground mt-1"
          >
            <Check className="h-3 w-3" />
            <span>Sent</span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};
