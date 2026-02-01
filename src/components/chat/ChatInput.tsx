import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Mic, MicOff, Plus, X, Loader2, FileText, Square, Phone, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VoiceVisualizer } from './VoiceVisualizer';
import { cn } from '@/lib/utils';
import { useMicVisualizer } from '@/hooks/useMicVisualizer';
import { useToast } from '@/hooks/use-toast';

interface ChatInputProps {
  onSend: (message: string, files?: File[]) => void;
  isLoading: boolean;
  disabled?: boolean;
  onStop?: () => void;
  editValue?: string | null;
  onClearEdit?: () => void;
  onStartCall?: () => void;
  onOpenImageDialog?: (prefill?: string) => void;
}

// Declare SpeechRecognition type
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export const ChatInput = ({ onSend, isLoading, disabled, onStop, editValue, onClearEdit, onStartCall, onOpenImageDialog }: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<{ file: File; preview: string | null }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const { toast } = useToast();

  const { levels } = useMicVisualizer({ enabled: isRecording, bars: 12 });

  // Handle edit value prop
  useEffect(() => {
    if (editValue) {
      setMessage(editValue);
      textareaRef.current?.focus();
      if (onClearEdit) onClearEdit();
    }
  }, [editValue, onClearEdit]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  // Generate previews for files
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

  const handleSubmit = () => {
    if ((!message.trim() && files.length === 0) || isLoading || disabled) return;
    onSend(message.trim(), files.length > 0 ? files : undefined);
    setMessage('');
    setFiles([]);
    setFilePreviews([]);
  };

  const openImageDialog = () => {
    if (!onOpenImageDialog || disabled) return;
    const prefill = message.trim();
    onOpenImageDialog(prefill || undefined);
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
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const startRecording = async () => {
    try {
      // Request microphone permission first
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Use Web Speech API for real-time transcription
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      
      if (!SpeechRecognitionAPI) {
        toast({
          title: 'Speech recognition not supported',
          description: 'Please use a supported browser like Chrome',
          variant: 'destructive',
        });
        return;
      }

      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      // Keep accumulating transcript across multiple recognition sessions
      let finalTranscript = message; // Start with existing message content

      recognition.onstart = () => {
        setIsRecording(true);
        finalTranscript = '';
      };

      recognition.onresult = (event) => {
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }
        
        // Show real-time transcript in the input
        setMessage(finalTranscript + interimTranscript);
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error !== 'aborted') {
          toast({
            title: 'Transcription error',
            description: 'Please try again',
            variant: 'destructive',
          });
        }
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
        setIsTranscribing(false);
        
        if (finalTranscript.trim()) {
          setMessage(finalTranscript.trim());
          toast({
            title: 'Transcription complete',
            description: 'Your voice has been transcribed',
          });
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      console.error('Error starting recording:', error);
      toast({
        title: 'Microphone access denied',
        description: 'Please allow microphone access to use voice input',
        variant: 'destructive',
      });
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      setIsTranscribing(true);
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const showCallButton = !message.trim() && files.length === 0 && !isLoading && !isRecording && onStartCall;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-4 pt-2">
      {/* File Previews Above Input */}
      <AnimatePresence>
        {filePreviews.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3"
          >
            <div className="flex flex-wrap gap-2">
              {filePreviews.map(({ file, preview }, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="relative group"
                >
                  {preview ? (
                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-secondary">
                      <img src={preview} alt={file.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-secondary flex flex-col items-center justify-center border border-border p-1">
                      <FileText className="h-5 w-5 text-muted-foreground mb-0.5" />
                      <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                        {file.name.slice(0, 8)}
                      </span>
                    </div>
                  )}
                  <motion.button
                    onClick={() => removeFile(index)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-lg"
                  >
                    <X className="h-3 w-3" />
                  </motion.button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transcribing indicator */}
      <AnimatePresence>
        {isTranscribing && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-3 flex items-center justify-center gap-2 text-xai-cyan"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">Transcribing...</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Bar */}
      <div className="flex items-end gap-2">
        {/* Attachment Button */}
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isRecording}
            className="h-10 w-10 rounded-full bg-secondary hover:bg-secondary/80 flex-shrink-0"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </motion.div>

        {/* Generate Image Button */}
        {onOpenImageDialog && (
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              variant="ghost"
              size="icon"
              onClick={openImageDialog}
              disabled={disabled || isRecording || isLoading}
              className="h-10 w-10 rounded-full bg-secondary hover:bg-secondary/80 flex-shrink-0"
              aria-label="Generate image"
              title="Generate image"
            >
              <ImageIcon className="h-5 w-5" />
            </Button>
          </motion.div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.txt"
        />

        {/* Main Input Container / Voice Recording Bar */}
        {isRecording ? (
          <div className="flex-1 flex items-center bg-secondary rounded-3xl px-3 py-1 min-h-[48px] overflow-hidden">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="icon"
                onClick={stopRecording}
                className="h-10 w-10 rounded-full text-destructive bg-destructive/10"
              >
                <MicOff className="h-5 w-5" />
              </Button>
            </motion.div>

            <div className="flex-1 flex flex-col items-center justify-center px-2 min-w-0">
              <VoiceVisualizer isActive={true} levels={levels} className="w-full max-w-[260px]" />
              <p className="text-[11px] text-muted-foreground mt-1">Listening… tap stop to finish</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-end bg-secondary rounded-3xl px-4 py-1 min-h-[48px]">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message X-AI..."
              disabled={disabled || isLoading}
              rows={1}
              className={cn(
                'flex-1 resize-none bg-transparent border-0 outline-none',
                'text-foreground placeholder:text-muted-foreground',
                'min-h-[40px] max-h-[200px] py-2 px-1',
                'focus:ring-0 text-sm'
              )}
            />

            {/* Voice Input */}
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleRecording}
                disabled={disabled || isTranscribing}
                className={cn(
                  'h-8 w-8 rounded-full flex-shrink-0 mb-1 transition-colors',
                  isRecording && 'text-destructive bg-destructive/10 animate-pulse'
                )}
              >
                {isTranscribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </motion.div>
          </div>
        )}

        {/* Send/Stop/Call Button */}
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          {isLoading && onStop ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onStop}
              className="h-10 w-10 rounded-full flex-shrink-0"
              aria-label="Stop generating"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : showCallButton ? (
            <Button
              variant="xai"
              size="icon"
              onClick={onStartCall}
              disabled={disabled}
              className="h-10 w-10 rounded-full flex-shrink-0"
              aria-label="Start voice call"
            >
              <Phone className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="xai"
              size="icon"
              onClick={handleSubmit}
              disabled={isRecording || (!message.trim() && files.length === 0) || isLoading || disabled}
              className="h-10 w-10 rounded-full flex-shrink-0"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          )}
        </motion.div>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-3">
        X-AI can make mistakes. Consider checking important information.
      </p>
    </div>
  );
};