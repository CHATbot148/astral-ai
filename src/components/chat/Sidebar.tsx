import { useState, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, MessageSquare, Trash2, Pencil, Search, Check, X, PanelLeftClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Conversation } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { ProfilePopup } from '@/components/profile/ProfilePopup';
import astrazLogo from '@/assets/astraz-logo.png';

interface SidebarProps {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  onSelectConversation: (conv: Conversation) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  isOpen: boolean;
  onClose: () => void;
  profile: { full_name: string | null; avatar_url: string | null } | null;
  onProfileUpdate: () => void;
}

export const Sidebar = memo(({
  conversations, currentConversation, onSelectConversation,
  onNewChat, onDeleteConversation, onRenameConversation,
  isOpen, onClose, profile, onProfileUpdate,
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
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const truncateTitle = (title: string) => title.length > 15 ? title.slice(0, 15) + '…' : title;

  const filteredConversations = conversations.filter(conv =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startEditing = useCallback((conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title.slice(0, 15));
  }, []);

  const saveEdit = () => {
    if (editingId && editTitle.trim()) onRenameConversation(editingId, editTitle.trim().slice(0, 15));
    setEditingId(null);
    setEditTitle('');
  };

  const cancelEdit = () => { setEditingId(null); setEditTitle(''); };

  const handleDelete = (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(convId);
  };

  const handleSelectConversation = useCallback((conv: Conversation) => {
    if (!editingId) {
      onSelectConversation(conv);
      if (window.innerWidth < 1024) onClose();
    }
  }, [editingId, onSelectConversation, onClose]);

  const handleNewChat = useCallback(() => {
    onNewChat();
    if (window.innerWidth < 1024) onClose();
  }, [onNewChat, onClose]);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 lg:hidden" onClick={onClose} />
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={{ x: isOpen ? 0 : -280 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className={cn(
          "fixed lg:relative z-50 w-[280px] h-full flex flex-col",
          "bg-sidebar border-r border-sidebar-border",
          "top-0 left-0"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <img src={astrazLogo} alt="Astraz AI Assistant Logo" className="w-24 h-24 object-contain drop-shadow-[0_0_12px_hsl(270_80%_60%/0.3)]" />
            <span className="font-display font-semibold text-lg xai-gradient-text">Astraz</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="lg:hidden h-8 w-8" aria-label="Close sidebar">
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        {/* New Chat */}
        <div className="p-3">
          <Button variant="xai" className="w-full justify-start gap-2 rounded-xl" onClick={handleNewChat}>
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        {/* Search */}
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-secondary/50 rounded-xl text-sm" />
          </div>
        </div>

        {/* Conversations */}
        <ScrollArea className="flex-1 px-3">
          <div className="space-y-0.5 pb-4">
            {filteredConversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConversation(conv)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all duration-150 group/item cursor-pointer",
                  currentConversation?.id === conv.id
                    ? "bg-primary/8 text-foreground border border-primary/15"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 border border-transparent"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0 overflow-hidden">
                  {editingId === conv.id ? (
                    <div className="flex items-center gap-1">
                      <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value.slice(0, 15))}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                        className="h-6 text-sm px-1" maxLength={15} autoFocus onClick={(e) => e.stopPropagation()} />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); saveEdit(); }}>
                        <Check className="h-3 w-3 text-primary" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); cancelEdit(); }}>
                        <X className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium truncate">{truncateTitle(conv.title)}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDate(conv.updated_at)}</p>
                    </>
                  )}
                </div>
                {!editingId && (
                  <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
                    <button onClick={(e) => startEditing(conv, e)} className="p-1 rounded-lg hover:bg-secondary/80 transition-colors" title="Rename" aria-label="Rename conversation">
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <button onClick={(e) => handleDelete(conv.id, e)} className="p-1 rounded-lg hover:bg-destructive/15 transition-colors" title="Delete" aria-label="Delete conversation">
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                )}
              </div>
            ))}

            {filteredConversations.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-7 w-7 mx-auto mb-2 opacity-40" />
                <p className="text-sm">{searchQuery ? 'No matches' : 'No conversations yet'}</p>
                <p className="text-xs mt-0.5">{searchQuery ? 'Try different terms' : 'Start a new chat'}</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* User */}
        <div className="p-3 border-t border-sidebar-border">
          <button onClick={() => setProfileOpen(true)}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-sidebar-accent/40 hover:bg-sidebar-accent/70 transition-colors">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-xai-purple to-xai-cyan flex items-center justify-center">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-semibold text-white">
                  {profile?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium truncate">{profile?.full_name || user?.email}</p>
            </div>
          </button>
        </div>
      </motion.aside>

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this conversation.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmDeleteId) onDeleteConversation(confirmDeleteId); setConfirmDeleteId(null); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProfilePopup isOpen={profileOpen} onClose={() => setProfileOpen(false)} profile={profile} onProfileUpdate={onProfileUpdate} />
    </>
  );
});

Sidebar.displayName = 'Sidebar';
