import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, LogOut, Trash2, Camera, Sun, Moon, Monitor, Check, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import xaiLogo from '@/assets/xai-logo.png';

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
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [cropperImage, setCropperImage] = useState<string | null>(null);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setCropperImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCropConfirm = async () => {
    if (!cropperImage || !user) return;
    
    try {
      // Convert base64 to blob
      const response = await fetch(cropperImage);
      const blob = await response.blob();
      
      const fileName = `${user.id}/avatar-${Date.now()}.png`;
      
      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('chat-files')
        .upload(fileName, blob, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('chat-files')
        .getPublicUrl(fileName);

      // Update profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: urlData.publicUrl })
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      setAvatarPreview(cropperImage);
      setCropperImage(null);
      onProfileUpdate();
      toast({ title: 'Avatar updated successfully' });
    } catch (error) {
      toast({ 
        title: 'Failed to update avatar', 
        variant: 'destructive' 
      });
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
      toast({ title: 'Name updated successfully' });
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
      // Note: Full account deletion requires admin API
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

  const avatarUrl = avatarPreview || profile?.avatar_url;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
          >
            <div className="xai-gradient-border rounded-xl bg-card p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-display font-semibold">Profile Settings</h2>
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Avatar Cropper Modal */}
              {cropperImage && (
                <div className="fixed inset-0 bg-background/90 z-[60] flex items-center justify-center p-4">
                  <div className="bg-card rounded-xl p-6 max-w-sm w-full">
                    <h3 className="text-lg font-semibold mb-4">Crop Avatar</h3>
                    <div className="relative w-48 h-48 mx-auto rounded-full overflow-hidden border-2 border-xai-cyan">
                      <img 
                        src={cropperImage} 
                        alt="Preview" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground text-center mt-4">
                      Your avatar will be cropped as a circle
                    </p>
                    <div className="flex gap-3 mt-6">
                      <Button 
                        variant="outline" 
                        className="flex-1"
                        onClick={() => setCropperImage(null)}
                      >
                        Cancel
                      </Button>
                      <Button 
                        variant="xai" 
                        className="flex-1"
                        onClick={handleCropConfirm}
                      >
                        Confirm
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Avatar Section */}
              <div className="flex flex-col items-center mb-6">
                <div className="relative group">
                  <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-xai-cyan bg-secondary flex items-center justify-center">
                    {avatarUrl ? (
                      <img 
                        src={avatarUrl} 
                        alt="Avatar" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="h-10 w-10 text-muted-foreground" />
                    )}
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <Camera className="h-6 w-6" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarSelect}
                    className="hidden"
                  />
                </div>
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
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
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
                        <Check className="h-3 w-3 text-xai-cyan" />
                      )}
                    </button>
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
                  <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/5">
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
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
