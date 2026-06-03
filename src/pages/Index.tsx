import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { Loader2 } from 'lucide-react';
import astrazLogo from '@/assets/astraz-logo.png';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  // Handle Paystack callback (?reference=... in URL after successful payment)
  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location.href);
    const reference = url.searchParams.get('reference') || url.searchParams.get('trxref');
    if (!reference) return;
    url.searchParams.delete('reference');
    url.searchParams.delete('trxref');
    window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    supabase.functions.invoke('paystack-verify', { body: { reference } }).then(({ data, error }) => {
      if (error || (data as any)?.error) {
        toast({ title: 'Payment verification failed', variant: 'destructive' });
      } else {
        toast({ title: '🎉 Subscription activated!', description: 'Your plan is now active.' });
        // Force subscription refresh
        setTimeout(() => window.location.reload(), 800);
      }
    });
  }, [user, toast]);


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="aurora-bg" />
        <div className="flex flex-col items-center gap-4">
          <img src={astrazLogo} alt="Astraz" className="w-44 h-44 object-contain xai-pulse drop-shadow-[0_0_20px_hsl(270_80%_60%/0.3)]" />
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground animate-pulse">Loading Astraz…</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <ChatContainer />;
};

export default Index;
