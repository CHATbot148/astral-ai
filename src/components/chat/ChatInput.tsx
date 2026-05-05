import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Mic, MicOff, Plus, X, Loader2, FileText, Square, Phone, Smile, Pencil, Wand2, Video, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VoiceVisualizer } from './VoiceVisualizer';
import { cn } from '@/lib/utils';
import { useMicVisualizer } from '@/hooks/useMicVisualizer';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ChatInputProps {
  onSend: (message: string, files?: File[]) => void;
  isLoading: boolean;
  disabled?: boolean;
  onStop?: () => void;
  editValue?: string | null;
  onClearEdit?: () => void;
  onStartCall?: () => void;
  onOpenImageDialog?: (prefill?: string) => void;
  onOpenVideoDialog?: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export const ChatInput = ({ onSend, isLoading, disabled, onStop, editValue, onClearEdit, onStartCall, onOpenImageDialog, onOpenVideoDialog }: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<{ file: File; preview: string | null }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearch, setGifSearch] = useState('');
  const [gifs, setGifs] = useState<Array<{ url: string; title: string }>>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const touchStartYRef = useRef<number | null>(null);
  const { toast } = useToast();

  const { levels } = useMicVisualizer({ enabled: isRecording, bars: 12 });

  useEffect(() => {
    if (editValue) {
      setMessage(editValue);
      textareaRef.current?.focus();
    }
  }, [editValue]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  useEffect(() => {
    const generatePreviews = async () => {
      const previews = await Promise.all(
        files.map(async (file) => {
          if (file.type.startsWith('image/')) {
            return new Promise<{ file: File; preview: string | null }>((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve({ file, preview: e.target?.result as string });
              reader.onerror = () => resolve({ file, preview: null });
              reader.readAsDataURL(file);
            });
          }
          return { file, preview: null };
        })
      );
      setFilePreviews(previews);
    };
    generatePreviews();
  }, [files]);

  useEffect(() => {
    if (showGifPicker && gifs.length === 0) {
      searchGifs('trending');
    }
  }, [showGifPicker]);

  const searchGifs = async (query: string) => {
    setLoadingGifs(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-gif', {
        body: { query: query || 'trending', limit: 20 }
      });
      if (error) throw error;
      setGifs(data?.gifs || []);
    } catch (e) {
      console.error('GIF search error:', e);
    } finally {
      setLoadingGifs(false);
    }
  };

  const handleGifSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (gifSearch.trim()) searchGifs(gifSearch.trim());
  };

  const insertGif = (gifUrl: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const gifMarkdown = `![GIF](${gifUrl})`;
      const newMessage = message.slice(0, start) + gifMarkdown + message.slice(end);
      setMessage(newMessage);
    } else {
      setMessage(prev => prev + `![GIF](${gifUrl})`);
    }
    setShowGifPicker(false);
    setShowAttachMenu(false);
    textareaRef.current?.focus();
  };

  const handleSubmit = () => {
    if ((!message.trim() && files.length === 0) || isLoading || disabled) return;
    onSend(message.trim(), files.length > 0 ? files : undefined);
    setMessage('');
    setFiles([]);
    setFilePreviews([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
    setShowAttachMenu(false);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Deepgram-based recording for STT
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4" : "";
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        if (audioChunksRef.current.length === 0) { setIsRecording(false); return; }
        setIsTranscribing(true);
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || "audio/webm" });
          const arrayBuffer = await audioBlob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const base64Audio = btoa(binary);

          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token;
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speech-to-text`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({ audio: base64Audio }),
          });

          if (!response.ok) throw new Error("Transcription failed");
          const { transcript, error } = await response.json();
          if (error) throw new Error(error);
          if (transcript && transcript.trim()) {
            setMessage(prev => prev ? `${prev} ${transcript}` : transcript);
          }
        } catch (error) {
          console.error("Transcription error:", error);
          toast({ title: 'Transcription failed', description: 'Please try again', variant: 'destructive' });
        } finally {
          setIsTranscribing(false);
          setIsRecording(false);
        }
      };

      mediaRecorder.onerror = () => {
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        toast({ title: 'Recording failed', variant: 'destructive' });
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      let errorMessage = 'Please allow microphone access to use voice input';
      if (error instanceof Error && error.name === "NotAllowedError") {
        errorMessage = "Microphone access denied. Please check browser settings.";
      }
      toast({ title: 'Microphone access denied', description: errorMessage, variant: 'destructive' });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const showCallButton = !message.trim() && files.length === 0 && !isLoading && !isRecording && onStartCall;
  const isEditing = !!editValue;

  const handleCancelEdit = () => {
    setMessage('');
    onClearEdit?.();
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    if (startY == null) return;
    const endY = e.changedTouches[0]?.clientY ?? startY;
    const deltaY = endY - startY;

    if (deltaY < -18) {
      textareaRef.current?.focus();
    } else if (deltaY > 22 && document.activeElement === textareaRef.current) {
      textareaRef.current?.blur();
    }
  };

  return (
    <div className="pointer-events-none w-full max-w-3xl mx-auto px-2 sm:px-4 pb-3 sm:pb-4 pt-2">
      <div className="pointer-events-auto" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Editing indicator */}
      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-xai-cyan/10 border border-xai-cyan/30"
          >
            <div className="flex items-center gap-2 text-sm text-xai-cyan">
              <Pencil className="h-3.5 w-3.5" />
              <span className="font-medium">Editing message</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleCancelEdit} className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File Previews Above Input */}
      <AnimatePresence>
        {filePreviews.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-3">
            <div className="flex flex-wrap gap-2">
              {filePreviews.map(({ file, preview }, index) => (
                <motion.div key={index} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="relative group">
                  {preview ? (
                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-secondary">
                      <img src={preview} alt={file.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-secondary flex flex-col items-center justify-center border border-border p-1">
                      <FileText className="h-5 w-5 text-muted-foreground mb-0.5" />
                      <span className="text-[10px] text-muted-foreground truncate w-full text-center">{file.name.slice(0, 8)}</span>
                    </div>
                  )}
                  <motion.button onClick={() => removeFile(index)} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-lg">
                    <X className="h-3 w-3" />
                  </motion.button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* GIF Picker */}
      <AnimatePresence>
        {showGifPicker && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="mb-3 bg-secondary rounded-xl border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">GIFs</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowGifPicker(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form onSubmit={handleGifSearch} className="mb-2">
              <Input placeholder="Search GIFs..." value={gifSearch} onChange={(e) => setGifSearch(e.target.value)} className="h-8 text-sm" />
            </form>
            <ScrollArea className="h-40">
              {loadingGifs ? (
                <div className="flex items-center justify-center h-full"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {gifs.map((gif, index) => (
                    <button key={index} onClick={() => insertGif(gif.url)} className="rounded-lg overflow-hidden hover:ring-2 hover:ring-xai-cyan transition-all">
                      <img src={gif.url} alt={gif.title} className="w-full h-16 object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transcribing indicator */}
      <AnimatePresence>
        {isTranscribing && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mb-3 flex items-center justify-center gap-2 text-xai-cyan">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">Transcribing...</span>
          </motion.div>
        )}
      </AnimatePresence>

      <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" accept="image/*,video/*,.pdf,.doc,.docx,.txt" />

      {/* Modern unified input bar - floating */}
      <div className="relative">
        {/* Animated gradient glow */}
        <div
          className="pointer-events-none absolute -inset-[1px] rounded-[28px] opacity-60 blur-[8px] transition-opacity duration-500"
          style={{
            background:
              'conic-gradient(from 180deg at 50% 50%, hsl(var(--xai-purple)/0.55), hsl(var(--xai-cyan)/0.55), hsl(var(--xai-purple)/0.55))',
          }}
          aria-hidden
        />

        <div
          className={cn(
            'relative flex items-end gap-1.5 sm:gap-2 rounded-[26px] px-1.5 py-1.5 sm:px-2 sm:py-2',
            'bg-background/85 backdrop-blur-xl',
            'border border-border/60 shadow-[0_10px_40px_-12px_hsl(var(--xai-purple)/0.35)]',
            'transition-all duration-300 overflow-hidden min-h-[58px] sm:min-h-[62px]',
            isRecording && 'border-destructive/40'
          )}
        >
          {/* + Attachment Button */}
          <div className="relative flex-shrink-0">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                disabled={disabled || isRecording || isLoading}
                className="h-10 w-10 rounded-full bg-secondary/60 hover:bg-secondary text-foreground"
                aria-label="Attach files"
              >
                <motion.span animate={{ rotate: showAttachMenu ? 45 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
                  <Plus className="h-5 w-5" />
                </motion.span>
              </Button>
            </motion.div>

            {/* Attachment Menu */}
            <AnimatePresence>
              {showAttachMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: 8 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                  className="absolute bottom-full left-0 mb-3 bg-popover/95 backdrop-blur-xl border border-border/70 rounded-2xl shadow-2xl overflow-hidden min-w-[220px]"
                >
                  <button
                    onClick={() => { setShowAttachMenu(false); onOpenImageDialog?.(message.trim() || undefined); }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/70 w-full text-left text-sm transition-colors"
                  >
                    <Wand2 className="h-4 w-4 text-xai-cyan" />
                    <div>
                      <p className="font-medium">Create Image</p>
                      <p className="text-xs text-muted-foreground">Visualize anything</p>
                    </div>
                  </button>
                  <button
                    onClick={() => { setShowAttachMenu(false); onOpenVideoDialog?.(); }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/70 w-full text-left text-sm transition-colors"
                  >
                    <Video className="h-4 w-4 text-xai-purple" />
                    <div>
                      <p className="font-medium">Create Video</p>
                      <p className="text-xs text-muted-foreground">Generate short videos</p>
                    </div>
                  </button>
                  <button
                    onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/70 w-full text-left text-sm transition-colors"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Add Files</p>
                      <p className="text-xs text-muted-foreground">Upload images & documents</p>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setShowAttachMenu(false);
                      setMessage(prev => prev.startsWith('Search for: ') ? prev : 'Search for: ' + prev);
                      textareaRef.current?.focus();
                    }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/70 w-full text-left text-sm transition-colors"
                  >
                    <Globe className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="font-medium">Web Search</p>
                      <p className="text-xs text-muted-foreground">Find real-time info</p>
                    </div>
                  </button>
                  <button
                    onClick={() => { setShowGifPicker(true); setShowAttachMenu(false); }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/70 w-full text-left text-sm transition-colors"
                  >
                    <Smile className="h-4 w-4 text-yellow-500" />
                    <div>
                      <p className="font-medium">GIFs</p>
                      <p className="text-xs text-muted-foreground">Send animated GIFs</p>
                    </div>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Center: textarea or recording visualizer */}
          {isRecording ? (
            <div className="flex-1 flex items-center gap-2 min-h-[40px] px-2">
              <motion.div whileTap={{ scale: 0.92 }}>
                <Button variant="ghost" size="icon" onClick={stopRecording} className="h-9 w-9 rounded-full text-destructive bg-destructive/10">
                  <MicOff className="h-4 w-4" />
                </Button>
              </motion.div>
              <div className="flex-1 flex flex-col items-center justify-center min-w-0">
                <VoiceVisualizer isActive={true} levels={levels} className="w-full max-w-[260px]" />
                <p className="text-[10px] text-muted-foreground mt-0.5">Listening…</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-end min-h-[40px] px-1">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything"
                disabled={disabled || isLoading}
                rows={1}
                className={cn(
                  'flex-1 resize-none bg-transparent border-0 outline-none',
                  'text-foreground placeholder:text-muted-foreground/70',
                  'min-h-[28px] max-h-[180px] py-2 px-2',
                  'focus:ring-0 text-[15px] leading-snug'
                )}
              />
            </div>
          )}

          {/* Right cluster: mic + send/call */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!isRecording && (
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleRecording}
                  disabled={disabled || isTranscribing}
                  className="h-9 w-9 rounded-full hover:bg-secondary/70"
                  aria-label="Voice input"
                >
                  {isTranscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-[18px] w-[18px] text-muted-foreground" />}
                </Button>
              </motion.div>
            )}

            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.9 }}>
              {onStop ? (
                <Button variant="destructive" size="icon" onClick={onStop} className="h-10 w-10 rounded-full shadow-lg" aria-label="Stop generating">
                  <Square className="h-4 w-4" />
                </Button>
              ) : showCallButton ? (
                <Button
                  size="icon"
                  onClick={onStartCall}
                  disabled={disabled}
                  className="h-10 w-10 rounded-full text-white shadow-[0_8px_24px_-6px_hsl(var(--xai-purple)/0.6)] bg-gradient-to-br from-xai-purple to-xai-cyan hover:opacity-95 hover:shadow-[0_10px_30px_-6px_hsl(var(--xai-cyan)/0.6)]"
                  aria-label="Start voice call"
                >
                  <Phone className="h-[18px] w-[18px]" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={handleSubmit}
                  disabled={isRecording || (!message.trim() && files.length === 0) || isLoading || disabled}
                  className={cn(
                    'h-10 w-10 rounded-full text-white transition-all',
                    'bg-gradient-to-br from-xai-purple to-xai-cyan shadow-[0_8px_24px_-6px_hsl(var(--xai-purple)/0.55)]',
                    'hover:opacity-95 disabled:opacity-40 disabled:shadow-none disabled:from-muted disabled:to-muted disabled:bg-muted'
                  )}
                  aria-label="Send"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-[17px] w-[17px]" />}
                </Button>
              )}
            </motion.div>
          </div>
        </div>
      </div>
     </div>
    </div>
  );
};
