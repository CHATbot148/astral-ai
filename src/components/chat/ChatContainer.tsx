import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelLeft, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { WelcomeScreen, WELCOME_SHORTCUTS } from './WelcomeScreen';
import { Sidebar } from './Sidebar';
import { TypingIndicator } from './TypingIndicator';
import { VoiceCall, type VoiceCallHandle } from './VoiceCall';
import { ChatHeader } from './ChatHeader';

import { ImageGenerateDialog, ImageGenOptions } from './ImageGenerateDialog';
import { VideoGenerateDialog, VideoGenOptions } from './VideoGenerateDialog';
import { useConversations } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { makeStorageRef, resolveFileUrl } from '@/lib/storageRef';
import { cn } from '@/lib/utils';
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

const VIDEO_GENERATION_PATTERNS = [
  /generate (?:a )?(?:video|clip|animation) (?:of |showing |with )?(.+)/i,
  /create (?:a )?(?:video|clip|animation) (?:of |showing |with )?(.+)/i,
  /make (?:me )?(?:a )?(?:video|clip|animation) (?:of |showing |with )?(.+)/i,
  /(?:can you |please )?(?:generate|create|make) (?:a )?(?:video|clip|animation) (?:of |showing |with |for )?(.+)/i,
];

// Emoji regex for stripping from search queries
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

const IMAGE_FILE_URL_PATTERN = /\.(?:jpe?g|png|gif|webp|svg|bmp|avif|heic|heif)(\?.*)?$/i;
const VIDEO_FILE_URL_PATTERN = /\.(?:mp4|webm|mov|avi|mkv|m4v)(\?.*)?$/i;
const VISUAL_TOPIC_HINT_PATTERN = /\b(cars?|super\s*cars?|hyper\s*cars?|animals?|breeds?|foods?|dishes?|cuisines?|buildings?|cities?|countries?|places?|phones?|laptops?|sneakers?|shoes?|watches?|fashion|outfits?|hotels?|resorts?|yachts?|motorcycles?|bikes?)\b/i;
const VISUAL_INLINE_REQUEST_PATTERN = /\b(show|display|see|look(?:\s+like)?|images?|photos?|pictures?|gallery|visual(?:ize|ise)?|what does .+ look like)\b/i;
const LIST_VISUAL_REQUEST_PATTERN = /\b(top\s*\d+|best|most popular|list|rank|ranking|compare|comparison|vs|versus)\b/i;
const ABSTRACT_DISCUSSION_PATTERN = /\b(why|should|reason|because|ethic|moral|justice|opinion|debate|punishment|law|policy|philosophy|rights?)\b/i;

const isImageFileUrl = (url: string) => url.startsWith('data:image/') || IMAGE_FILE_URL_PATTERN.test(url);
const isVideoFileUrl = (url: string) => url.startsWith('data:video/') || VIDEO_FILE_URL_PATTERN.test(url);

const hasExplicitVisualIntent = (text: string) => {
  const normalized = text.trim();
  if (!normalized) return false;

  if (VISUAL_INLINE_REQUEST_PATTERN.test(normalized)) return true;

  return LIST_VISUAL_REQUEST_PATTERN.test(normalized) &&
    VISUAL_TOPIC_HINT_PATTERN.test(normalized) &&
    !ABSTRACT_DISCUSSION_PATTERN.test(normalized);
};

