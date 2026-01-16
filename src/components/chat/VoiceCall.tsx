import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PhoneOff, Mic, MicOff, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VoiceVisualizer } from './VoiceVisualizer';
import { useMicVisualizer } from '@/hooks/useMicVisualizer';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface VoiceCallProps {
  onClose: () => void;
}

// Declare SpeechRecognition type
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export const VoiceCall = ({ onClose }: VoiceCallProps) => {
  const [isListening, setIsListening] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [callDuration, setCallDuration] = useState(0);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callStartRef = useRef<number>(Date.now());
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();
  
  const { levels } = useMicVisualizer({ enabled: isListening && !isMuted, bars: 12 });

  // Update call duration
  useEffect(() => {
    const interval = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - callStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format duration as mm:ss
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Send message to AI and get voice response
  const sendToAI = useCallback(async (text: string) => {
    if (!text.trim()) return;
    
    setAiResponse('');
    
    try {
      // Get AI response
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
          messages: [{ role: 'user', content: text }],
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientTimeISO: new Date().toISOString(),
        }),
      });

      if (!response.ok) throw new Error('AI response failed');

      // Read streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (reader) {
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
              setAiResponse(fullContent);
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      // Speak the response
      if (fullContent) {
        await speakResponse(fullContent);
      }
    } catch (error) {
      console.error('Voice call error:', error);
      toast({
        title: 'Error',
        description: 'Failed to get AI response',
        variant: 'destructive',
      });
    }
  }, [toast]);

  // Speak AI response using TTS
  const speakResponse = async (text: string) => {
    setIsSpeaking(true);
    setIsListening(false);
    
    // Stop any current recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const voiceId = localStorage.getItem('xai-tts-voice') || 'george';

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ text: text.slice(0, 2000), voiceId }),
        }
      );

      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('audio')) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        
        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          // Resume listening after AI finishes speaking
          startListening();
        };
        
        await audio.play();
      } else {
        // Fallback to browser synthesis
        const data = await response.json();
        const utterance = new SpeechSynthesisUtterance(text.slice(0, 2000));
        
        utterance.onend = () => {
          setIsSpeaking(false);
          startListening();
        };
        
        speechSynthesis.speak(utterance);
      }
    } catch (error) {
      console.error('TTS error:', error);
      // Fallback to browser synthesis
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 500));
      utterance.onend = () => {
        setIsSpeaking(false);
        startListening();
      };
      speechSynthesis.speak(utterance);
    }
  };

  // Start listening for user speech
  const startListening = useCallback(() => {
    if (isMuted) return;
    
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

    let finalTranscript = '';
    let lastSpeechTime = Date.now();

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      lastSpeechTime = Date.now();
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += result + ' ';
        } else {
          interimTranscript += result;
        }
      }
      
      setTranscript(finalTranscript + interimTranscript);

      // Clear existing silence timeout
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }

      // Set timeout to detect end of speech (2 seconds of silence)
      silenceTimeoutRef.current = setTimeout(() => {
        if (finalTranscript.trim() && Date.now() - lastSpeechTime >= 1500) {
          recognition.stop();
          sendToAI(finalTranscript.trim());
          finalTranscript = '';
        }
      }, 2000);
    };

    recognition.onerror = (event) => {
      console.error('Recognition error:', event.error);
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setTimeout(startListening, 1000);
      }
    };

    recognition.onend = () => {
      // Don't restart if speaking or muted
      if (!isSpeaking && !isMuted) {
        // If there's pending transcript, send it
        if (finalTranscript.trim()) {
          sendToAI(finalTranscript.trim());
          finalTranscript = '';
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isMuted, isSpeaking, sendToAI, toast]);

  // Initialize listening on mount
  useEffect(() => {
    startListening();
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      speechSynthesis.cancel();
    };
  }, [startListening]);

  // Toggle mute
  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      if (!isSpeaking) {
        startListening();
      }
    } else {
      setIsMuted(true);
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
    }
  };

  // End call
  const endCall = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    speechSynthesis.cancel();
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full">
        {/* Call Status */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-1">X-AI Call</h2>
          <p className="text-muted-foreground">{formatDuration(callDuration)}</p>
        </div>

        {/* Avatar/Visualizer */}
        <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-xai-cyan to-xai-purple flex items-center justify-center">
          {isSpeaking ? (
            <Volume2 className="h-12 w-12 text-white animate-pulse" />
          ) : isListening ? (
            <Mic className="h-12 w-12 text-white" />
          ) : (
            <MicOff className="h-12 w-12 text-white/50" />
          )}
          
          {/* Pulse animation when active */}
          <AnimatePresence>
            {(isListening || isSpeaking) && (
              <motion.div
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute inset-0 rounded-full bg-gradient-to-br from-xai-cyan to-xai-purple"
              />
            )}
          </AnimatePresence>
        </div>

        {/* Voice Visualizer */}
        <div className="w-full max-w-xs">
          <VoiceVisualizer isActive={isListening && !isMuted} levels={levels} />
        </div>

        {/* Status Text */}
        <div className="text-center min-h-[60px]">
          {isSpeaking ? (
            <p className="text-sm text-xai-cyan">X-AI is speaking...</p>
          ) : isListening && !isMuted ? (
            <p className="text-sm text-muted-foreground">
              {transcript || 'Listening...'}
            </p>
          ) : isMuted ? (
            <p className="text-sm text-muted-foreground">Muted</p>
          ) : null}
          
          {aiResponse && !isSpeaking && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
              {aiResponse.slice(0, 100)}...
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          {/* Mute Button */}
          <Button
            variant="secondary"
            size="icon"
            onClick={toggleMute}
            className={cn(
              "h-14 w-14 rounded-full",
              isMuted && "bg-destructive/20 text-destructive"
            )}
          >
            {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>

          {/* End Call Button */}
          <Button
            variant="destructive"
            size="icon"
            onClick={endCall}
            className="h-16 w-16 rounded-full"
          >
            <PhoneOff className="h-7 w-7" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
