import { useState, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, MessageSquare, Trash2, Pencil, Search, Check, X, PanelLeftClose, Sparkles } from 'lucide-react';
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

  const truncateTitle = (title: string) => title.length > 18 ? title.slice(0, 18) + '…' : title;

  const filteredConversations = conversations.filter(conv =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startEditing = useCallback((conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title.slice(0, 18));
  }, []);

  const saveEdit = () => {
    if (editingId && editTitle.trim()) onRenameConversation(editingId, editTitle.trim().slice(0, 18));
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
            className="fixed inset-0 bg-background/70 backdrop-blur-md z-40 lg:hidden" onClick={onClose} />
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={{ x: isOpen ? 0 : -300 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className={cn(
          "fixed lg:relative z-50 w-[290px] h-full flex flex-col overflow-hidden",
          "bg-sidebar/85 backdrop-blur-2xl border-r border-sidebar-border/60",
          "top-0 left-0",
          "shadow-[0_0_60px_hsl(var(--xai-purple)/0.15)]"
        )}
      >
        {/* Decorative gradient orbs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -left-16 w-56 h-56 rounded-full bg-xai-purple/20 blur-3xl" />
          <div className="absolute top-1/2 -right-20 w-48 h-48 rounded-full bg-xai-cyan/15 blur-3xl" />
        </div>

        <div className="relative flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border/50">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-xai-purple to-xai-cyan rounded-full blur-md opacity-50" />
                <img src={astrazLogo} alt="Astraz" className="relative w-10 h-10 object-contain" />
              </div>
              <span className="font-display font-bold text-lg xai-gradient-text">Astraz</span>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="lg:hidden h-8 w-8 rounded-lg" aria-label="Close sidebar">
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>

          {/* New Chat — premium pill button */}
          <div className="p-3">
            <button
              onClick={handleNewChat}
              className="group relative w-full overflow-hidden rounded-2xl p-[1.5px] transition-transform active:scale-[0.98]"
            >
              <span
                className="absolute inset-0 rounded-2xl opacity-90 group-hover:opacity-100 transition-opacity"
                style={{
                  background:
                    'conic-gradient(from 180deg at 50% 50%, hsl(var(--xai-purple)), hsl(var(--xai-cyan)), hsl(var(--xai-purple)))',
                }}
              />
              <span className="relative flex items-center justify-center gap-2 rounded-[14px] bg-sidebar px-4 py-2.5 text-sm font-semibold text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-xai-cyan" />
                New Chat
              </span>
            </button>
          </div>

          {/* Search */}
          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search conversations…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 bg-secondary/40 border-border/40 rounded-xl text-sm focus-visible:ring-xai-purple/40" />
            </div>
          </div>

          {/* Conversations */}
          <ScrollArea className="flex-1 px-2">
            <div className="space-y-1 pb-4">
              {filteredConversations.length > 0 && (
                <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                  Recent
                </p>
              )}
              {filteredConversations.map((conv) => {
                const isActive = currentConversation?.id === conv.id;
                return (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv)}
                    className={cn(
                      "relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all duration-200 group/item cursor-pointer",
                      isActive
                        ? "bg-gradient-to-r from-xai-purple/15 to-xai-cyan/10 text-foreground shadow-[0_2px_12px_hsl(var(--xai-purple)/0.15)]"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-gradient-to-b from-xai-purple to-xai-cyan" />
                    )}
                    <MessageSquare className={cn(
                      "h-3.5 w-3.5 flex-shrink-0 transition-colors",
                      isActive ? "text-xai-cyan" : "text-muted-foreground"
                    )} />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      {editingId === conv.id ? (
                        <div className="flex items-center gap-1">
                          <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value.slice(0, 18))}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            className="h-6 text-sm px-1" maxLength={18} autoFocus onClick={(e) => e.stopPropagation()} />
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
                          <p className="text-[10px] text-muted-foreground/80">{formatDate(conv.updated_at)}</p>
                        </>
                      )}
                    </div>
                    {!editingId && (
                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
                        <button onClick={(e) => startEditing(conv, e)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors" title="Rename" aria-label="Rename">
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </button>
                        <button onClick={(e) => handleDelete(conv.id, e)} className="p-1.5 rounded-lg hover:bg-destructive/15 transition-colors" title="Delete" aria-label="Delete">
                          <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredConversations.length === 0 && (
                <div className="text-center py-12 px-4">
                  <div className="relative w-12 h-12 mx-auto mb-3">
                    <div className="absolute inset-0 bg-gradient-to-br from-xai-purple/40 to-xai-cyan/40 rounded-full blur-xl" />
                    <div className="relative w-12 h-12 rounded-full bg-secondary/60 flex items-center justify-center border border-border/50">
                      <MessageSquare className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>
                  <p className="text-sm font-medium text-foreground/90">{searchQuery ? 'No matches' : 'No conversations yet'}</p>
                  <p className="text-xs mt-1 text-muted-foreground">{searchQuery ? 'Try different terms' : 'Start a new chat to begin'}</p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* User card */}
          <div className="p-3 border-t border-sidebar-border/50">
            <button onClick={() => setProfileOpen(true)}
              className="group w-full flex items-center gap-3 p-2.5 rounded-2xl bg-gradient-to-r from-sidebar-accent/40 to-sidebar-accent/20 hover:from-xai-purple/10 hover:to-xai-cyan/10 transition-all duration-300 border border-border/30 hover:border-xai-cyan/30">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-xai-purple to-xai-cyan rounded-full blur-sm opacity-60 group-hover:opacity-100 transition-opacity" />
                <div className="relative w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-xai-purple to-xai-cyan flex items-center justify-center ring-2 ring-sidebar">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-semibold text-white">
                      {profile?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold truncate">{profile?.full_name || user?.email?.split('@')[0]}</p>
                <p className="text-[10px] text-muted-foreground truncate">View profile</p>
              </div>
            </button>
          </div>
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
