import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Mic, MicOff, Plus, X, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VoiceVisualizer } from './VoiceVisualizer';
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
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        
        if (finalTranscript) {
          setMessage(prev => prev + finalTranscript + ' ');
        }
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

      {/* Voice Visualizer */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 flex justify-center"
          >
            <div className="px-6 py-3 rounded-2xl bg-gradient-to-r from-xai-cyan/10 to-xai-purple/10 border border-xai-cyan/30">
              <VoiceVisualizer isActive={isRecording} />
              <p className="text-xs text-center text-muted-foreground mt-2">Listening...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

       {/* Input Bar - ChatGPT Style */}
       <div className="flex items-end gap-2">
         {/* Attachment Button - Round */}
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
               <VoiceVisualizer isActive={true} className="w-full max-w-[260px]" />
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
                 "flex-1 resize-none bg-transparent border-0 outline-none",
                 "text-foreground placeholder:text-muted-foreground",
                 "min-h-[40px] max-h-[200px] py-2 px-1",
                 "focus:ring-0 text-sm"
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
                   "h-8 w-8 rounded-full flex-shrink-0 mb-1 transition-colors",
                   isRecording && "text-destructive bg-destructive/10 animate-pulse"
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

         {/* Send Button - Round */}
         <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
           <Button
             variant="xai"
             size="icon"
             onClick={handleSubmit}
             disabled={isRecording || (!message.trim() && files.length === 0) || isLoading || disabled}
             className="h-10 w-10 rounded-full flex-shrink-0"
           >
             {isLoading ? (
               <Loader2 className="h-5 w-5 animate-spin" />
             ) : (
               <Send className="h-4 w-4" />
             )}
           </Button>
         </motion.div>
       </div>

      <p className="text-center text-xs text-muted-foreground mt-3">
        X-AI can make mistakes. Consider checking important information.
      </p>
    </div>
  );
};
