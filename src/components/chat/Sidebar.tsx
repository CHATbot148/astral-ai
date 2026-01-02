import { motion, AnimatePresence } from 'framer-motion';
import { Plus, MessageSquare, Trash2, LogOut, X, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Conversation } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface SidebarProps {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  onSelectConversation: (conv: Conversation) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar = ({
  conversations,
  currentConversation,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  isOpen,
  onClose,
}: SidebarProps) => {
  const { user, signOut } = useAuth();

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ x: isOpen ? 0 : -280 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={cn(
          "fixed lg:relative z-50 w-[280px] h-full flex flex-col",
          "bg-sidebar border-r border-sidebar-border"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
          <motion.div 
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-xai-cyan to-xai-purple flex items-center justify-center xai-glow">
              <span className="font-display font-bold text-sm text-primary-foreground">X</span>
            </div>
            <span className="font-display font-semibold text-lg xai-gradient-text">XAI</span>
          </motion.div>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="lg:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <Button
            variant="xai"
            className="w-full justify-start gap-2"
            onClick={onNewChat}
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        {/* Conversations List */}
        <ScrollArea className="flex-1 px-3">
          <div className="space-y-1 pb-4">
            <AnimatePresence mode="popLayout">
              {conversations.map((conv, index) => (
                <motion.div
                  key={conv.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: index * 0.02 }}
                >
                  <button
                    onClick={() => onSelectConversation(conv)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 group",
                      currentConversation?.id === conv.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{conv.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(conv.updated_at)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteConversation(conv.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>

            {conversations.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No conversations yet</p>
                <p className="text-xs">Start a new chat to begin</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* User Section */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 p-2 rounded-lg bg-sidebar-accent/50">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-xai-cyan to-xai-purple flex items-center justify-center">
              <span className="text-xs font-semibold text-primary-foreground">
                {user?.email?.[0]?.toUpperCase() || 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.email}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              className="h-8 w-8"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.aside>
    </>
  );
};
