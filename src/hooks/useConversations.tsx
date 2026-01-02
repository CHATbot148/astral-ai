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

  const fetchConversations = async () => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setConversations(data || []);
    } catch (error) {
      console.error('Error fetching conversations:', error);
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

  const selectConversation = async (conversation: Conversation) => {
    setCurrentConversation(conversation);
    await fetchMessages(conversation.id);
  };

  const createConversation = async (firstMessage?: string) => {
    if (!user) return null;

    try {
      const title = firstMessage?.slice(0, 50) || 'New Chat';
      const { data, error } = await supabase
        .from('conversations')
        .insert({ user_id: user.id, title })
        .select()
        .single();

      if (error) throw error;
      
      setConversations(prev => [data, ...prev]);
      setCurrentConversation(data);
      setMessages([]);
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

      setMessages(prev => [...prev, data as Message]);

      // Update conversation timestamp and title if first user message
      if (role === 'user') {
        const updates: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
        
        // Update title to first message if it's still "New Chat"
        const conv = conversations.find(c => c.id === conversationId);
        if (conv?.title === 'New Chat') {
          updates.title = content.slice(0, 50);
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

  const updateMessage = (messageId: string, content: string) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, content } : msg
    ));
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
    deleteConversation,
    startNewChat,
    setMessages,
  };
};