export const ChatContainer = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // On mobile, start with sidebar closed so user lands in new chat
  useEffect(() => {
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }, []);
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
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [inputDockHeight, setInputDockHeight] = useState(116);
  const [showVisualizePopup, setShowVisualizePopup] = useState(false);
  const [restoreDraft, setRestoreDraft] = useState<{ text: string; nonce: number } | null>(null);
  const [showAnalyzePopup, setShowAnalyzePopup] = useState(false);
  const analyzeFileInputRef = useRef<HTMLInputElement>(null);
  const analyzeCameraInputRef = useRef<HTMLInputElement>(null);
  const analyzeGalleryInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const voiceCallRef = useRef<VoiceCallHandle | null>(null);
  const inputDockRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const {
    conversations, currentConversation, messages,
    selectConversation: selectConversationDb,
    createConversation: createConversationDb,
    addMessage: addMessageDb,
    deleteMessagesFrom, deleteConversation, renameConversation,
    startNewChat: startNewChatDb,
    setMessages,
  } = useConversations();

  // Temporary chat mode — messages stay local, never persisted.
  const [tempChatMode, setTempChatMode] = useState(false);
  const tempChatRef = useRef(false);
  useEffect(() => { tempChatRef.current = tempChatMode; }, [tempChatMode]);

  const addMessage = async (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    fileUrls?: string[],
  ) => {
    if (tempChatRef.current) {
      const msg = {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conversation_id: 'temp',
        role,
        content,
        file_urls: fileUrls || null,
        created_at: new Date().toISOString(),
      } as any;
      setMessages((prev) => [...prev, msg]);
      return msg;
    }
    return addMessageDb(conversationId, role, content, fileUrls);
  };

  const createConversation = async (firstMessage?: string) => {
    if (tempChatRef.current) {
      return {
        id: 'temp',
        title: 'Temporary',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;
    }
    return createConversationDb(firstMessage);
  };

  const startNewChat = () => {
    setTempChatMode(false);
    startNewChatDb();
  };

  const selectConversation = async (conv: any) => {
    setTempChatMode(false);
    await selectConversationDb(conv);
  };

  const toggleTempChat = () => {
    if (tempChatMode) {
      setTempChatMode(false);
      startNewChatDb();
      return;
    }
    startNewChatDb();
    setTempChatMode(true);
    toast({ title: 'Temporary chat on', description: 'Messages in this chat will not be saved.' });
  };


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

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const updateInset = () => {
      const nextInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(Math.round(nextInset));
    };

    updateInset();
    vv.addEventListener('resize', updateInset);
    vv.addEventListener('scroll', updateInset);

    return () => {
      vv.removeEventListener('resize', updateInset);
      vv.removeEventListener('scroll', updateInset);
    };
  }, []);

  useEffect(() => {
    const node = inputDockRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const updateHeight = () => {
      setInputDockHeight(Math.ceil(node.getBoundingClientRect().height));
    };

    updateHeight();
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);

    return () => observer.disconnect();
  }, [showVoiceCall, editingMessageContent]);

  // Always scroll to the latest message when opening a conversation. iOS Safari
  // has multiple late layout passes (fonts, images, virtual keyboard, safe-area
  // insets), so we re-snap several times to make sure we land at the bottom.
  useEffect(() => {
    const viewport = viewportRef.current || (scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null);
    if (!viewport) return;
    const snap = () => { viewport.scrollTop = viewport.scrollHeight; };
    const timers: number[] = [];
    requestAnimationFrame(snap);
    [60, 180, 360, 700, 1200].forEach((ms) => {
      timers.push(window.setTimeout(snap, ms));
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [currentConversation?.id, messages.length]);

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

  const detectVideoGenerationRequest = (content: string): string | null => {
    for (const pattern of VIDEO_GENERATION_PATTERNS) {
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
    const cleaned = raw.trim().replace(/^['"]+|['"]+$/g, '');
    const normalized = cleaned
      // Remove emoji
      .replace(EMOJI_REGEX, '')
      // Remove conversational filler before the actual intent
      .replace(/^(?:(?:ok(?:ay)?|sure|nah|no|yes|yeah|yep|alright|lol|haha|hmm|well|so|hey|hi|oh|ah|um|uh|anyway|btw|by the way)[,.\s!]*)+/gi, '')
      // Remove "I'm good / that's fine" type phrases
      .replace(/^(?:i'?m\s+good|that'?s?\s+(?:fine|great|ok|cool)|never\s*mind|forget\s+(?:it|that))[,.\s!]*/gi, '')
      // Remove "who said anything about X, I mean" conversational redirects
      .replace(/^(?:who\s+(?:said|cares)\s+(?:anything\s+)?about\s+[^,]+,?\s*(?:i\s+mean\s*)?)/gi, '')
      // Remove request framing
      .replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:would\s+you\s+)?/i, '')
      .replace(/^(?:i\s+(?:want|need|would\s+like)\s+(?:to\s+(?:see|know|find\s+out)|you\s+to)\s+)/i, '')
      // Remove search/show verbs
      .replace(/^(?:search|google|look\s*up|find\s*out|find|check|show\s+me)\s+(?:for\s+|up\s+|about\s+|on\s+|the\s+)?/i, '')
      // Remove media type nouns
      .replace(/^(?:the\s+)?(?:images?|photos?|pictures?|videos?)\s+(?:of|for|about)\s+/i, '')
      .replace(/^(?:an?\s+)?(?:image|photo|picture|video)\s+(?:of|for|about)\s+/i, '')
      // Remove trailing filler
      .replace(/\b(?:please|for\s+me|thanks?|from\s+(?:the\s+)?(?:web|internet|google|online))\b/gi, '')
      .replace(/[?!.]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const label = normalized || cleaned.replace(EMOJI_REGEX, '').trim();
    return label.length > 70 ? label.slice(0, 67) + '...' : label;
  };

  // parseReminderRequest is now imported from @/lib/reminderParser

  const isAppInForeground = () => document.visibilityState === 'visible' && document.hasFocus();

  const extractFunctionErrorMessage = async (error: unknown, fallback: string) => {
    if (!(error instanceof Error) || !("context" in error)) return fallback;

    try {
      const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (context?.json) {
        const body = await context.json();
        if (body?.error) return body.error;
      }
    } catch {
      // ignore parsing failures
    }

    return error.message || fallback;
  };

  const generateImageWithOptions = async (opts: ImageGenOptions): Promise<string | null> => {
    let referenceMediaUrl = opts.referenceMediaUrl ?? opts.referenceImageUrl;

    if (!referenceMediaUrl && opts.reference?.kind === 'image') {
      referenceMediaUrl = opts.reference.dataUrl;
    }

    // Image-only references now

    // Upload base64 reference media to storage first to avoid payload size issues
    if (referenceMediaUrl && referenceMediaUrl.startsWith('data:') && user) {
      try {
        const match = referenceMediaUrl.match(/^data:(.+?);base64,(.+)$/);
        if (match) {
          const mime = match[1];
          const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('mp4') ? 'mp4' : 'jpg';
          const binary = atob(match[2]);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const path = `${user.id}/ref-${Date.now()}.${ext}`;
          const { error: uploadErr } = await supabase.storage.from('chat-files').upload(path, bytes, { contentType: mime });
          if (!uploadErr) {
            referenceMediaUrl = makeStorageRef('chat-files', path);
          }
        }
      } catch (e) {
        console.error('Reference media upload failed, sending as-is:', e);
      }
    }

    const { data, error } = await supabase.functions.invoke('generate-image', {
      body: {
        prompt: opts.prompt,
        style: opts.style,
        aspectRatio: opts.aspectRatio,
        referenceMediaUrl,
        referenceImageUrl: referenceMediaUrl,
        modelId: opts.modelId,
        appInForeground: isAppInForeground(),
      },
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
        let referenceMediaUrl: string | undefined;

        if (opts.reference?.kind === 'image') {
          let refUrl = opts.reference.dataUrl;
          if (refUrl.startsWith('data:') && user) {
            try {
              const match = refUrl.match(/^data:(.+?);base64,(.+)$/);
              if (match) {
                const mime = match[1];
                const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
                const binary = atob(match[2]);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const path = `${user.id}/ref-${Date.now()}.${ext}`;
                const { error: uploadErr } = await supabase.storage.from('chat-files').upload(path, bytes, { contentType: mime });
                if (!uploadErr) {
                  refUrl = makeStorageRef('chat-files', path);
                }
              }
            } catch (e) {
              console.error('Video ref image upload failed:', e);
            }
          }
          referenceMediaUrl = refUrl;
        }

        const { data, error } = await supabase.functions.invoke('generate-video', {
          body: {
            prompt: opts.prompt,
            modelId: opts.modelId,
            duration: opts.duration,
            quality: opts.quality,
            referenceMediaUrl,
            appInForeground: isAppInForeground(),
          },
        });

        if (error) {
          const message = await extractFunctionErrorMessage(error, 'Video generation failed.');
          throw new Error(message);
        }

        if (data?.error) throw new Error(data.error);
        if (data?.video) {
          await addMessage(capturedConvId, 'assistant', `Here's your video.`, [data.video]);
          toast({ title: '✅ Video ready!', description: opts.prompt.slice(0, 60) });
        } else {
          await addMessage(capturedConvId, 'assistant', `I couldn't generate that video. Please try again.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Please try again.';
        toast({ title: 'Video generation failed', description: message, variant: 'destructive' });
        await addMessage(capturedConvId, 'assistant', `I couldn't generate that video. ${message}`);
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
      // Sanitize filename: storage rejects spaces, parentheses, and many unicode chars
      const safeName = file.name
        .normalize('NFKD')
        .replace(/[^\w.\-]+/g, '_')
        .replace(/_+/g, '_')
        .slice(-120);
      const fileName = `${user.id}/${Date.now()}-${safeName || 'file'}`;
      const { error } = await supabase.storage
        .from('chat-files')
        .upload(fileName, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (error) {
        console.error('Upload failed:', error, file.name);
        toast({
          title: 'Upload failed',
          description: `${file.name}: ${error.message}`,
          variant: 'destructive',
        });
        continue;
      }
      refs.push(makeStorageRef('chat-files', fileName));
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
      .replace(/\[IMG:https?:\/\/[^|\]]+\|?[^\]]*\]/gi, '')
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

      // Save user message to DB (no optimistic duplicate)
      extractAndSaveMemory(content);
      await addMessage(convId, 'user', content, fileUrls.length > 0 ? fileUrls : undefined);

      const userRequestedInlineGeneration = Boolean(
        detectImageGenerationRequest(content) || detectVideoGenerationRequest(content)
      );

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
      const imageUrls = resolvedFileUrls.filter((url) => isImageFileUrl(url));
      const videoFileUrls = resolvedFileUrls.filter((url) => isVideoFileUrl(url));

      const apiMessages = (await Promise.all(
        messages.map(async (m) => {
          // Skip empty assistant messages (leftover from stripped generation tags)
          if (m.role === 'assistant' && (!m.content || !m.content.trim())) return null;
          const resolved = await resolveUrls(m.file_urls);
          return {
            role: m.role,
            content: m.content,
            imageUrls: m.role === 'user' ? resolved.filter((url) => isImageFileUrl(url)) : [],
            videoUrls: m.role === 'user' ? resolved.filter((url) => isVideoFileUrl(url)) : [],
          };
        })
      )).filter(Boolean) as Array<{ role: string; content: string; imageUrls: string[]; videoUrls: string[] }>;

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

      // Google Maps intent detection
      const mapsIntent = /\b(near(?:by| me)?|restaurant|cafe|coffee|hotel|gas station|pharmacy|store|directions?|route|distance|drive|walk|how (?:far|long) (?:from|to)|map of|address of|where is)\b/i.test(content);
      let mapsContext = '';
      let mapEmbedToken = '';
      if (mapsIntent) {
        try {
          const { data: connData } = await supabase
            .from('user_connections')
            .select('enabled')
            .eq('user_id', user?.id || '')
            .eq('provider', 'google_maps')
            .maybeSingle();
          if (connData?.enabled) {
            setTypingMode('search');
            setTypingLabel('Astraz is using Google Maps…');
            const isDirections = /\b(directions?|route|how (?:far|long) (?:from|to)|distance from .+ to)\b/i.test(content);
            const dirMatch = content.match(/from\s+(.+?)\s+to\s+(.+?)(?:[.?!]|$)/i);
            const placeQuery = content.replace(/\b(show me|find me|please|where is|map of|address of|directions?(?:\s+to)?|near\s*me|nearby)\b/gi, '').trim().slice(0, 180);
            const { data: mapsData } = await supabase.functions.invoke('connector-maps', {
              body: isDirections && dirMatch
                ? { action: 'directions', origin: dirMatch[1].trim(), destination: dirMatch[2].trim() }
                : { action: 'search_places', query: placeQuery || content.slice(0, 180) },
            });
            if (mapsData && !mapsData.error) {
              mapsContext = `\n\n[Live Google Maps data]\n${JSON.stringify(mapsData).slice(0, 3500)}`;
              if (isDirections && dirMatch) {
                const safe = (s: string) => s.replace(/"/g, "'");
                mapEmbedToken = `[[MAP_DIRECTIONS origin="${safe(dirMatch[1].trim())}" destination="${safe(dirMatch[2].trim())}"]]\n\n`;
              } else if (placeQuery) {
                mapEmbedToken = `[[MAP_EMBED q="${placeQuery.replace(/"/g, "'")}"]]\n\n`;
              }
            }
          }
        } catch (e) { console.warn('[maps]', e); }
      }

      // Other connector intents: Gmail, Calendar, Telegram, TikTok
      let connectorContext = '';
      const runConnector = async (provider: string, fn: string, body: any, label: string) => {
        try {
          const { data: connData } = await supabase
            .from('user_connections').select('enabled')
            .eq('user_id', user?.id || '').eq('provider', provider).maybeSingle();
          if (!connData?.enabled) return;
          setTypingMode('search');
          setTypingLabel(label);
          const { data } = await supabase.functions.invoke(fn, { body });
          if (data && !data.error) {
            connectorContext += `\n\n[${label}]\n${JSON.stringify(data).slice(0, 3000)}`;
          }
        } catch (e) { console.warn(`[${provider}]`, e); }
      };

      const gmailIntent = /\b(email|inbox|gmail|unread mail|send (?:an? )?mail|compose (?:an? )?mail|draft (?:an? )?(?:email|mail))\b/i.test(content);
      if (gmailIntent) {
        const sendMatch = content.match(/(?:send|email|mail)\s+(?:an?\s+email\s+to\s+)?([\w.+-]+@[\w-]+\.[\w.-]+)\s+(?:saying|with subject|about|that)\s+(.+)/i);
        if (sendMatch) {
          await runConnector('gmail', 'connector-gmail', { action: 'send', to: sendMatch[1], subject: 'Message from Astraz', body: sendMatch[2] }, 'Astraz is using Gmail…');
        } else {
          await runConnector('gmail', 'connector-gmail', { action: 'list', query: 'is:unread', maxResults: 8 }, 'Astraz is using Gmail…');
        }
      }

      const calIntent = /\b(calendar|schedule|my (?:meetings?|events?)|upcoming (?:meetings?|events?)|book (?:a )?meeting|what(?:'s| is) on (?:my )?(?:schedule|calendar))\b/i.test(content);
      if (calIntent) {
        await runConnector('google_calendar', 'connector-calendar', { action: 'list_upcoming', maxResults: 10 }, 'Astraz is using Google Calendar…');
      }

      const tgIntent = /\b(telegram|tg\b|send (?:a )?telegram)\b/i.test(content);
      if (tgIntent) {
        await runConnector('telegram', 'connector-telegram', { action: 'get_me' }, 'Astraz is using Telegram…');
      }

      const ttIntent = /\b(tiktok|my tiktok|tiktok profile|tiktok videos?)\b/i.test(content);
      if (ttIntent) {
        await runConnector('tiktok', 'connector-tiktok', { action: 'profile' }, 'Astraz is using TikTok…');
      }

      const fullExtraContext = mapsContext + connectorContext;

      if (!fullExtraContext) {
        setTypingMode(isWebSearchState ? 'search' : 'typing');
        setTypingLabel(
          hasUploadedVideoFiles
            ? 'Reviewing video…'
            : isWebSearchState
              ? `Searching the web`
              : undefined
        );
      }

      if (fullExtraContext) {
        apiMessages[apiMessages.length - 1] = {
          ...apiMessages[apiMessages.length - 1],
          content: apiMessages[apiMessages.length - 1].content + fullExtraContext,
        };
      }

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
            ? `User uploaded ${fileUrls.length} file(s): ${fileUrls.map((url) => isImageFileUrl(url) ? 'image' : isVideoFileUrl(url) ? 'video' : 'document').join(', ')}`
            : undefined,
          userId: user?.id,
          forceWebSearch: shouldWebSearch,
          webSearchQuery: searchQuery,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientTimeISO: new Date().toISOString(),
          aiMode: getAISettings().mode,
          customPrompt: getAISettings().customPrompt,
          followUpQuestions: getAISettings().followUpQuestions,
          model: (typeof window !== 'undefined' ? localStorage.getItem('astraz_selected_model') : null) === 'astraz-pro' ? 'astraz-pro' : 'astraz',

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
      let fullContent = mapEmbedToken || '';
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
              // Use first attached media as reference (image first, then video)
              const referenceMediaUrl = imageUrls[0] ?? videoFileUrls[0];
              const generatedImage = await generateImageWithOptions({ 
                prompt: imgPrompt, 
                style: 'photoreal', 
                aspectRatio: '1:1', 
                quality: 'balanced',
                referenceMediaUrl,
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
              const referenceMediaUrl = imageUrls[0] ?? videoFileUrls[0];
              const { data, error } = await supabase.functions.invoke('generate-video', {
                body: { prompt: vidPrompt, modelId: 'kling_3', referenceMediaUrl, appInForeground: isAppInForeground() },
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
          // Never save empty assistant messages (can happen when generation tags are stripped)
          if (processedContent) {
            await addMessage(convId, 'assistant', processedContent);
          }
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
      // Restore the user's typed message back into the input so it's not lost
      if (content && content.trim()) {
        setRestoreDraft({ text: content, nonce: Date.now() });
      }
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

  const handleStartVoiceCall = async () => {
    let primedStream: MediaStream | undefined;
    try {
      primedStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      primedStream = undefined;
    }

    flushSync(() => setShowVoiceCall(true));
    await voiceCallRef.current?.startFromTrigger(primedStream);
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

  const composerBaseOffset = keyboardInset > 0 ? 8 : 38;
  const composerOffset = keyboardInset + composerBaseOffset;
  const scrollBottomPadding = inputDockHeight + composerOffset + (keyboardInset > 0 ? 8 : 18);

  const handleAnalyzeFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    setShowAnalyzePopup(false);
    void handleSend('Summarize and extract insights', files);
    e.target.value = '';
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <div className="aurora-bg" />
      <AnimatePresence>
        {showVoiceCall && <VoiceCall ref={voiceCallRef} open={showVoiceCall} onClose={() => setShowVoiceCall(false)} />}
      </AnimatePresence>

      <ImageGenerateDialog open={showImageDialog} onOpenChange={setShowImageDialog} onGenerate={handleImageGenerate} initialPrompt={imageDialogPrompt} />
      <VideoGenerateDialog open={showVideoDialog} onOpenChange={setShowVideoDialog} onGenerate={handleVideoGenerate} />

      {/* Hidden inputs for Analyze documents flow */}
      <input ref={analyzeGalleryInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleAnalyzeFiles} />
      <input ref={analyzeCameraInputRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={handleAnalyzeFiles} />
      <input ref={analyzeFileInputRef} type="file" multiple className="hidden" onChange={handleAnalyzeFiles} accept="image/*,video/*,.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.pptx" />

      {/* Analyze documents source picker */}
      <AnimatePresence>
        {showAnalyzePopup && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAnalyzePopup(false)}>
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-sm bg-popover/95 backdrop-blur-xl border border-border/70 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
              <div className="px-5 pt-5 pb-3 text-center">
                <h3 className="text-base font-semibold">Analyze documents</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Choose where to upload from</p>
              </div>
              <div className="px-2 pb-2">
                <button onClick={() => analyzeGalleryInputRef.current?.click()} className="flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/70 w-full text-left text-sm rounded-xl transition-colors">
                  <span className="text-xl">🖼️</span>
                  <span className="font-medium">Gallery</span>
                </button>
                <button onClick={() => analyzeCameraInputRef.current?.click()} className="flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/70 w-full text-left text-sm rounded-xl transition-colors">
                  <span className="text-xl">📷</span>
                  <span className="font-medium">Take Photo or Video</span>
                </button>
                <button onClick={() => analyzeFileInputRef.current?.click()} className="flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/70 w-full text-left text-sm rounded-xl transition-colors">
                  <span className="text-xl">📁</span>
                  <span className="font-medium">Choose Files</span>
                </button>
              </div>
              <button onClick={() => setShowAnalyzePopup(false)} className="w-full py-3 text-sm text-muted-foreground hover:text-foreground border-t border-border/50">Cancel</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Visualize picker (image / video) */}
      <AnimatePresence>
        {showVisualizePopup && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowVisualizePopup(false)}>
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-sm bg-popover/95 backdrop-blur-xl border border-border/70 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
              <div className="px-5 pt-5 pb-3 text-center">
                <h3 className="text-base font-semibold">Visualize</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Generate images or videos</p>
              </div>
              <div className="px-2 pb-2">
                <button onClick={() => { setShowVisualizePopup(false); openImageDialog(); }} className="flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/70 w-full text-left text-sm rounded-xl transition-colors">
                  <span className="text-xl">🎨</span>
                  <div>
                    <p className="font-medium">Generate Image</p>
                    <p className="text-xs text-muted-foreground">Create AI images</p>
                  </div>
                </button>
                <button onClick={() => { setShowVisualizePopup(false); openVideoDialog(); }} className="flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/70 w-full text-left text-sm rounded-xl transition-colors">
                  <span className="text-xl">🎬</span>
                  <div>
                    <p className="font-medium">Generate Video</p>
                    <p className="text-xs text-muted-foreground">Create AI videos</p>
                  </div>
                </button>
              </div>
              <button onClick={() => setShowVisualizePopup(false)} className="w-full py-3 text-sm text-muted-foreground hover:text-foreground border-t border-border/50">Cancel</button>
            </motion.div>
          </motion.div>
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

      <main className="flex-1 flex flex-col min-w-0 relative">
        <div className="absolute top-2 left-2 right-2 z-20 flex items-center gap-1.5 pointer-events-none min-w-0 sm:top-3 sm:left-3 sm:right-3 sm:gap-2">
          <Button variant="secondary" size="icon" onClick={() => setSidebarOpen(true)}
            className={cn("rounded-full pointer-events-auto h-8 w-8 sm:h-10 sm:w-10", sidebarOpen ? 'lg:hidden' : '')} aria-label="Open sidebar">
            <PanelLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0 flex justify-center">
            <ChatHeader
            onTempChat={toggleTempChat}
            showTempChat={!currentConversation && displayMessages.length === 0}
            tempActive={tempChatMode}
            />

          </div>
          <div className="w-8 sm:w-10" />
        </div>


        <ScrollArea ref={scrollRef} className="flex-1 min-w-0 overscroll-none">
          <div className="w-full min-w-0 max-w-full overflow-x-hidden" style={{ paddingBottom: `${scrollBottomPadding}px` }}>
            <AnimatePresence mode="wait">
              {displayMessages.length === 0 ? (
                <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-[calc(env(safe-area-inset-top,0px)+4.5rem)] sm:pt-20 lg:pt-6">
                  <WelcomeScreen onAnalyzeDocs={() => setShowAnalyzePopup(true)} onVisualize={() => setShowVisualizePopup(true)} profileName={profile?.full_name} />
                </motion.div>
              ) : (
                <motion.div key="messages" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto pt-[calc(env(safe-area-inset-top,0px)+4.25rem)] lg:pt-6 min-w-0 overflow-x-hidden">
                  {displayMessages.map((msg, msgIndex) => {
                  const userMessages = displayMessages.filter(m => m.role === 'user');
                  const userMsgIndex = userMessages.findIndex(m => m.id === msg.id);
                  const canEdit = msg.role === 'user' && userMsgIndex >= userMessages.length - 3;

                  let previousUserContent = '';
                  for (let i = msgIndex - 1; i >= 0; i--) {
                    if (displayMessages[i].role === 'user') {
                      previousUserContent = displayMessages[i].content;
                      break;
                    }
                  }
                  const enableAutoListImages = msg.role === 'assistant' && hasExplicitVisualIntent(previousUserContent);

                    return (
                      <ChatMessage key={msg.id} role={msg.role} content={msg.content} isStreaming={msg.id === 'streaming'}
                        streamingStyle={msg.id === 'streaming' ? streamingStyle : undefined}
                        fileUrls={msg.file_urls} userAvatar={profile?.avatar_url} userName={profile?.full_name}
                        onEdit={canEdit ? (content: string) => handleEditMessage(msg.id, content) : undefined} canEdit={canEdit}
                        onNotificationAction={handleNotificationAction}
                        enableAutoListImages={enableAutoListImages} />
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
                      <Button variant="outline" size="sm" onClick={stopGeneration} className="h-7 px-3 text-xs rounded-full border-destructive/50 text-destructive hover:bg-destructive/10">
                        Cancel
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>

        <AnimatePresence>
          {showScrollToBottom && (
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} className="fixed right-4 z-30" style={{ bottom: `${Math.max(88, scrollBottomPadding - 12)}px` }}>
              <Button variant="secondary" size="icon" className="rounded-full shadow-lg"
                onClick={() => { const viewport = viewportRef.current; if (viewport) viewport.scrollTop = viewport.scrollHeight; }}
                aria-label="Scroll to bottom">
                <ArrowDown className="h-5 w-5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${composerOffset}px)` }}>
          <div className="pointer-events-none absolute inset-x-0 -bottom-8 h-36 bg-gradient-to-t from-background via-background/78 to-transparent" />
          <div ref={inputDockRef} className="pointer-events-auto relative">
            {displayMessages.length === 0 && (
              <div className="w-full max-w-3xl mx-auto px-2 sm:px-4 mb-2 sm:mb-3 min-w-0">
                <div
                  className="overflow-x-auto overflow-y-hidden no-scrollbar scroll-smooth min-w-0 max-w-full"
                  style={{ touchAction: 'pan-x', WebkitOverflowScrolling: 'touch' }}
                >
                  <div className="flex w-max min-w-full gap-2 pb-1 pr-2">
                    {WELCOME_SHORTCUTS.map((shortcut) => (
                      <button
                        key={shortcut.title}
                        type="button"
                        onClick={() => {
                          const value = shortcut.getValue();
                          if (shortcut.type === 'prompt') {
                            void handleSend(value);
                            return;
                          }

                          if (value === 'analyze') {
                            setShowAnalyzePopup(true);
                            return;
                          }

                          setShowVisualizePopup(true);
                        }}
                        className="flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3.5 py-2 text-sm whitespace-nowrap backdrop-blur-sm transition-colors hover:border-primary/40"
                      >
                        <shortcut.icon className="h-4 w-4 text-primary" />
                        <span className="text-foreground/90">{shortcut.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <ChatInput
              onSend={handleSend}
              isLoading={isLoading}
              disabled={!user}
              onStop={(isLoading || isGeneratingImage || isGeneratingVideo) ? stopGeneration : undefined}
              editValue={editingMessageContent}
              onClearEdit={clearEditState}
              onStartCall={user ? handleStartVoiceCall : undefined}
              onOpenImageDialog={openImageDialog}
              onOpenVideoDialog={openVideoDialog}
              restoreDraft={restoreDraft}
            />
          </div>
        </div>
      </main>
    </div>
  );
};
