import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  file_urls: string[] | null;
  created_at: string;
}

export const useConversations = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      fetchConversations();
    } else {
      setConversations([]);
      setCurrentConversation(null);
      setMessages([]);
      setLoading(false);
    }
  }, [user]);

  // Real-time subscription for new messages (e.g. reminders inserted by cron)
  useEffect(() => {
    if (!user) return;
    
    const channel = supabase
      .channel('reminder-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const newMsg = payload.new as Message;
          const isReminder = newMsg.content.startsWith('[REMINDER]');

          if (isReminder && 'Notification' in window && Notification.permission === 'granted') {
            const reminderText = newMsg.content.replace('[REMINDER] ', '');
            new Notification('Astraz Reminder', { body: reminderText, icon: '/astraz-icon.png' });
          }

          if (!currentConversation || newMsg.conversation_id !== currentConversation.id) return;

          setMessages(prev => (prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, currentConversation?.id]);

  const fetchConversations = async (): Promise<Conversation[]> => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      const nextConversations = (data as Conversation[]) || [];
      setConversations(nextConversations);
      return nextConversations;
    } catch (error) {
      console.error('Error fetching conversations:', error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (conversationId: string) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data as Message[]) || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  useEffect(() => {
    if (!user) return;

    const refreshFromBackground = async () => {
      if (document.visibilityState !== 'visible') return;

      const latestConversations = await fetchConversations();

      if (currentConversation?.id) {
        await fetchMessages(currentConversation.id);
        return;
      }

      if (!currentConversation && messages.length > 0) {
        setMessages([]);
      }
    };

    document.addEventListener('visibilitychange', refreshFromBackground);
    window.addEventListener('focus', refreshFromBackground);

    return () => {
      document.removeEventListener('visibilitychange', refreshFromBackground);
      window.removeEventListener('focus', refreshFromBackground);
    };
  }, [user, currentConversation?.id, messages.length]);

  const selectConversation = async (conversation: Conversation) => {
    setCurrentConversation(conversation);
    await fetchMessages(conversation.id);
  };

  const generateSmartTitle = async (message: string): Promise<string> => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-title', {
        body: { message },
      });
      
      if (error || !data?.title) {
        return message.slice(0, 15).trim() || 'New Chat';
      }
      
      return data.title.slice(0, 15);
    } catch {
      return message.slice(0, 15).trim() || 'New Chat';
    }
  };

  const createConversation = async (firstMessage?: string) => {
    if (!user) return null;

    try {
      // Start with temporary title, will update after AI generates one
      const tempTitle = 'New Chat';
      const { data, error } = await supabase
        .from('conversations')
        .insert({ user_id: user.id, title: tempTitle })
        .select()
        .single();

      if (error) throw error;
      
      setConversations(prev => [data, ...prev]);
      setCurrentConversation(data);
      setMessages([]);
      
      // Generate smart title in background
      if (firstMessage) {
        generateSmartTitle(firstMessage).then(async (smartTitle) => {
          await supabase
            .from('conversations')
            .update({ title: smartTitle })
            .eq('id', data.id);
          
          setConversations(prev => prev.map(c => 
            c.id === data.id ? { ...c, title: smartTitle } : c
          ));
          setCurrentConversation(prev => prev?.id === data.id ? { ...prev, title: smartTitle } : prev);
        });
      }
      
      return data;
    } catch (error) {
      console.error('Error creating conversation:', error);
      toast({
        title: 'Error',
        description: 'Failed to create conversation',
        variant: 'destructive',
      });
      return null;
    }
  };

  const addMessage = async (conversationId: string, role: 'user' | 'assistant', content: string, fileUrls?: string[]) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role,
          content,
          file_urls: fileUrls || null,
        })
        .select()
        .single();

      if (error) throw error;

      setMessages(prev => prev.some(msg => msg.id === (data as Message).id) ? prev : [...prev, data as Message]);

      // Update conversation timestamp and title if first user message
      if (role === 'user') {
        const updates: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
        
        // Update title to first message if it's still "New Chat" - limit to 15 chars
        const conv = conversations.find(c => c.id === conversationId);
        if (conv?.title === 'New Chat') {
          updates.title = content.slice(0, 15);
        }

        await supabase
          .from('conversations')
          .update(updates)
          .eq('id', conversationId);

        if (updates.title) {
          setConversations(prev => prev.map(c => 
            c.id === conversationId ? { ...c, ...updates } : c
          ));
          if (currentConversation?.id === conversationId) {
            setCurrentConversation(prev => prev ? { ...prev, ...updates } : null);
          }
        }
      }

      return data as Message;
    } catch (error) {
      console.error('Error adding message:', error);
      throw error;
    }
  };

  const updateMessage = async (messageId: string, content: string) => {
    try {
      const { error } = await supabase
        .from('messages')
        .update({ content })
        .eq('id', messageId);
      
      if (error) throw error;
      
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, content } : msg
      ));
    } catch (error) {
      console.error('Error updating message:', error);
    }
  };

  // Delete messages from a specific index onwards (for edit functionality)
  const deleteMessagesFrom = async (conversationId: string, fromIndex: number) => {
    try {
      const messagesToDelete = messages.slice(fromIndex);
      const idsToDelete = messagesToDelete.map(m => m.id);
      
      if (idsToDelete.length === 0) return;
      
      const { error } = await supabase
        .from('messages')
        .delete()
        .in('id', idsToDelete);
      
      if (error) throw error;
      
      setMessages(prev => prev.slice(0, fromIndex));
    } catch (error) {
      console.error('Error deleting messages:', error);
      throw error;
    }
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId);

      if (error) throw error;

      setConversations(prev => prev.filter(c => c.id !== conversationId));
      
      if (currentConversation?.id === conversationId) {
        setCurrentConversation(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete conversation',
        variant: 'destructive',
      });
    }
  };

  const renameConversation = async (conversationId: string, newTitle: string) => {
    try {
      // Enforce 15 char limit
      const truncatedTitle = newTitle.slice(0, 15);
      const { error } = await supabase
        .from('conversations')
        .update({ title: truncatedTitle })
        .eq('id', conversationId);

      if (error) throw error;

      setConversations(prev => prev.map(c => 
        c.id === conversationId ? { ...c, title: truncatedTitle } : c
      ));
      
      if (currentConversation?.id === conversationId) {
        setCurrentConversation(prev => prev ? { ...prev, title: truncatedTitle } : null);
      }
    } catch (error) {
      console.error('Error renaming conversation:', error);
    }
  };

  const startNewChat = () => {
    setCurrentConversation(null);
    setMessages([]);
  };

  return {
    conversations,
    currentConversation,
    messages,
    loading,
    selectConversation,
    createConversation,
    addMessage,
    updateMessage,
    deleteMessagesFrom,
    deleteConversation,
    renameConversation,
    startNewChat,
    setMessages,
  };
};
