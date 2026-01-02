import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { Loader2 } from 'lucide-react';

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
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-xai-cyan to-xai-purple flex items-center justify-center xai-glow xai-pulse">
            <span className="font-display font-bold text-2xl text-primary-foreground">X</span>
          </div>
          <Loader2 className="h-6 w-6 animate-spin text-xai-cyan" />
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <ChatContainer />;
};

export default Index;
