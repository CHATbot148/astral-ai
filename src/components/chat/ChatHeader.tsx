import { useEffect, useState } from 'react';
import { ChevronDown, MessageSquareOff, Lock } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getSelectedModel, setSelectedModel, type ChatModel } from '@/lib/modelSelection';
import { useSubscription } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  onTempChat?: () => void;
  onUpgrade?: () => void;
}

export const ChatHeader = ({ onTempChat, onUpgrade }: Props) => {
  const [model, setModel] = useState<ChatModel>(getSelectedModel());
  const { tier } = useSubscription();
  const { toast } = useToast();
  const proAllowed = tier === 'basic' || tier === 'pro' || tier === 'ultimate';

  useEffect(() => {
    const onChange = (e: Event) => setModel((e as CustomEvent).detail);
    window.addEventListener('astraz:model-changed', onChange);
    return () => window.removeEventListener('astraz:model-changed', onChange);
  }, []);

  const pick = (m: ChatModel) => {
    if (m === 'astraz-pro' && !proAllowed) {
      toast({ title: 'Astraz Pro is a paid feature', description: 'Upgrade to Basic, Pro or Ultimate to unlock.', variant: 'destructive' });
      onUpgrade?.();
      return;
    }
    setSelectedModel(m);
    setModel(m);
  };

  return (
    <div className="pointer-events-auto flex items-center gap-1 px-2 py-1 rounded-full bg-card/70 border border-border/60 backdrop-blur-md max-w-full min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-full hover:bg-muted/60 transition-colors text-sm font-medium min-w-0 max-w-[44vw] sm:max-w-none">
            <span className="text-foreground truncate">Astraz</span>
            <span className="text-muted-foreground">{model === 'astraz-pro' ? 'Pro' : ''}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-56">
          <DropdownMenuItem onClick={() => pick('astraz')} className={cn(model === 'astraz' && 'bg-muted')}>
            <div className="flex flex-col">
              <span className="font-medium">Astraz</span>
              <span className="text-xs text-muted-foreground">Default · fast & friendly</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => pick('astraz-pro')} className={cn(model === 'astraz-pro' && 'bg-muted')}>
            <div className="flex flex-col flex-1">
              <span className="font-medium flex items-center gap-1">
                Astraz Pro <span className="text-[10px] uppercase tracking-wider text-primary">Smartest</span>
              </span>
              <span className="text-xs text-muted-foreground">Powered by Gemini · paid tiers</span>
            </div>
            {!proAllowed && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full"
        aria-label="Start temporary chat"
        onClick={onTempChat}
      >
        <MessageSquareOff className="h-4 w-4" />
      </Button>
    </div>
  );
};
