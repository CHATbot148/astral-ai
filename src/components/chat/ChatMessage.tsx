import { motion } from 'framer-motion';
import { User, Sparkles, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export const ChatMessage = ({ role, content, isStreaming }: ChatMessageProps) => {
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
        isUser ? "bg-transparent" : "bg-muted/30"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
          isUser
            ? "bg-secondary"
            : "bg-gradient-to-br from-xai-cyan to-xai-purple xai-glow"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-foreground" />
        ) : (
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">
            {isUser ? 'You' : 'XAI'}
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

        <div className="text-foreground leading-relaxed whitespace-pre-wrap">
          {formatContent(content)}
        </div>

        {/* Actions */}
        {!isUser && !isStreaming && content && (
          <div className="flex items-center gap-2 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
