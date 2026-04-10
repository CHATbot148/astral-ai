import { memo } from 'react';
import { motion } from 'framer-motion';
import { Code, Brain, FileText, ImagePlus } from 'lucide-react';
import astrazLogo from '@/assets/astraz-logo.png';

interface WelcomeScreenProps {
  onSuggestionClick: (suggestion: string) => void;
  onGenerateImage?: () => void;
}

const suggestions = [
  { icon: Code, title: 'Write code', description: 'Help me write a React component' },
  { icon: Brain, title: 'Brainstorm ideas', description: 'Generate creative ideas for my project' },
  { icon: FileText, title: 'Analyze documents', description: 'Summarize and extract insights' },
  { icon: ImagePlus, title: 'Generate Image', description: 'Create an AI-generated image', isImageAction: true },
];

export const WelcomeScreen = memo(({ onSuggestionClick, onGenerateImage }: WelcomeScreenProps) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, type: 'spring', stiffness: 200 }}
        className="mb-6 relative"
      >
        <img
          src={astrazLogo}
          alt="Astraz"
          className="w-20 h-20 object-contain drop-shadow-[0_0_30px_hsl(270_80%_60%/0.35)]"
        />
        <motion.div
          className="absolute -inset-6 rounded-full bg-gradient-to-br from-xai-purple/15 to-xai-cyan/15 blur-2xl -z-10"
          animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.7, 0.5] }}
          transition={{ duration: 4, repeat: Infinity }}
        />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="text-3xl md:text-4xl font-display font-bold mb-3 text-center"
      >
        Welcome to <span className="xai-gradient-text">Astraz</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="text-base text-muted-foreground text-center max-w-md mb-10"
      >
        Your intelligent AI assistant. How can I help you today?
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-xl"
      >
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion.title}
            onClick={() => suggestion.isImageAction && onGenerateImage ? onGenerateImage() : onSuggestionClick(suggestion.description)}
            className="group p-4 rounded-2xl bg-card border border-border/60 hover:border-primary/30 hover:shadow-[0_2px_20px_-4px_hsl(var(--xai-purple)/0.15)] transition-all duration-200 text-left"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-xai-purple/12 to-xai-cyan/12 group-hover:from-xai-purple/20 group-hover:to-xai-cyan/20 transition-colors">
                <suggestion.icon className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  {suggestion.title}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">{suggestion.description}</p>
              </div>
            </div>
          </button>
        ))}
      </motion.div>
    </div>
  );
});

WelcomeScreen.displayName = 'WelcomeScreen';
