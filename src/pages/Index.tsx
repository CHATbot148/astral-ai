import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { Loader2 } from 'lucide-react';
import astrazLogo from '@/assets/astraz-logo.png';

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="aurora-bg" />
        <div className="flex flex-col items-center gap-4">
          <img src={astrazLogo} alt="Astraz" className="w-14 h-14 object-contain xai-pulse drop-shadow-[0_0_20px_hsl(270_80%_60%/0.3)]" />
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
