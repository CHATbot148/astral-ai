import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff } from 'lucide-react';

export const ConnectionStatus = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showSlow, setShowSlow] = useState(false);

  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); setShowSlow(false); };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Detect slow connection via Network Information API
    const connection = (navigator as any).connection;
    if (connection) {
      const checkSlow = () => {
        const effectiveType = connection.effectiveType;
        setShowSlow(effectiveType === 'slow-2g' || effectiveType === '2g');
      };
      checkSlow();
      connection.addEventListener('change', checkSlow);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        connection.removeEventListener('change', checkSlow);
      };
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const visible = isOffline || showSlow;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-0 left-0 right-0 z-[90] flex items-center justify-center gap-2 py-2 px-4 bg-destructive text-destructive-foreground text-sm font-medium"
        >
          <WifiOff className="h-4 w-4" />
          {isOffline ? 'No internet connection' : 'Slow connection detected — things may take longer'}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
