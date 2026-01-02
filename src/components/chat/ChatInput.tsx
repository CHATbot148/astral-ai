import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Mic, MicOff, Plus, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string, files?: File[]) => void;
  isLoading: boolean;
  disabled?: boolean;
}

export const ChatInput = ({ onSend, isLoading, disabled }: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<{ file: File; preview: string | null }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const startRecording = () => {
    try {
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      
      if (!SpeechRecognitionAPI) {
        console.error('Speech recognition not supported');
        return;
      }

      const recognition = new SpeechRecognitionAPI();
      recognitionRef.current = recognition;
      
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecording(true);
        setIsTranscribing(false);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setMessage(prev => {
          // Only update if we're getting new content
          if (event.results[event.results.length - 1].isFinal) {
            return prev + transcript + ' ';
          }
          return prev;
        });
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        setIsTranscribing(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
        setIsTranscribing(false);
      };

      recognition.start();
    } catch (error) {
      console.error('Error starting speech recognition:', error);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
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

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-4">
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
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative group"
                >
                  {preview ? (
                    <div className="w-20 h-20 rounded-lg overflow-hidden border border-border">
                      <img src={preview} alt={file.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-lg bg-secondary flex items-center justify-center border border-border">
                      <span className="text-xs text-muted-foreground truncate px-1 text-center">
                        {file.name.slice(0, 10)}...
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => removeFile(index)}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Bar - ChatGPT Style */}
      <div className="flex items-center gap-2">
        {/* Attachment Button - Round */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="h-12 w-12 rounded-full bg-secondary hover:bg-secondary/80 flex-shrink-0"
        >
          <Plus className="h-5 w-5" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.txt"
        />

        {/* Main Input Container */}
        <div className="flex-1 flex items-center bg-secondary rounded-full px-4">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message XAI..."
            disabled={disabled || isLoading}
            rows={1}
            className={cn(
              "flex-1 resize-none bg-transparent border-0 outline-none",
              "text-foreground placeholder:text-muted-foreground",
              "min-h-[48px] max-h-[200px] py-3 px-1",
              "focus:ring-0"
            )}
          />

          {/* Voice Input */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleRecording}
            disabled={disabled || isTranscribing}
            className={cn(
              "h-8 w-8 rounded-full flex-shrink-0 transition-colors",
              isRecording && "text-destructive bg-destructive/10 animate-pulse"
            )}
          >
            {isTranscribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isRecording ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>

        {/* Send Button - Round */}
        <Button
          variant="xai"
          size="icon"
          onClick={handleSubmit}
          disabled={(!message.trim() && files.length === 0) || isLoading || disabled}
          className="h-12 w-12 rounded-full flex-shrink-0"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-3">
        XAI can make mistakes. Consider checking important information.
      </p>
    </div>
  );
};
