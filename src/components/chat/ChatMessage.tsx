import { motion } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import xaiLogo from '@/assets/xai-logo.png';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  fileUrls?: string[] | null;
  userAvatar?: string | null;
  userName?: string | null;
}

export const ChatMessage = ({ role, content, isStreaming, fileUrls, userAvatar, userName }: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  const isUser = role === 'user';

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "flex gap-4 px-4 py-6 group",
        isUser ? "flex-row-reverse" : "flex-row",
        isUser ? "bg-transparent" : "bg-muted/30"
      )}
    >
      {/* Avatar */}
      <div
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
          <img src={xaiLogo} alt="XAI" className="w-full h-full object-cover" />
        )}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0 space-y-2", isUser ? "text-right" : "text-left")}>
        <div className={cn("flex items-center gap-2", isUser ? "justify-end" : "justify-start")}>
          <span className="font-semibold text-sm">
            {isUser ? (userName || 'You') : 'XAI'}
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
        {fileUrls && fileUrls.length > 0 && (
          <div className={cn("flex flex-wrap gap-2", isUser ? "justify-end" : "justify-start")}>
            {fileUrls.map((url, index) => (
              <div key={index} className="w-32 h-32 rounded-lg overflow-hidden border border-border">
                <img 
                  src={url} 
                  alt={`Attachment ${index + 1}`} 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <div className={cn(
          "text-foreground leading-relaxed whitespace-pre-wrap inline-block max-w-[85%]",
          isUser && "bg-secondary rounded-2xl rounded-tr-sm px-4 py-2"
        )}>
          {formatContent(content)}
        </div>

        {/* Actions */}
        {!isUser && !isStreaming && content && (
          <div className={cn(
            "flex items-center gap-2 pt-2 opacity-0 group-hover:opacity-100 transition-opacity",
            isUser ? "justify-end" : "justify-start"
          )}>
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
          </div>
        )}
      </div>
    </motion.div>
  );
};
