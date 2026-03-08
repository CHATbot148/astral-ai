import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelLeft, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { Sidebar } from './Sidebar';
import { TypingIndicator } from './TypingIndicator';
import { VoiceCall } from './VoiceCall';
import { ImageGenerateDialog, ImageGenOptions } from './ImageGenerateDialog';
import { VideoGenerateDialog, VideoGenOptions } from './VideoGenerateDialog';
import { useConversations } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { makeStorageRef, resolveFileUrl } from '@/lib/storageRef';
import { cn } from '@/lib/utils';
import astrazLogo from '@/assets/astraz-logo.png';
import { getAISettings } from '@/lib/aiSettings';
import { parseReminderRequest } from '@/lib/reminderParser';
import { subscribeToPush } from '@/utils/pushSubscription';

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

export const ChatContainer = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingStyle, setStreamingStyle] = useState<string>('typewriter');
  const [profile, setProfile] = useState<{ full_name: string | null; avatar_url: string | null } | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [typingLabel, setTypingLabel] = useState<string | undefined>(undefined);
  const [typingMode, setTypingMode] = useState<'typing' | 'search'>('typing');
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState<string | null>(null);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [imageDialogPrompt, setImageDialogPrompt] = useState("");
  const [showVideoDialog, setShowVideoDialog] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const {
    conversations, currentConversation, messages,
    selectConversation, createConversation, addMessage,
    deleteMessagesFrom, deleteConversation, renameConversation, startNewChat,
  } = useConversations();

  useEffect(() => {
    if (currentConversation?.title) {
      document.title = `${currentConversation.title.slice(0, 15)} | Astraz`;
    } else {
      document.title = 'Astraz | Intelligent AI Assistant';
    }
  }, [currentConversation]);

  useEffect(() => {
    const root = scrollRef.current;
    const viewport = root?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;
    viewportRef.current = viewport;
    const scrollToBottom = () => { viewport.scrollTop = viewport.scrollHeight; };
    const updateAffordance = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setShowScrollToBottom(distance > 200);
    };
    updateAffordance();
    if (!showScrollToBottom) scrollToBottom();
    viewport.addEventListener('scroll', updateAffordance, { passive: true });
    return () => viewport.removeEventListener('scroll', updateAffordance);
  }, [messages, streamingContent]);

  useEffect(() => { if (user) fetchProfile(); }, [user]);

  const fetchProfile = async () => {
    if (!user) return;
    const { data } = await supabase.from('profiles').select('full_name, avatar_url').eq('user_id', user.id).single();
    if (!data) return;
    const resolvedAvatar = data.avatar_url ? await resolveFileUrl(data.avatar_url, { expiresIn: 60 * 60 * 24 * 7 }) : null;
    setProfile({ ...data, avatar_url: resolvedAvatar });
  };

  useEffect(() => {
    if (!user) return;

    const ensurePushSubscription = async () => {
      try {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('notifications_enabled, notification_preference')
          .eq('user_id', user.id)
          .single();

        if (!profileData?.notifications_enabled) return;
        if (profileData.notification_preference === 'email_only') return;
        if (Notification.permission === 'denied') return;

        await subscribeToPush(user.id);
      } catch (error) {
        console.warn('Push re-subscribe check failed:', error);
      }
    };

    ensurePushSubscription();
    window.addEventListener('focus', ensurePushSubscription);
    document.addEventListener('visibilitychange', ensurePushSubscription);

    return () => {
      window.removeEventListener('focus', ensurePushSubscription);
      document.removeEventListener('visibilitychange', ensurePushSubscription);
    };
  }, [user?.id]);

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
          await supabase.from('user_memory').upsert({
            user_id: user.id, key: memoryKey, value: memoryValue.trim(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,key' });
        } catch (error) {
          console.error('Failed to save memory:', error);
        }
      }
    }
  };

  const detectImageGenerationRequest = (content: string): string | null => {
    for (const pattern of IMAGE_GENERATION_PATTERNS) {
      const match = content.match(pattern);
      if (match && match[1]) return match[1].trim();
    }
    return null;
  };

  const isImageRequestLoose = (text: string) =>
    /(image|picture|photo|draw|generate|create|illustration|art)/i.test(text);

  const shouldTriggerWebGrounding = (text: string) => {
    const explicitSearch = /(search|look up|google|web search|find out|latest|current|news|breaking|happening|today|right now)/i.test(text);
    const factualQuestion = /^(who|what|when|where|why|how)\b/i.test(text.trim());
    const liveData = /(price|score|result|weather|stock|match|standings|headline|update)/i.test(text);
    return explicitSearch || factualQuestion || liveData;
  };

  const deriveSearchQueryLabel = (raw: string) => {
    const cleaned = raw.trim().replace(/^['"“”‘’`]+|['"“”‘’`]+$/g, '');

    const normalized = cleaned
      .replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:would\s+you\s+)?/i, '')
      .replace(/^(?:search|google|look\s*up|find\s*out|find|check|show\s+me)\s+(?:for\s+|up\s+|about\s+|on\s+|the\s+)?/i, '')
      .replace(/^(?:the\s+)?(?:images?|photos?|pictures?|videos?)\s+(?:of|for|about)\s+/i, '')
      .replace(/^(?:an?\s+)?(?:image|photo|picture|video)\s+(?:of|for|about)\s+/i, '')
      .replace(/\b(?:please|for\s+me|thanks?)\b/gi, '')
      .replace(/[?!.]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const label = normalized || cleaned;
    return label.length > 70 ? `${label.slice(0, 67)}…` : label;
  };

  // parseReminderRequest is now imported from @/lib/reminderParser

  const isAppInForeground = () => document.visibilityState === 'visible' && document.hasFocus();

  const generateImageWithOptions = async (opts: ImageGenOptions): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('generate-image', {
      body: { prompt: opts.prompt, style: opts.style, aspectRatio: opts.aspectRatio, referenceImageUrl: opts.referenceImageUrl, modelId: opts.modelId, appInForeground: isAppInForeground() },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.image ?? null;
  };

  const handleImageGenerate = async (opts: ImageGenOptions) => {
    let convId = currentConversation?.id;
    if (!convId) {
      const newConv = await createConversation(`Generate image: ${opts.prompt}`);
      if (!newConv) throw new Error('Failed to create conversation');
      convId = newConv.id;
    }
    await addMessage(convId, 'user', `Generate an image: ${opts.prompt}`);
    
    // Fire-and-forget: close dialog immediately, generate in background
    toast({ title: '🎨 Generating image in background', description: "You'll be notified when it's ready." });
    const capturedConvId = convId;
    
    // Run generation in background (don't await)
    (async () => {
      setIsGeneratingImage(true);
      setTypingLabel('Generating image…');
      try {
        const generatedImage = await generateImageWithOptions(opts);
        if (generatedImage) {
          await addMessage(capturedConvId, 'assistant', `Here's your image.`, [generatedImage]);
          toast({ title: '✅ Image ready!', description: opts.prompt.slice(0, 60) });
        } else {
          await addMessage(capturedConvId, 'assistant', `I couldn't generate that image. Please try again.`);
        }
      } catch (error) {
        await addMessage(capturedConvId, 'assistant', `I couldn't generate that image. ${error instanceof Error ? error.message : 'Please try again.'}`);
      } finally {
        setIsGeneratingImage(false);
        setTypingLabel(undefined);
      }
    })();
  };

  const handleVideoGenerate = async (opts: VideoGenOptions) => {
    let convId = currentConversation?.id;
    if (!convId) {
      const newConv = await createConversation(`Generate video: ${opts.prompt}`);
      if (!newConv) throw new Error('Failed to create conversation');
      convId = newConv.id;
    }
    await addMessage(convId, 'user', `Generate a video: ${opts.prompt}`);
    
    // Fire-and-forget: close dialog immediately, generate in background
    toast({ title: '🎬 Generating video in background', description: "You'll be notified when it's ready. This may take up to a minute." });
    const capturedConvId = convId;
    
    // Run generation in background (don't await)
    (async () => {
      setIsGeneratingVideo(true);
      setTypingLabel('Generating video…');
      try {
        const { data, error } = await supabase.functions.invoke('generate-video', {
          body: { prompt: opts.prompt, modelId: opts.modelId, duration: opts.duration, quality: opts.quality, appInForeground: isAppInForeground() },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (data?.video) {
          await addMessage(capturedConvId, 'assistant', `Here's your video.`, [data.video]);
          toast({ title: '✅ Video ready!', description: opts.prompt.slice(0, 60) });
        } else {
          await addMessage(capturedConvId, 'assistant', `I couldn't generate that video. Please try again.`);
        }
      } catch (error) {
        await addMessage(capturedConvId, 'assistant', `I couldn't generate that video. ${error instanceof Error ? error.message : 'Please try again.'}`);
      } finally {
        setIsGeneratingVideo(false);
        setTypingLabel(undefined);
      }
    })();
  };

  const handleEditMessage = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingMessageContent(content);
  };

  const clearEditState = () => {
    setEditingMessageId(null);
    setEditingMessageContent(null);
  };

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!user) return [];
    const refs: string[] = [];
    for (const file of files) {
      const fileName = `${user.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('chat-files').upload(fileName, file);
      if (!error) refs.push(makeStorageRef('chat-files', fileName));
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
    setIsGeneratingVideo(false);
    setTypingLabel(undefined);
    setTypingMode('typing');
  };

  const handleNotificationAction = async (action: 'accept' | 'cancel', data: any) => {
    if (!user || !currentConversation?.id) return;
    const convId = currentConversation.id;

    if (action === 'accept') {
      try {
        const pushSupported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
        if (pushSupported) {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            await subscribeToPush(user.id);
          }
        }
        // Always enable in DB for email fallback
        await supabase.from('profiles').update({ notifications_enabled: true }).eq('user_id', user.id);
      } catch (e) {
        console.error('Notification permission error:', e);
      }
    }

    // Schedule the reminder regardless
    try {
      const { error } = await supabase.functions.invoke('schedule-notification', {
        body: { message: data.message, scheduledFor: data.scheduledForISO, conversationId: convId, type: 'reminder' },
      });
      if (error) throw error;
      await addMessage(convId, 'assistant', `[REMINDER_SET] ⏰ Reminder set for ${data.displayTime}: "${data.message}"${action === 'cancel' ? ' (chat only, no push notification)' : ''}`);
    } catch (e) {
      toast({ title: 'Reminder failed', variant: 'destructive' });
    }
  };
  const appendFallbackSources = async (answer: string, query: string) => {
    const hasSourcesAlready = /\[sources?\]/i.test(answer) || /https?:\/\//i.test(answer);
    if (hasSourcesAlready) return answer;

    try {
      const { data, error } = await supabase.functions.invoke('web-search', {
        body: { query, type: 'web', count: 3 },
      });

      if (error || !Array.isArray(data?.results) || data.results.length === 0) {
        return answer;
      }

      const sourcesBlock = `\n\n[Sources]\n${data.results
        .slice(0, 3)
        .map((r: { title?: string; url: string }, index: number) => `${index + 1}. [${r.title || r.url}](${r.url})`)
        .join('\n')}`;

      return `${answer.trim()}${sourcesBlock}`;
    } catch {
      return answer;
    }
  };
  const stripRenderableDirectives = (value: string) => {
    return value
      .replace(/\[GENERATE_(?:IMAGE|VIDEO):[^\]]*\]?/gi, '')
      .replace(/\[GIF:[^\]]*\]?/gi, '')
      .replace(/\[VIDEO_CARD:[^\]]*\]?/gi, '')
      .replace(/!\[[^\]]*\]\((?:https?:\/\/|data:image\/|storage:)[^\)]*\)?/gi, '')
      .replace(/\n?https?:\/\/[^\s]*(?:giphy|tenor)[^\s]*/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const extractGenerationTag = (value: string): { type: 'image' | 'video'; prompt: string } | null => {
    const imageMatch = value.match(/\[GENERATE_IMAGE:([^\]]+)\]/);
    if (imageMatch?.[1]) return { type: 'image', prompt: imageMatch[1].trim() };

    const videoMatch = value.match(/\[GENERATE_VIDEO:([^\]]+)\]/);
    if (videoMatch?.[1]) return { type: 'video', prompt: videoMatch[1].trim() };

    return null;
  };

  const sanitizeAssistantMessage = (value: string) => {
    return value
      .split('\n')
      .filter((line) => !/^\s*:?max_bytes\(/i.test(line) && !/strip_icc\(\)/i.test(line))
      .join('\n')
      .replace(/\[GENERATE_(?:IMAGE|VIDEO):[^\]]*\]?/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const handleSend = async (content: string, files?: File[]) => {
    if (editingMessageId && currentConversation?.id) {
      const messageIndex = messages.findIndex(m => m.id === editingMessageId);
      if (messageIndex !== -1) {
        try {
          await deleteMessagesFrom(currentConversation.id, messageIndex);
        } catch (error) {
          console.error('Failed to delete messages for edit:', error);
          toast({ title: 'Edit failed', description: 'Could not revert messages.', variant: 'destructive' });
          clearEditState();
          return;
        }
      }
      clearEditState();
    }

    if (!content.trim() && (!files || files.length === 0)) return;

    setIsLoading(true);
    setStreamingContent('');
    setTypingLabel(undefined);
    setTypingMode('typing');
    abortControllerRef.current = new AbortController();
    let isInlineGenerationFlow = false;

    try {
      let convId = currentConversation?.id;
      if (!convId) {
        const newConv = await createConversation(content);
        if (!newConv) throw new Error('Failed to create conversation');
        convId = newConv.id;
      }

      let fileUrls: string[] = [];
      if (files && files.length > 0) fileUrls = await uploadFiles(files);

      await extractAndSaveMemory(content);
      await addMessage(convId, 'user', content, fileUrls.length > 0 ? fileUrls : undefined);

      // Reminders
      const reminder = user ? parseReminderRequest(content) : null;
      if (reminder && user) {
        // Check if notifications are enabled
        const { data: profileData } = await supabase
          .from('profiles')
          .select('notifications_enabled')
          .eq('user_id', user.id)
          .single();
        
        const notificationsEnabled = profileData?.notifications_enabled ?? false;

        if (!notificationsEnabled) {
          // Show approval prompt - store reminder data for later
          await addMessage(convId, 'assistant', 
            `[NOTIFICATION_PROMPT] ${JSON.stringify({ message: reminder.message, scheduledForISO: reminder.scheduledForISO, displayTime: reminder.displayTime, conversationId: convId })}`
          );
          setIsLoading(false);
          return;
        }

        const pushSupported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
        if (pushSupported) {
          // Re-ensure subscription in case old endpoints expired
          await subscribeToPush(user.id);
        }

        try {
          const { data, error } = await supabase.functions.invoke('schedule-notification', {
            body: { message: reminder.message, scheduledFor: reminder.scheduledForISO, conversationId: convId, type: 'reminder' },
          });
          if (error || data?.error) throw error || new Error(data?.error);
          await addMessage(convId, 'assistant', `[REMINDER_SET] ⏰ Reminder set for ${reminder.displayTime}: "${reminder.message}"`);
        } catch (e) {
          toast({ title: 'Reminder failed', description: e instanceof Error ? e.message : 'Please try again', variant: 'destructive' });
        } finally {
          setStreamingContent('');
          setIsGeneratingImage(false);
          setIsLoading(false);
        }
        return;
      }

      // Image generation intent — let the AI handle it conversationally
      // (no longer redirect to dialog; the AI will respond with [GENERATE_IMAGE:...] tag)

      // Build messages for the API
      const resolveUrls = async (urls?: string[] | null) => {
        if (!urls?.length) return [];
        return Promise.all(urls.map((u) => resolveFileUrl(u, { expiresIn: 60 * 60 })));
      };

      const resolvedFileUrls = await resolveUrls(fileUrls);
      const imageUrls = resolvedFileUrls.filter((url) =>
        url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i) || url.startsWith('data:image/')
      );
      const videoFileUrls = resolvedFileUrls.filter((url) =>
        url.match(/\.(mp4|webm|mov|avi)(\?.*)?$/i)
      );

      const apiMessages = await Promise.all(
        messages.map(async (m) => {
          const resolved = await resolveUrls(m.file_urls);
          return {
            role: m.role,
            content: m.content,
            imageUrls: m.role === 'user'
              ? resolved.filter((url) =>
                  url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i) || url.startsWith('data:image/')
                )
              : [],
            videoUrls: m.role === 'user'
              ? resolved.filter((url) =>
                  url.match(/\.(mp4|webm|mov|avi)(\?.*)?$/i)
                )
              : [],
          };
        })
      );

      apiMessages.push({
        role: 'user' as const,
        content,
        imageUrls,
        videoUrls: videoFileUrls,
      });

      const shouldWebSearch = shouldTriggerWebGrounding(content);
      const imageIntent = /(show me (?:an? )?(?:image|picture|photo)|what does .+ look like)/i.test(content);
      const videoIntent = /(show me (?:a )?video|video tutorial)/i.test(content);
      const hasUploadedVideoFiles = (files || []).some((file) => file.type.startsWith('video/'));
      const searchQuery = deriveSearchQueryLabel(content);
      const hasSearchQuery = searchQuery.length > 0;
      const isWebSearchState = (shouldWebSearch || imageIntent || videoIntent) && !hasUploadedVideoFiles && hasSearchQuery;
      setTypingMode(isWebSearchState ? 'search' : 'typing');
      setTypingLabel(
        hasUploadedVideoFiles
          ? 'Reviewing video…'
          : isWebSearchState
            ? `Searching for ${searchQuery}`
            : undefined
      );

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
          fileContext: fileUrls.length > 0
            ? `User uploaded ${fileUrls.length} file(s): ${fileUrls.map((url) => url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i) ? 'image' : 'document').join(', ')}`
            : undefined,
          userId: user?.id,
          forceWebSearch: shouldWebSearch,
          webSearchQuery: searchQuery,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientTimeISO: new Date().toISOString(),
          aiMode: getAISettings().mode,
          followUpQuestions: getAISettings().followUpQuestions,
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
      const settings = getAISettings();
      const showTyping = settings.typingAnimation;
      const typingStyle = settings.typingStyle || 'typewriter';
      setStreamingStyle(typingStyle);

      // Queues for animated styles
      let charQueue: string[] = [];
      let wordQueue: string[] = [];
      let displayedContent = '';
      let animInterval: ReturnType<typeof setInterval> | null = null;
      let generationDirective: { type: 'image' | 'video'; prompt: string } | null = null;

      if (showTyping && typingStyle === 'typewriter') {
        animInterval = setInterval(() => {
          const batch = charQueue.splice(0, 3);
          if (batch.length > 0) {
            displayedContent += batch.join('');
            setStreamingContent(displayedContent);
          }
        }, 15);
      }

      if (showTyping && typingStyle === 'word_by_word') {
        animInterval = setInterval(() => {
          if (wordQueue.length > 0) {
            const nextWord = wordQueue.shift()!;
            displayedContent += nextWord;
            setStreamingContent(displayedContent);
          }
        }, 60);
      }

      // line_fade & slide_down: we stream full content but ChatMessage handles per-line animation
      // normal: stream full content directly (ChatGPT-like)

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

              if (!generationDirective) {
                generationDirective = extractGenerationTag(fullContent);
                if (generationDirective) {
                  isInlineGenerationFlow = true;
                  setStreamingContent('');
                  setTypingMode('typing');
                  if (generationDirective.type === 'image') {
                    setIsGeneratingImage(true);
                    setTypingLabel('Generating image…');
                  } else {
                    setIsGeneratingVideo(true);
                    setTypingLabel('Generating video…');
                  }
                }
              }

              if (generationDirective) continue;

              const visibleContent = stripRenderableDirectives(fullContent);

              if (showTyping) {
                if (typingStyle === 'typewriter') {
                  const safeDelta = visibleContent.slice(displayedContent.length);
                  if (safeDelta) charQueue.push(...safeDelta.split(''));
                } else if (typingStyle === 'word_by_word') {
                  const safeDelta = visibleContent.slice(displayedContent.length);
                  if (safeDelta) {
                    const words = safeDelta.match(/\S+\s*/g) || [safeDelta];
                    wordQueue.push(...words);
                  }
                } else {
                  setStreamingContent(visibleContent);
                }
              } else {
                setStreamingContent(visibleContent);
              }
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      // Flush remaining queues
      if (animInterval) {
        clearInterval(animInterval);
        if (charQueue.length > 0) displayedContent += charQueue.join('');
        if (wordQueue.length > 0) displayedContent += wordQueue.join('');
      }
      setStreamingContent('');

      if (fullContent) {
        const finalDirective = generationDirective ?? extractGenerationTag(fullContent);

        if (finalDirective?.type === 'image') {
          isInlineGenerationFlow = true;
          const capturedConvId = convId;
          const imgPrompt = finalDirective.prompt;

          setIsGeneratingImage(true);
          setTypingLabel('Generating image…');
          setTypingMode('typing');

          (async () => {
            try {
              // Use the first uploaded image as a reference if available
              const referenceImageUrl = imageUrls.length > 0 ? imageUrls[0] : undefined;
              const generatedImage = await generateImageWithOptions({ 
                prompt: imgPrompt, 
                style: 'photoreal', 
                aspectRatio: '1:1', 
                quality: 'balanced',
                referenceImageUrl,
              });
              if (generatedImage) {
                await addMessage(capturedConvId, 'assistant', `Here's your image.`, [generatedImage]);
              } else {
                await addMessage(capturedConvId, 'assistant', `I couldn't generate that image. Please try again.`);
              }
            } catch (error) {
              await addMessage(capturedConvId, 'assistant', `Image generation failed. ${error instanceof Error ? error.message : 'Please try again.'}`);
            } finally {
              setIsGeneratingImage(false);
              setTypingLabel(undefined);
            }
          })();
        } else if (finalDirective?.type === 'video') {
          isInlineGenerationFlow = true;
          const capturedConvId = convId;
          const vidPrompt = finalDirective.prompt;

          setIsGeneratingVideo(true);
          setTypingLabel('Generating video…');
          setTypingMode('typing');

          (async () => {
            try {
              const { data, error } = await supabase.functions.invoke('generate-video', {
                body: { prompt: vidPrompt, modelId: 'sora_2', appInForeground: isAppInForeground() },
              });
              if (error) throw error;
              if (data?.error) throw new Error(data.error);
              if (data?.video) {
                await addMessage(capturedConvId, 'assistant', `Here's your video.`, [data.video]);
              } else {
                await addMessage(capturedConvId, 'assistant', `I couldn't generate that video. Please try again.`);
              }
            } catch (error) {
              await addMessage(capturedConvId, 'assistant', `Video generation failed. ${error instanceof Error ? error.message : 'Please try again.'}`);
            } finally {
              setIsGeneratingVideo(false);
              setTypingLabel(undefined);
            }
          })();
        } else {
          const gifMatches = fullContent.matchAll(/\[GIF:([^\]]+)\]/g);
          let processedContent = fullContent;
          for (const match of gifMatches) {
            const keyword = match[1].trim();
            try {
              const gifResponse = await supabase.functions.invoke('fetch-gif', { body: { query: keyword, limit: 1 } });
              if (gifResponse.data?.gifs?.[0]?.url) {
                processedContent = processedContent.replace(match[0], `\n\n![${keyword}](${gifResponse.data.gifs[0].url})\n\n`);
              } else {
                processedContent = processedContent.replace(match[0], '');
              }
            } catch {
              processedContent = processedContent.replace(match[0], '');
            }
          }

          if (shouldWebSearch) {
            processedContent = await appendFallbackSources(processedContent, searchQuery);
          }

          processedContent = sanitizeAssistantMessage(processedContent);
          await addMessage(convId, 'assistant', processedContent);
        }
      }
      setStreamingContent('');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (streamingContent) {
          const convId = currentConversation?.id;
          if (convId) await addMessage(convId, 'assistant', streamingContent + '... [stopped]');
        }
        setStreamingContent('');
        setTypingLabel(undefined);
        return;
      }
      console.error('Chat error:', error);
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to send message', variant: 'destructive' });
      setTypingLabel(undefined);
    } finally {
      setIsLoading(false);
      if (!isInlineGenerationFlow) {
        setTypingLabel(undefined);
        setIsGeneratingImage(false);
        setIsGeneratingVideo(false);
      }
      setTypingMode('typing');
      abortControllerRef.current = null;
    }
  };

  const openImageDialog = (prefill?: string) => {
    setImageDialogPrompt(prefill?.trim() || '');
    setShowImageDialog(true);
  };

  const openVideoDialog = () => {
    setShowVideoDialog(true);
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
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <div className="aurora-bg" />
      <AnimatePresence>
        {showVoiceCall && <VoiceCall onClose={() => setShowVoiceCall(false)} />}
      </AnimatePresence>

      <ImageGenerateDialog open={showImageDialog} onOpenChange={setShowImageDialog} onGenerate={handleImageGenerate} initialPrompt={imageDialogPrompt} />
      <VideoGenerateDialog open={showVideoDialog} onOpenChange={setShowVideoDialog} onGenerate={handleVideoGenerate} />

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
        <div className="absolute top-3 left-3 z-20">
          <Button variant="secondary" size="icon" onClick={() => setSidebarOpen(true)}
            className={cn("rounded-full", sidebarOpen ? 'lg:hidden' : '')} aria-label="Open sidebar">
            <PanelLeft className="h-5 w-5" />
          </Button>
        </div>

        <ScrollArea ref={scrollRef} className="flex-1">
          <AnimatePresence mode="wait">
            {displayMessages.length === 0 ? (
              <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-14 lg:pt-4">
                <WelcomeScreen onSuggestionClick={handleSend} onGenerateImage={() => openImageDialog()} />
              </motion.div>
            ) : (
              <motion.div key="messages" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto pt-14 lg:pt-4">
                {displayMessages.map((msg) => {
                  const userMessages = displayMessages.filter(m => m.role === 'user');
                  const userMsgIndex = userMessages.findIndex(m => m.id === msg.id);
                  const canEdit = msg.role === 'user' && userMsgIndex >= userMessages.length - 3;
                  return (
                    <ChatMessage key={msg.id} role={msg.role} content={msg.content} isStreaming={msg.id === 'streaming'}
                      streamingStyle={msg.id === 'streaming' ? streamingStyle : undefined}
                      fileUrls={msg.file_urls} userAvatar={profile?.avatar_url} userName={profile?.full_name}
                      onEdit={canEdit ? (content: string) => handleEditMessage(msg.id, content) : undefined} canEdit={canEdit}
                      onNotificationAction={handleNotificationAction} />
                  );
                })}
                {isLoading && !streamingContent && !isGeneratingImage && !isGeneratingVideo && (
                  <TypingIndicator label={typingLabel} mode={typingMode} />
                )}
                {(isGeneratingImage || isGeneratingVideo) && (
                  <div className="flex items-center gap-3 px-6 py-4">
                    <motion.span className="text-xai-cyan font-medium" animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
                      {isGeneratingVideo ? '🎬 Generating video...' : '🎨 Generating image...'}
                    </motion.span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </ScrollArea>

        <AnimatePresence>
          {showScrollToBottom && (
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} className="fixed right-4 bottom-24 z-30">
              <Button variant="secondary" size="icon" className="rounded-full shadow-lg"
                onClick={() => { const viewport = viewportRef.current; if (viewport) viewport.scrollTop = viewport.scrollHeight; }}
                aria-label="Scroll to bottom">
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
          editValue={editingMessageContent}
          onClearEdit={clearEditState}
          onStartCall={user ? () => setShowVoiceCall(true) : undefined}
          onOpenImageDialog={openImageDialog}
          onOpenVideoDialog={openVideoDialog}
        />
      </main>
    </div>
  );
};
