import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { Sidebar } from './Sidebar';
import { useConversations, Message } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const ChatContainer = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const {
    conversations,
    currentConversation,
    messages,
    selectConversation,
    createConversation,
    addMessage,
    deleteConversation,
    startNewChat,
    setMessages,
  } = useConversations();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!user) return [];
    
    const urls: string[] = [];
    for (const file of files) {
      const fileName = `${user.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage
        .from('chat-files')
        .upload(fileName, file);

      if (!error) {
        urls.push(fileName);
      }
    }
    return urls;
  };

  const handleSend = async (content: string, files?: File[]) => {
    if (!content.trim() && (!files || files.length === 0)) return;

    setIsLoading(true);
    setStreamingContent('');

    try {
      // Create conversation if needed
      let convId = currentConversation?.id;
      if (!convId) {
        const newConv = await createConversation(content);
        if (!newConv) {
          throw new Error('Failed to create conversation');
        }
        convId = newConv.id;
      }

      // Upload files if any
      let fileUrls: string[] = [];
      if (files && files.length > 0) {
        fileUrls = await uploadFiles(files);
      }

      // Add user message
      await addMessage(convId, 'user', content, fileUrls.length > 0 ? fileUrls : undefined);

      // Prepare messages for API
      const apiMessages = [
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content }
      ];

      // Stream response
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: apiMessages,
          fileContext: fileUrls.length > 0 ? `User uploaded ${fileUrls.length} file(s)` : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get response');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              setStreamingContent(fullContent);
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      // Save assistant message
      if (fullContent) {
        await addMessage(convId, 'assistant', fullContent);
      }
      setStreamingContent('');
    } catch (error) {
      console.error('Chat error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send message',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    handleSend(suggestion);
  };

  const displayMessages = [...messages];
  if (streamingContent) {
    displayMessages.push({
      id: 'streaming',
      conversation_id: currentConversation?.id || '',
      role: 'assistant',
      content: streamingContent,
      file_urls: null,
      created_at: new Date().toISOString(),
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Aurora Background */}
      <div className="aurora-bg" />

      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        currentConversation={currentConversation}
        onSelectConversation={selectConversation}
        onNewChat={startNewChat}
        onDeleteConversation={deleteConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-border flex items-center px-4 gap-4 bg-background/50 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            className={sidebarOpen ? 'lg:hidden' : ''}
          >
            <Menu className="h-5 w-5" />
          </Button>
          
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-xai-cyan to-xai-purple flex items-center justify-center">
              <span className="font-display font-bold text-xs text-primary-foreground">X</span>
            </div>
            <span className="font-display font-semibold">
              {currentConversation?.title || 'New Chat'}
            </span>
          </div>
        </header>

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1">
          {displayMessages.length === 0 ? (
            <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
          ) : (
            <div className="max-w-4xl mx-auto">
              {displayMessages.map((msg, index) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  isStreaming={msg.id === 'streaming'}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          disabled={!user}
        />
      </main>
    </div>
  );
};
