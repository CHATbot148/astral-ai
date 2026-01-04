import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, LogOut, Trash2, Camera, Sun, Moon, Monitor, Check, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ProfilePopupProps {
  isOpen: boolean;
  onClose: () => void;
  profile: {
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  onProfileUpdate: () => void;
}

export const ProfilePopup = ({ isOpen, onClose, profile, onProfileUpdate }: ProfilePopupProps) => {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [name, setName] = useState(profile?.full_name || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(() => 
    localStorage.getItem('xai-tts-voice') || 'JBFqnCBsd6RMkjVDRZzb'
  );

  // Reset state when popup opens/closes
  useEffect(() => {
    if (isOpen && profile?.full_name) {
      setName(profile.full_name);
    }
    if (!isOpen) {
      setSelectedImage(null);
      setSelectedFile(null);
      setShowDeleteConfirm(false);
      setDeletePassword('');
    }
  }, [isOpen, profile?.full_name]);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // allow selecting the same file twice
    e.currentTarget.value = '';

    if (file) {
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Please select an image file', variant: 'destructive' });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: 'Image must be less than 5MB', variant: 'destructive' });
        return;
      }

      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setSelectedImage(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleAvatarUpload = async () => {
    if (!selectedFile || !user) return;

    setIsUploadingAvatar(true);
    try {
      const ext = selectedFile.name.split('.').pop() || 'png';
      const fileName = `${user.id}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-files')
        .upload(fileName, selectedFile, { upsert: true });

      if (uploadError) throw uploadError;

      // Store a storage reference (we'll resolve to signed URL for display)
      const storageRef = `storage:chat-files/${fileName}`;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: storageRef })
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      setSelectedImage(null);
      setSelectedFile(null);
      onProfileUpdate();
      toast({ title: 'Avatar updated successfully!' });
    } catch (error) {
      console.error('Avatar upload error:', error);
      toast({
        title: 'Failed to update avatar',
        variant: 'destructive',
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSaveName = async () => {
    if (!user || !name.trim()) return;
    
    setIsSavingName(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: name.trim() })
        .eq('user_id', user.id);

      if (error) throw error;
      
      onProfileUpdate();
      toast({ title: 'Name updated successfully!' });
    } catch (error) {
      toast({ 
        title: 'Failed to update name', 
        variant: 'destructive' 
      });
    } finally {
      setIsSavingName(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      toast({ 
        title: 'Please enter your password', 
        variant: 'destructive' 
      });
      return;
    }

    setIsDeleting(true);
    try {
      // Verify password by attempting to sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: deletePassword,
      });

      if (signInError) {
        toast({ 
          title: 'Incorrect password', 
          variant: 'destructive' 
        });
        setIsDeleting(false);
        return;
      }

      // Delete user data (RLS will handle cascade)
      await signOut();
      toast({ title: 'Account data cleared. Contact support to fully delete your account.' });
    } catch (error) {
      toast({ 
        title: 'Failed to delete account', 
        variant: 'destructive' 
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    onClose();
  };

  const themes = [
    { value: 'light' as const, icon: Sun, label: 'Light' },
    { value: 'dark' as const, icon: Moon, label: 'Dark' },
    { value: 'system' as const, icon: Monitor, label: 'System' },
  ];

  // Voice options for TTS
  const voiceOptions = [
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', desc: 'Male, British' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', desc: 'Female, American' },
    { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', desc: 'Female, American' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', desc: 'Male, American' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', desc: 'Female, British' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', desc: 'Male, British' },
  ];

  // Show selected image preview or current avatar
  const displayAvatar = selectedImage || profile?.avatar_url;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          
          {/* Popup - centered */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative z-10 w-full max-w-md"
          >
            <div className="xai-gradient-border rounded-xl max-h-[85vh] overflow-hidden">
              <div className="xai-gradient-border-content rounded-xl bg-card p-6 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-display font-semibold">Profile Settings</h2>
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Avatar Section */}
              <div className="flex flex-col items-center mb-6">
                <div className="relative group mb-3">
                  <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-xai-cyan bg-secondary flex items-center justify-center">
                    {displayAvatar ? (
                      <img 
                        src={displayAvatar} 
                        alt="Avatar" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="h-10 w-10 text-muted-foreground" />
                    )}
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <Camera className="h-6 w-6 text-white" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarSelect}
                    className="hidden"
                  />
                </div>
                
                {/* Show confirm button when image is selected */}
                {selectedImage && (
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setSelectedImage(null);
                        setSelectedFile(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button 
                      variant="xai" 
                      size="sm"
                      onClick={handleAvatarUpload}
                      disabled={isUploadingAvatar}
                    >
                      {isUploadingAvatar ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Uploading...
                        </>
                      ) : 'Save Avatar'}
                    </Button>
                  </div>
                )}
                
                {!selectedImage && (
                  <p className="text-xs text-muted-foreground">Click to change avatar</p>
                )}
              </div>

              {/* Email (read-only) */}
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-1.5 block">Email</label>
                <Input 
                  value={user?.email || ''} 
                  disabled 
                  className="bg-secondary/50"
                />
              </div>

              {/* Name (editable) */}
              <div className="mb-6">
                <label className="text-sm text-muted-foreground mb-1.5 block">Name</label>
                <div className="flex gap-2">
                  <Input 
                    value={name} 
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                  />
                  <Button 
                    variant="xai" 
                    onClick={handleSaveName}
                    disabled={isSavingName || name === profile?.full_name}
                  >
                    Save
                  </Button>
                </div>
              </div>

              {/* Theme Selection */}
              <div className="mb-6">
                <label className="text-sm text-muted-foreground mb-3 block">Theme</label>
                <div className="flex gap-2">
                  {themes.map(({ value, icon: Icon, label }) => (
                    <motion.button
                      key={value}
                      onClick={() => setTheme(value)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={`flex-1 flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${
                        theme === value 
                          ? 'border-xai-cyan bg-xai-cyan/10' 
                          : 'border-border hover:border-xai-cyan/50'
                      }`}
                    >
                      <Icon className={`h-5 w-5 ${theme === value ? 'text-xai-cyan' : 'text-muted-foreground'}`} />
                      <span className={`text-xs ${theme === value ? 'text-xai-cyan' : 'text-muted-foreground'}`}>
                        {label}
                      </span>
                      {theme === value && (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                          <Check className="h-3 w-3 text-xai-cyan" />
                        </motion.div>
                      )}
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Voice Selection */}
              <div className="mb-6">
                <label className="text-sm text-muted-foreground mb-3 block">Voice for Text-to-Speech</label>
                <div className="grid grid-cols-2 gap-2">
                  {voiceOptions.map((voice) => (
                    <motion.button
                      key={voice.id}
                      onClick={() => {
                        setSelectedVoice(voice.id);
                        localStorage.setItem('xai-tts-voice', voice.id);
                      }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={`flex flex-col items-start p-2.5 rounded-lg border transition-all text-left ${
                        selectedVoice === voice.id 
                          ? 'border-xai-cyan bg-xai-cyan/10' 
                          : 'border-border hover:border-xai-cyan/50'
                      }`}
                    >
                      <span className={`text-sm font-medium ${selectedVoice === voice.id ? 'text-xai-cyan' : ''}`}>
                        {voice.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{voice.desc}</span>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-2"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </Button>

                {!showDeleteConfirm ? (
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete account
                  </Button>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="p-3 rounded-lg border border-destructive/50 bg-destructive/5"
                  >
                    <p className="text-sm text-destructive mb-3">
                      Enter your password to confirm account deletion:
                    </p>
                    <Input 
                      type="password"
                      placeholder="Password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      className="mb-3"
                    />
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeletePassword('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={handleDeleteAccount}
                        disabled={isDeleting}
                      >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    )}
    </AnimatePresence>
  );
};
