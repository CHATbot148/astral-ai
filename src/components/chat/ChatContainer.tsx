import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { Sidebar } from './Sidebar';
import { TypingIndicator } from './TypingIndicator';
import { VoiceCall } from './VoiceCall';
import { useConversations } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { makeStorageRef, resolveFileUrl } from '@/lib/storageRef';
import { cn } from '@/lib/utils';
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

// Image generation detection patterns
const IMAGE_GENERATION_PATTERNS = [
  /generate (?:an? )?image (?:of |showing |with )?(.+)/i,
  /create (?:an? )?image (?:of |showing |with )?(.+)/i,
  /make (?:me )?(?:an? )?(?:image|picture|photo) (?:of |showing |with )?(.+)/i,
  /draw (?:me )?(?:an? )?(?:image|picture) (?:of |showing |with )?(.+)/i,
  /(?:can you |please )?(?:generate|create|make|draw) (?:an? )?(?:image|picture|photo) (?:of |showing |with |for )?(.+)/i,
];

// Declare puter global type
declare global {
  interface Window {
    puter?: {
      ai: {
        txt2img: (prompt: string, options?: { model?: string }) => Promise<HTMLImageElement>;
      };
    };
  }
}

export const ChatContainer = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [profile, setProfile] = useState<{ full_name: string | null; avatar_url: string | null } | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
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

  // Update document title based on current conversation
  useEffect(() => {
    if (currentConversation?.title) {
      document.title = `${currentConversation.title.slice(0, 15)} | X-AI`;
    } else {
      document.title = 'X-AI | Intelligent Assistant';
    }
  }, [currentConversation]);

  useEffect(() => {
    const root = scrollRef.current;
    const viewport = root?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;

    viewportRef.current = viewport;

    const scrollToBottom = () => {
      viewport.scrollTop = viewport.scrollHeight;
    };

    const updateAffordance = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setShowScrollToBottom(distance > 200);
    };

    updateAffordance();
    if (!showScrollToBottom) scrollToBottom();

    viewport.addEventListener('scroll', updateAffordance, { passive: true });
    return () => viewport.removeEventListener('scroll', updateAffordance);
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

    if (!data) return;

    const resolvedAvatar = data.avatar_url
      ? await resolveFileUrl(data.avatar_url, { expiresIn: 60 * 60 * 24 * 7 })
      : null;

    setProfile({ ...data, avatar_url: resolvedAvatar });
  };

  const extractAndSaveMemory = async (content: string) => {
    if (!user) return;

    for (const { pattern, key } of MEMORY_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        let memoryKey = key;
        let memoryValue = match[1];
        
        if (key.startsWith('favorite_') && match[2]) {
          memoryKey = `favorite_${match[1].toLowerCase().replace(/\s+/g, '_')}`;
          memoryValue = match[2];
        }

        try {
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

  const detectImageGenerationRequest = (content: string): string | null => {
    for (const pattern of IMAGE_GENERATION_PATTERNS) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return null;
  };

  const parseReminderRequest = (text: string): { message: string; scheduledForISO: string } | null => {
    // Supports: "remind me to X in 10 minutes" / "set a reminder for X in 2 hours"
    const m = text.match(/(?:remind me|set a reminder|notify me|message me)(?:\s+(?:to|about|for))?\s+(.+?)\s+in\s+(\d+)\s+(minute|minutes|hour|hours|day|days)\b/i);
    if (!m) return null;

    const message = m[1].trim();
    const amount = Number(m[2]);
    const unit = m[3].toLowerCase();
    if (!message || !Number.isFinite(amount) || amount <= 0) return null;

    const ms =
      unit.startsWith('minute') ? amount * 60_000 :
      unit.startsWith('hour') ? amount * 3_600_000 :
      amount * 86_400_000;

    const scheduledForISO = new Date(Date.now() + ms).toISOString();
    return { message, scheduledForISO };
  };

  const generateImage = async (prompt: string): Promise<string | null> => {
    // Try Puter.js first (free, user-pays model)
    if (window.puter?.ai) {
      try {
        console.log('Attempting Puter.js image generation...');
        const imgElement = await window.puter.ai.txt2img(prompt, { 
          model: 'stable-diffusion-3-medium' 
        });
        
        // Convert image element to data URL
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.width || 512;
        canvas.height = imgElement.height || 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to create canvas context');
        
        ctx.drawImage(imgElement, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        
        // Upload to storage
        const { data, error } = await supabase.functions.invoke('generate-image', {
          body: { prompt, imageDataUrl: dataUrl },
        });
        
        if (!error && data?.image) {
          console.log('Puter.js generation successful');
          return data.image;
        }
        
        // Return data URL if storage upload fails
        return dataUrl;
      } catch (puterError) {
        console.log('Puter.js failed, falling back to server:', puterError);
      }
    }

    // Fallback to server-side generation (Stability AI / Lovable AI)
    try {
      console.log('Attempting server-side image generation...');
      const { data, error } = await supabase.functions.invoke('generate-image', {
        body: { prompt },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      console.log('Server-side generation successful');
      return data?.image ?? null;
    } catch (serverError) {
      console.error('Server image generation error:', serverError);
      toast({
        title: 'Image generation failed',
        description: serverError instanceof Error ? serverError.message : 'Please try again',
        variant: 'destructive',
      });
      return null;
    }
  };

  const handleEditMessage = (content: string) => {
    setEditingMessage(content);
  };

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!user) return [];

    const refs: string[] = [];
    for (const file of files) {
      const fileName = `${user.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('chat-files').upload(fileName, file);

      if (!error) {
        refs.push(makeStorageRef('chat-files', fileName));
      }
    }

    return refs;
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setIsGeneratingImage(false);
  };

  const handleSend = async (content: string, files?: File[]) => {
    if (!content.trim() && (!files || files.length === 0)) return;

    setIsLoading(true);
    setStreamingContent('');
    setIsSearching(false);
    abortControllerRef.current = new AbortController();

    try {
      let convId = currentConversation?.id;
      if (!convId) {
        // createConversation will generate a smart title from the full first message
        const newConv = await createConversation(content);
        if (!newConv) throw new Error('Failed to create conversation');
        convId = newConv.id;
      }

      let fileUrls: string[] = [];
      if (files && files.length > 0) {
        fileUrls = await uploadFiles(files);
      }

      await extractAndSaveMemory(content);
      await addMessage(convId, 'user', content, fileUrls.length > 0 ? fileUrls : undefined);

      // Lightweight reminders (no AI parsing): "in X minutes/hours/days"
      const reminder = user ? parseReminderRequest(content) : null;
      if (reminder && user) {
        try {
          const { data, error } = await supabase.functions.invoke('schedule-notification', {
            body: {
              userId: user.id,
              message: reminder.message,
              scheduledFor: reminder.scheduledForISO,
              conversationId: convId,
              type: 'reminder',
            },
          });

          if (error || data?.error) throw error || new Error(data?.error);

          await addMessage(
            convId,
            'assistant',
            `✅ Got it — I’ll remind you about "${reminder.message}" in a bit.`
          );
        } catch (e) {
          toast({
            title: 'Reminder failed',
            description: e instanceof Error ? e.message : 'Please try again',
            variant: 'destructive',
          });
        } finally {
          setStreamingContent('');
          setIsGeneratingImage(false);
          setIsLoading(false);
        }
        return;
      }

      // Check if this is an image generation request
      const imagePrompt = detectImageGenerationRequest(content);

      if (imagePrompt) {
        setIsGeneratingImage(true);
        setStreamingContent('🎨 Generating image...');

        const generatedImage = await generateImage(imagePrompt);

        if (generatedImage) {
          await addMessage(convId, 'assistant', `Here's the image I generated for "${imagePrompt}":`, [generatedImage]);
        } else {
          await addMessage(convId, 'assistant', "I'm sorry, I couldn't generate that image. Please try again with a different prompt.");
        }

        setStreamingContent('');
        setIsGeneratingImage(false);
        setIsLoading(false);
        return;
      }

      // Build messages for the API
      const resolveUrls = async (urls?: string[] | null) => {
        if (!urls?.length) return [];
        return Promise.all(urls.map((u) => resolveFileUrl(u, { expiresIn: 60 * 60 })));
      };

      const apiMessages = await Promise.all(
        messages.map(async (m) => ({
          role: m.role,
          content: m.content,
          imageUrls:
            m.role === 'user'
              ? (await resolveUrls(m.file_urls)).filter((url) =>
                  url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i) || url.startsWith('data:image/')
                )
              : [],
        }))
      );

      apiMessages.push({
        role: 'user' as const,
        content,
        imageUrls: (await resolveUrls(fileUrls)).filter((url) =>
          url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i) || url.startsWith('data:image/')
        ),
      });

      // Detect search/media intent to show a "Searching..." animation
      const searchIntent = /(search (?:for |the web for |online for )|look up |google |latest news|what(?:'s| is) happening)/i.test(content);
      const imageIntent = /(show me (?:an? )?(?:image|picture|photo)|what does .+ look like)/i.test(content);
      const videoIntent = /(show me (?:a )?video|video tutorial)/i.test(content);
      setIsSearching(searchIntent || imageIntent || videoIntent);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: apiMessages,
          fileContext:
            fileUrls.length > 0
              ? `User uploaded ${fileUrls.length} file(s): ${fileUrls
                  .map((url) => {
                    const isImage = url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i);
                    return isImage ? 'image' : 'document';
                  })
                  .join(', ')}`
              : undefined,
          userId: user?.id,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientTimeISO: new Date().toISOString(),
        }),
        signal: abortControllerRef.current?.signal,
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
      if (error instanceof Error && error.name === 'AbortError') {
        // User stopped generation
        if (streamingContent) {
          const convId = currentConversation?.id;
          if (convId) {
            await addMessage(convId, 'assistant', streamingContent + '... [stopped]');
          }
        }
        setStreamingContent('');
        return;
      }
      
      console.error('Chat error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send message',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setIsSearching(false);
      setIsGeneratingImage(false);
      abortControllerRef.current = null;
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

      <AnimatePresence>
        {showVoiceCall && (
          <VoiceCall onClose={() => setShowVoiceCall(false)} />
        )}
      </AnimatePresence>

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
        {/* Floating sidebar button */}
        <div className="absolute top-3 left-3 z-20">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            className={cn("rounded-full", sidebarOpen ? 'lg:hidden' : '')}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>

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
                {displayMessages.map((msg, index) => {
                  // Only allow editing last 3 user messages
                  const userMessages = displayMessages.filter(m => m.role === 'user');
                  const userMsgIndex = userMessages.findIndex(m => m.id === msg.id);
                  const canEdit = msg.role === 'user' && userMsgIndex >= userMessages.length - 3;
                  
                  return (
                    <ChatMessage
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                      isStreaming={msg.id === 'streaming'}
                      fileUrls={msg.file_urls}
                      userAvatar={profile?.avatar_url}
                      userName={profile?.full_name}
                      onEdit={canEdit ? handleEditMessage : undefined}
                      canEdit={canEdit}
                    />
                  );
                })}
                {isLoading && !streamingContent && !isGeneratingImage && (
                  <TypingIndicator label={isSearching ? 'Searching the web…' : undefined} />
                )}
                {isGeneratingImage && (
                  <div className="flex items-center gap-3 px-6 py-4">
                    <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                      <img src={xaiLogo} alt="X-AI" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex items-center gap-2">
                      <motion.span
                        className="text-xai-cyan font-medium"
                        animate={{ opacity: [1, 0.5, 1] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      >
                        🎨 Generating image...
                      </motion.span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </ScrollArea>

        {/* Scroll-to-bottom affordance */}
        <AnimatePresence>
          {showScrollToBottom && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              className="fixed right-4 bottom-24 z-30"
            >
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full shadow-lg"
                onClick={() => {
                  const viewport = viewportRef.current;
                  if (viewport) viewport.scrollTop = viewport.scrollHeight;
                }}
                aria-label="Scroll to bottom"
              >
                <ArrowDown className="h-5 w-5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <ChatInput 
          onSend={handleSend} 
          isLoading={isLoading} 
          disabled={!user}
          onStop={isLoading ? stopGeneration : undefined}
          editValue={editingMessage}
          onClearEdit={() => setEditingMessage(null)}
          onStartCall={user ? () => setShowVoiceCall(true) : undefined}
        />
      </main>
    </div>
  );
};
