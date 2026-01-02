import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { Sidebar } from './Sidebar';
import { TypingIndicator } from './TypingIndicator';
import { useConversations, Message } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import xaiLogo from '@/assets/xai-logo.png';

// Memory extraction patterns
const MEMORY_PATTERNS = [
  { pattern: /my name is (\w+)/i, key: 'name' },
  { pattern: /i(?:'m| am) called (\w+)/i, key: 'name' },
  { pattern: /call me (\w+)/i, key: 'preferred_name' },
  { pattern: /i(?:'m| am) (?:a |an )?(\w+ ?\w*) (?:developer|engineer|designer|student|teacher|doctor|professional)/i, key: 'profession' },
  { pattern: /i work (?:at|for) (.+?)(?:\.|,|$)/i, key: 'workplace' },
  { pattern: /i(?:'m| am) from (.+?)(?:\.|,|$)/i, key: 'location' },
  { pattern: /i(?:'m| am) (\d+) years old/i, key: 'age' },
  { pattern: /i love (.+?)(?:\.|,|$)/i, key: 'interests' },
  { pattern: /my favorite (.+?) is (.+?)(?:\.|,|$)/i, key: 'favorite_$1' },
];

export const ChatContainer = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [profile, setProfile] = useState<{ full_name: string | null; avatar_url: string | null } | null>(null);
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
    renameConversation,
    startNewChat,
  } = useConversations();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  useEffect(() => {
    if (user) {
      fetchProfile();
    }
  }, [user]);

  const fetchProfile = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('full_name, avatar_url')
      .eq('user_id', user.id)
      .single();
    if (data) setProfile(data);
  };

  const extractAndSaveMemory = async (content: string) => {
    if (!user) return;

    for (const { pattern, key } of MEMORY_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        let memoryKey = key;
        let memoryValue = match[1];
        
        // Handle special case for "favorite X is Y"
        if (key.startsWith('favorite_') && match[2]) {
          memoryKey = `favorite_${match[1].toLowerCase().replace(/\s+/g, '_')}`;
          memoryValue = match[2];
        }

        try {
          // Upsert the memory
          const { error } = await supabase
            .from('user_memory')
            .upsert({
              user_id: user.id,
              key: memoryKey,
              value: memoryValue.trim(),
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'user_id,key'
            });

          if (!error) {
            console.log(`Memory saved: ${memoryKey} = ${memoryValue}`);
          }
        } catch (error) {
          console.error('Failed to save memory:', error);
        }
      }
    }
  };

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!user) return [];
    
    const urls: string[] = [];
    for (const file of files) {
      const fileName = `${user.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage
        .from('chat-files')
        .upload(fileName, file);

      if (!error) {
        const { data } = supabase.storage.from('chat-files').getPublicUrl(fileName);
        urls.push(data.publicUrl);
      }
    }
    return urls;
  };

  const handleSend = async (content: string, files?: File[]) => {
    if (!content.trim() && (!files || files.length === 0)) return;

    setIsLoading(true);
    setStreamingContent('');

    try {
      let convId = currentConversation?.id;
      if (!convId) {
        const newConv = await createConversation(content);
        if (!newConv) throw new Error('Failed to create conversation');
        convId = newConv.id;
      }

      let fileUrls: string[] = [];
      if (files && files.length > 0) {
        fileUrls = await uploadFiles(files);
      }

      // Extract and save memory from user message
      await extractAndSaveMemory(content);

      await addMessage(convId, 'user', content, fileUrls.length > 0 ? fileUrls : undefined);

      // Build messages with image URLs for the API
      const apiMessages = messages.map(m => ({
        role: m.role,
        content: m.content,
        imageUrls: m.file_urls?.filter(url => 
          url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i) || 
          (url.includes('supabase') && url.includes('storage'))
        )
      }));
      
      // Add current message
      apiMessages.push({
        role: 'user' as const,
        content,
        imageUrls: fileUrls.filter(url => 
          url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i) || 
          (url.includes('supabase') && url.includes('storage'))
        )
      });

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: apiMessages,
          fileContext: fileUrls.length > 0 ? `User uploaded ${fileUrls.length} file(s): ${fileUrls.map(url => {
            const isImage = url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i);
            return isImage ? 'image' : 'document';
          }).join(', ')}` : undefined,
          userId: user?.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get response');
      }

      if (!response.body) throw new Error('No response body');

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
      <div className="aurora-bg" />

      <Sidebar
        conversations={conversations}
        currentConversation={currentConversation}
        onSelectConversation={selectConversation}
        onNewChat={startNewChat}
        onDeleteConversation={deleteConversation}
        onRenameConversation={renameConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        profile={profile}
        onProfileUpdate={fetchProfile}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <motion.header 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-14 border-b border-border flex items-center px-4 gap-4 bg-background/50 backdrop-blur-sm"
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            className={sidebarOpen ? 'lg:hidden' : ''}
          >
            <Menu className="h-5 w-5" />
          </Button>
          
          <div className="flex items-center gap-2">
            <motion.div 
              className="w-6 h-6 rounded-full overflow-hidden"
              whileHover={{ scale: 1.1 }}
            >
              <img src={xaiLogo} alt="XAI" className="w-full h-full object-cover" />
            </motion.div>
            <span className="font-display font-semibold">
              {currentConversation?.title || 'New Chat'}
            </span>
          </div>
        </motion.header>

        <ScrollArea ref={scrollRef} className="flex-1">
          <AnimatePresence mode="wait">
            {displayMessages.length === 0 ? (
              <motion.div
                key="welcome"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <WelcomeScreen onSuggestionClick={handleSend} />
              </motion.div>
            ) : (
              <motion.div 
                key="messages"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-w-4xl mx-auto"
              >
                {displayMessages.map((msg, index) => (
                  <ChatMessage
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    isStreaming={msg.id === 'streaming'}
                    fileUrls={msg.file_urls}
                    userAvatar={profile?.avatar_url}
                    userName={profile?.full_name}
                  />
                ))}
                {isLoading && !streamingContent && <TypingIndicator />}
              </motion.div>
            )}
          </AnimatePresence>
        </ScrollArea>

        <ChatInput onSend={handleSend} isLoading={isLoading} disabled={!user} />
      </main>
    </div>
  );
};