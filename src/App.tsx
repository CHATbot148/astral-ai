import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { SubscriptionProvider } from "@/hooks/useSubscription";

import { SplashScreen } from "@/components/SplashScreen";
import { PwaSplashScreen } from "@/components/PwaSplashScreen";

const isPwaStandalone = () => {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    // iOS Safari
    (window.navigator as any).standalone === true
  );
};
import { ConnectionStatus } from "@/components/ConnectionStatus";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Payment from "./pages/Payment";

const queryClient = new QueryClient();

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}

const App = () => {
  const [showSplash, setShowSplash] = useState(() => {
    // Only show splash on first visit per session
    const hasShown = sessionStorage.getItem('splash-shown');
    return !hasShown;
  });

  useEffect(() => {
    if (showSplash) {
      sessionStorage.setItem('splash-shown', 'true');
    }
  }, [showSplash]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <SubscriptionProvider>
            <TooltipProvider>
              {showSplash && (isPwaStandalone()
                ? <PwaSplashScreen onComplete={() => setShowSplash(false)} />
                : <SplashScreen onComplete={() => setShowSplash(false)} />
              )}
              <ConnectionStatus />
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/payment" element={<Payment />} />
                  <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
