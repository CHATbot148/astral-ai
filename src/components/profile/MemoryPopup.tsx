 import { useState, useEffect } from 'react';
 import { motion, AnimatePresence } from 'framer-motion';
 import { X, Trash2, Loader2, Brain, Plus } from 'lucide-react';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { supabase } from '@/integrations/supabase/client';
 import { useAuth } from '@/hooks/useAuth';
 import { useToast } from '@/hooks/use-toast';
 
 interface MemoryItem {
   id: string;
   key: string;
   value: string;
   created_at: string;
 }
 
 interface MemoryPopupProps {
   isOpen: boolean;
   onClose: () => void;
 }
 
 export const MemoryPopup = ({ isOpen, onClose }: MemoryPopupProps) => {
   const { user } = useAuth();
   const { toast } = useToast();
   const [memories, setMemories] = useState<MemoryItem[]>([]);
   const [isLoading, setIsLoading] = useState(false);
   const [deletingId, setDeletingId] = useState<string | null>(null);
   const [showAddForm, setShowAddForm] = useState(false);
   const [newKey, setNewKey] = useState('');
   const [newValue, setNewValue] = useState('');
   const [isAdding, setIsAdding] = useState(false);
 
   useEffect(() => {
     if (isOpen && user) {
       loadMemories();
     }
   }, [isOpen, user]);
 
   const loadMemories = async () => {
     if (!user) return;
     setIsLoading(true);
     
     try {
       const { data, error } = await supabase
         .from('user_memory')
         .select('*')
         .eq('user_id', user.id)
         .order('created_at', { ascending: false });
       
       if (error) throw error;
       setMemories(data || []);
     } catch (error) {
       console.error('Failed to load memories:', error);
     } finally {
       setIsLoading(false);
     }
   };
 
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const deleteMemory = async (id: string) => {
    setDeletingId(id);
    setConfirmDeleteId(null);
    try {
      const { error } = await supabase
        .from('user_memory')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      toast({ title: 'Failed to delete memory', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };
 
   const addMemory = async () => {
     if (!user || !newKey.trim() || !newValue.trim()) return;
     setIsAdding(true);
     
     try {
       const { data, error } = await supabase
         .from('user_memory')
         .insert({
           user_id: user.id,
           key: newKey.trim(),
           value: newValue.trim()
         })
         .select()
         .single();
       
       if (error) throw error;
       setMemories(prev => [data, ...prev]);
       setNewKey('');
       setNewValue('');
       setShowAddForm(false);
     } catch (error) {
       toast({ title: 'Failed to add memory', variant: 'destructive' });
     } finally {
       setIsAdding(false);
     }
   };
 
  const clearAllMemories = async () => {
    if (!user) return;
    setConfirmClearAll(false);
    try {
      const { error } = await supabase
        .from('user_memory')
        .delete()
        .eq('user_id', user.id);
      
      if (error) throw error;
      setMemories([]);
    } catch (error) {
      toast({ title: 'Failed to clear memories', variant: 'destructive' });
    }
  };
 
   return (
     <AnimatePresence>
       {isOpen && (
         <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
           <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="absolute inset-0 bg-black/60 backdrop-blur-sm"
             onClick={onClose}
           />
           
           <motion.div
             initial={{ opacity: 0, scale: 0.9, y: 20 }}
             animate={{ opacity: 1, scale: 1, y: 0 }}
             exit={{ opacity: 0, scale: 0.9, y: 20 }}
             transition={{ type: 'spring', damping: 25, stiffness: 300 }}
             className="relative z-10 w-full max-w-md"
           >
             <div className="xai-gradient-border rounded-xl max-h-[85vh] overflow-hidden">
               <div className="xai-gradient-border-content rounded-xl bg-card p-6 max-h-[85vh] overflow-y-auto">
                 {/* Header */}
                 <div className="flex items-center justify-between mb-6">
                   <div className="flex items-center gap-2">
                     <Brain className="h-5 w-5 text-xai-cyan" />
                     <h2 className="text-xl font-display font-semibold">AI Memory</h2>
                   </div>
                   <Button variant="ghost" size="icon" onClick={onClose}>
                     <X className="h-5 w-5" />
                   </Button>
                 </div>
 
                 <p className="text-sm text-muted-foreground mb-4">
                   Astraz remembers important information you share. This helps personalize your experience.
                 </p>
 
                 {/* Add Memory */}
                 {!showAddForm ? (
                   <Button
                     variant="outline"
                     size="sm"
                     className="w-full mb-4 gap-2"
                     onClick={() => setShowAddForm(true)}
                   >
                     <Plus className="h-4 w-4" />
                     Add Memory
                   </Button>
                 ) : (
                   <motion.div
                     initial={{ opacity: 0, height: 0 }}
                     animate={{ opacity: 1, height: 'auto' }}
                     className="mb-4 p-3 rounded-lg bg-secondary/50 border border-border space-y-2"
                   >
                     <Input
                       placeholder="What (e.g., 'Name', 'Birthday')"
                       value={newKey}
                       onChange={(e) => setNewKey(e.target.value)}
                     />
                     <Input
                       placeholder="Value (e.g., 'John', 'March 15')"
                       value={newValue}
                       onChange={(e) => setNewValue(e.target.value)}
                     />
                     <div className="flex gap-2">
                       <Button
                         variant="outline"
                         size="sm"
                         onClick={() => {
                           setShowAddForm(false);
                           setNewKey('');
                           setNewValue('');
                         }}
                       >
                         Cancel
                       </Button>
                       <Button
                         variant="xai"
                         size="sm"
                         onClick={addMemory}
                         disabled={isAdding || !newKey.trim() || !newValue.trim()}
                       >
                         {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                       </Button>
                     </div>
                   </motion.div>
                 )}
 
                 {/* Memories List */}
                 {isLoading ? (
                   <div className="flex items-center justify-center py-12">
                     <Loader2 className="h-6 w-6 animate-spin text-xai-cyan" />
                   </div>
                 ) : memories.length === 0 ? (
                   <div className="flex flex-col items-center justify-center py-12 text-center">
                     <Brain className="h-12 w-12 text-muted-foreground/50 mb-3" />
                     <p className="text-sm text-muted-foreground">No memories saved yet</p>
                     <p className="text-xs text-muted-foreground mt-1">
                       Share things like your name, preferences, or interests
                     </p>
                   </div>
                 ) : (
                   <div className="space-y-2">
                     {memories.map((memory) => (
                        <motion.div
                          key={memory.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="relative flex items-start justify-between gap-3 p-3 rounded-lg bg-secondary/50 border border-border group"
                        >
                         <div className="flex-1 min-w-0">
                           <p className="text-sm font-medium text-xai-cyan">{memory.key}</p>
                           <p className="text-sm text-foreground truncate">{memory.value}</p>
                         </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                            onClick={() => setConfirmDeleteId(memory.id)}
                            disabled={deletingId === memory.id}
                          >
                            {deletingId === memory.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                          {confirmDeleteId === memory.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="absolute right-0 top-full mt-1 z-10 p-2 rounded-lg bg-popover border border-border shadow-lg flex items-center gap-2"
                            >
                              <span className="text-xs text-muted-foreground whitespace-nowrap">Delete?</span>
                              <Button variant="destructive" size="sm" className="h-6 px-2 text-xs" onClick={() => deleteMemory(memory.id)}>Yes</Button>
                              <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>No</Button>
                            </motion.div>
                          )}
                       </motion.div>
                     ))}
                   </div>
                 )}
 
                 {/* Clear All */}
                  {memories.length > 0 && !confirmClearAll && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-4 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmClearAll(true)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Clear all memories
                    </Button>
                  )}
                  {confirmClearAll && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-4 p-3 rounded-lg border border-destructive/50 bg-destructive/5"
                    >
                      <p className="text-xs text-muted-foreground mb-2">Are you sure you want to delete all memories? This cannot be undone.</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setConfirmClearAll(false)}>Cancel</Button>
                        <Button variant="destructive" size="sm" onClick={clearAllMemories}>Delete All</Button>
                      </div>
                    </motion.div>
                  )}
               </div>
             </div>
           </motion.div>
         </div>
       )}
     </AnimatePresence>
   );
 };