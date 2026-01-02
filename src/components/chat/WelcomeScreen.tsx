import { motion } from 'framer-motion';
import { Code, Brain, FileText, Zap } from 'lucide-react';
import xaiLogo from '@/assets/xai-logo.png';

interface WelcomeScreenProps {
  onSuggestionClick: (suggestion: string) => void;
}

const suggestions = [
  {
    icon: Code,
    title: 'Write code',
    description: 'Help me write a React component',
  },
  {
    icon: Brain,
    title: 'Brainstorm ideas',
    description: 'Generate creative ideas for my project',
  },
  {
    icon: FileText,
    title: 'Analyze documents',
    description: 'Summarize and extract insights',
  },
  {
    icon: Zap,
    title: 'Solve problems',
    description: 'Help me debug this error',
  },
];

export const WelcomeScreen = ({ onSuggestionClick }: WelcomeScreenProps) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, type: 'spring' }}
        className="mb-8"
      >
        <div className="relative">
          <div className="w-24 h-24 rounded-full overflow-hidden xai-glow xai-float">
            <img src={xaiLogo} alt="XAI" className="w-full h-full object-cover" />
          </div>
          <motion.div
            className="absolute -inset-4 rounded-full bg-gradient-to-br from-xai-cyan/20 to-xai-purple/20 blur-xl -z-10"
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        </div>
      </motion.div>

      {/* Title */}
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-4xl md:text-5xl font-display font-bold mb-4 text-center"
      >
        Welcome to <span className="xai-gradient-text">XAI</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-lg text-muted-foreground text-center max-w-md mb-12"
      >
        Your intelligent AI assistant by X-Tech.
        How can I help you today?
      </motion.p>

      {/* Suggestion Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl"
      >
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={suggestion.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + index * 0.1 }}
            onClick={() => onSuggestionClick(suggestion.description)}
            className="group p-4 rounded-xl xai-glass hover:bg-secondary/50 transition-all duration-300 text-left"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-xai-cyan/20 to-xai-purple/20 group-hover:from-xai-cyan/30 group-hover:to-xai-purple/30 transition-colors">
                <suggestion.icon className="h-5 w-5 text-xai-cyan" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-xai-cyan transition-colors">
                  {suggestion.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {suggestion.description}
                </p>
              </div>
            </div>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
};
