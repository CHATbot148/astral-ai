import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, MessageSquare, Trash2, Pencil, ChevronLeft, Search, Check, X, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Conversation } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { ProfilePopup } from '@/components/profile/ProfilePopup';
import xaiLogo from '@/assets/xai-logo.png';

interface SidebarProps {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  onSelectConversation: (conv: Conversation) => void;
  onNewChat: () => void;
  onNewImageChat: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  isOpen: boolean;
  onClose: () => void;
  profile: { full_name: string | null; avatar_url: string | null } | null;
  onProfileUpdate: () => void;
}

export const Sidebar = ({
  conversations,
  currentConversation,
  onSelectConversation,
  onNewChat,
  onNewImageChat,
  onDeleteConversation,
  onRenameConversation,
  isOpen,
  onClose,
  profile,
  onProfileUpdate,
}: SidebarProps) => {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  // Truncate title to 15 chars max
  const truncateTitle = (title: string) => {
    return title.length > 15 ? title.slice(0, 15) + '...' : title;
  };

  const filteredConversations = conversations.filter(conv =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startEditing = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title.slice(0, 15)); // Limit to 15 chars
  };

  const saveEdit = () => {
    if (editingId && editTitle.trim()) {
      // Enforce 15 char limit
      onRenameConversation(editingId, editTitle.trim().slice(0, 15));
    }
    setEditingId(null);
    setEditTitle('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const handleDelete = (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(convId);
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
            <div className="w-8 h-8 rounded-full overflow-hidden xai-glow">
              <img src={xaiLogo} alt="X-AI" className="w-full h-full object-cover" />
            </div>
            <span className="font-display font-semibold text-lg xai-gradient-text">X-AI</span>
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

          <Button
            variant="glass"
            className="w-full justify-start gap-2 mt-2"
            onClick={onNewImageChat}
          >
            <ImageIcon className="h-4 w-4" />
            Image Generator
          </Button>
        </div>

        {/* Search */}
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-secondary/50"
            />
          </div>
        </div>

        {/* Conversations List */}
        <ScrollArea className="flex-1 px-3">
          <div className="space-y-1 pb-4">
            <AnimatePresence mode="popLayout">
              {filteredConversations.map((conv, index) => (
                <motion.div
                  key={conv.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: index * 0.02 }}
                  layout
                >
                  <div
                    onClick={() => !editingId && onSelectConversation(conv)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all duration-200 group/item cursor-pointer",
                      currentConversation?.id === conv.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    
                    <div className="flex-1 min-w-0 overflow-hidden">
                      {editingId === conv.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value.slice(0, 15))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            className="h-6 text-sm px-1"
                            maxLength={15}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              saveEdit();
                            }}
                          >
                            <Check className="h-3 w-3 text-xai-cyan" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEdit();
                            }}
                          >
                            <X className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium truncate">{truncateTitle(conv.title)}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(conv.updated_at)}</p>
                        </>
                      )}
                    </div>
                    
                    {/* Edit and Delete icons - Always visible */}
                    {!editingId && (
                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-60 group-hover/item:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => startEditing(conv, e)}
                          className="p-1.5 rounded hover:bg-secondary/80 transition-colors"
                          title="Rename chat"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(conv.id, e)}
                          className="p-1.5 rounded hover:bg-destructive/20 transition-colors"
                          title="Delete chat"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {filteredConversations.length === 0 && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-8 text-muted-foreground"
              >
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {searchQuery ? 'No matches found' : 'No conversations yet'}
                </p>
                <p className="text-xs">
                  {searchQuery ? 'Try a different search' : 'Start a new chat to begin'}
                </p>
              </motion.div>
            )}
          </div>
        </ScrollArea>

        {/* User Section */}
        <div className="p-3 border-t border-sidebar-border">
          <motion.button
            onClick={() => setProfileOpen(true)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full flex items-center gap-3 p-2 rounded-lg bg-sidebar-accent/50 hover:bg-sidebar-accent transition-colors"
          >
            <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-xai-cyan to-xai-purple flex items-center justify-center">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-semibold text-primary-foreground">
                  {profile?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium truncate">
                {profile?.full_name || user?.email}
              </p>
            </div>
          </motion.button>
        </div>
      </motion.aside>

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation and its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDeleteId) onDeleteConversation(confirmDeleteId);
                setConfirmDeleteId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Profile Popup */}
      <ProfilePopup
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        profile={profile}
        onProfileUpdate={onProfileUpdate}
      />
    </>
  );
};
