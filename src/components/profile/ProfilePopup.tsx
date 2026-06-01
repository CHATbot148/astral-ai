import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { X, LogOut, Trash2, Camera, Sun, Moon, Monitor, Check, User, Loader2, Volume2, ChevronRight, ChevronLeft, BarChart3, Images, Download, ExternalLink, Bot, Brain, MessageSquare, Sparkles, Video, Play, Shield, Bell, Plug } from 'lucide-react';
import { ConnectorsSection } from './ConnectorsSection';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { useSubscription, TIER_CONFIGS } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ImageCropper } from '@/components/chat/ImageCropper';
import { cn } from '@/lib/utils';
import { resolveFileUrl } from '@/lib/storageRef';
import { subscribeToPush } from '@/utils/pushSubscription';
import { MemoryPopup } from './MemoryPopup';
import { AIMode, AISettings, TypingStyle, modeDescriptions, typingStyleDescriptions, getAISettings, saveAISettings } from '@/lib/aiSettings';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ManageSubscription } from '@/components/subscription/ManageSubscription';
import { UpgradeDialog } from '@/components/subscription/UpgradeDialog';

interface ProfilePopupProps {
  isOpen: boolean;
  onClose: () => void;
  profile: {
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  onProfileUpdate: () => void;
}

type Section = 'main' | 'account' | 'voice' | 'theme' | 'usage' | 'gallery' | 'ai_settings' | 'connectors';

interface GeneratedImage {
  id: string;
  prompt: string;
  image_url: string;
  created_at: string;
  resolvedUrl?: string;
}

interface GeneratedVideo {
  id: string;
  prompt: string;
  video_url: string;
  created_at: string;
  resolvedUrl?: string;
}

type GalleryItem = {
  id: string;
  prompt: string;
  url: string;
  resolvedUrl?: string;
  created_at: string;
  type: 'image' | 'video';
};

interface UsageStats {
  messagesSent: number;
  imagesGenerated: number;
  remainingImageToday: number;
  imageDailyLimit: number;
  videosGenerated: number;
  remainingVideoToday: number;
  videoDailyLimit: number;
}

type GalleryFilter = 'all' | 'images' | 'videos';

const CEO_EMAIL = "khaleelktn@gmail.com";

export const ProfilePopup = ({ isOpen, onClose, profile, onProfileUpdate }: ProfilePopupProps) => {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { tier, tierConfig, remainingImages, remainingVideos, dailyUsage } = useSubscription();
  const { toast } = useToast();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [name, setName] = useState(profile?.full_name || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(() =>
    localStorage.getItem('xai-tts-voice') || 'asteria'
  );
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('main');
  
  // Gallery state
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [isLoadingGallery, setIsLoadingGallery] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>('all');
  const [previewItem, setPreviewItem] = useState<GalleryItem | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  
  // Usage state
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);

  // AI Settings state
  const [aiSettings, setAiSettings] = useState<AISettings>(() => getAISettings());
  const [showMemoryPopup, setShowMemoryPopup] = useState(false);

  // Language search
  const [langSearch, setLangSearch] = useState('');

  // Upgrade dialog
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<'image_limit' | 'video_limit' | 'general'>('general');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationPref, setNotificationPref] = useState<'push_and_email' | 'push_only' | 'email_only'>('push_and_email');
  const [isTogglingNotifications, setIsTogglingNotifications] = useState(false);
  useEffect(() => {
    if (isOpen && profile?.full_name) {
      setName(profile.full_name);
    }
    if (isOpen) {
      setAiSettings(getAISettings());
      // Load notification preference
      if (user) {
      supabase.from('profiles').select('notifications_enabled, notification_preference').eq('user_id', user.id).single()
          .then(({ data }) => {
            if (data) {
              setNotificationsEnabled(data.notifications_enabled);
              setNotificationPref((data as any).notification_preference || 'push_and_email');
            }
          });
      }
    }
    if (!isOpen) {
      setSelectedImage(null);
      setShowCropper(false);
      setShowDeleteConfirm(false);
      setDeletePassword('');
      setActiveSection('main');
    }
  }, [isOpen, profile?.full_name]);

  useEffect(() => {
    if (activeSection === 'gallery' && user) {
      loadGallery();
    }
  }, [activeSection, user]);

  useEffect(() => {
    if (activeSection === 'usage' && user) {
      loadUsage();
    }
  }, [activeSection, user]);

  const loadGallery = async () => {
    if (!user) return;
    setIsLoadingGallery(true);
    
    try {
      // Load images and videos in parallel
      const [{ data: images }, { data: videos }] = await Promise.all([
        supabase
          .from('generated_images')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('generated_videos')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      
      // Create items WITHOUT resolving URLs yet (fast)
      const imageItems: GalleryItem[] = (images || []).map((img) => ({
        id: img.id,
        prompt: img.prompt,
        url: img.image_url,
        created_at: img.created_at,
        type: 'image' as const,
      }));
      
      const videoItems: GalleryItem[] = (videos || []).map((vid) => ({
        id: vid.id,
        prompt: vid.prompt,
        url: vid.video_url,
        created_at: vid.created_at,
        type: 'video' as const,
      }));
      
      // Merge and sort by date
      const all = [...imageItems, ...videoItems].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      
      setGalleryItems(all);
      
      // Resolve URLs in background (lazy load)
      const resolveInBackground = async () => {
        const resolved = await Promise.all(
          all.map(async (item) => ({
            ...item,
            resolvedUrl: await resolveFileUrl(item.url, { expiresIn: 60 * 60 }),
          }))
        );
        setGalleryItems(resolved);
      };
      resolveInBackground();
    } catch (error) {
      console.error('Failed to load gallery:', error);
    } finally {
      setIsLoadingGallery(false);
    }
  };

  const loadUsage = async () => {
    if (!user) return;
    setIsLoadingUsage(true);
    
    try {
      const { count: messageCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'user');
      
      const { count: totalImages } = await supabase
        .from('generated_images')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);
      
      const { count: totalVideos } = await supabase
        .from('generated_videos')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { count: todayImages } = await supabase
        .from('generated_images')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', today.toISOString());
      
      const { count: todayVideos } = await supabase
        .from('generated_videos')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', today.toISOString());
      
      const imageDailyLimit = user.email === CEO_EMAIL ? 20 : 5;
      const videoDailyLimit = user.email === CEO_EMAIL ? 5 : 1;
      
      setUsageStats({
        messagesSent: messageCount || 0,
        imagesGenerated: totalImages || 0,
        remainingImageToday: Math.max(0, imageDailyLimit - (todayImages || 0)),
        imageDailyLimit,
        videosGenerated: totalVideos || 0,
        remainingVideoToday: Math.max(0, videoDailyLimit - (todayVideos || 0)),
        videoDailyLimit,
      });
    } catch (error) {
      console.error('Failed to load usage:', error);
    } finally {
      setIsLoadingUsage(false);
    }
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSelectedImage(ev.target?.result as string);
        setShowCropper(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    if (!user) return;
    setShowCropper(false);
    setIsUploadingAvatar(true);
    try {
      const fileName = `${user.id}/avatar-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('chat-files')
        .upload(fileName, croppedBlob, { upsert: true, contentType: 'image/png' });
      if (uploadError) throw uploadError;
      const storageRef = `storage:chat-files/${fileName}`;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: storageRef })
        .eq('user_id', user.id);
      if (updateError) throw updateError;
      setSelectedImage(null);
      onProfileUpdate();
    } catch (error) {
      console.error('Avatar upload error:', error);
      toast({ title: 'Failed to update avatar', variant: 'destructive' });
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
    } catch (error) {
      toast({ title: 'Failed to update name', variant: 'destructive' });
    } finally {
      setIsSavingName(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword || !user?.email) {
      toast({ title: 'Please enter your password', variant: 'destructive' });
      return;
    }
    setIsDeleting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: deletePassword,
      });
      if (signInError) {
        toast({ title: 'Incorrect password', variant: 'destructive' });
        return;
      }
      const { error } = await supabase.functions.invoke('delete-account', { body: {} });
      if (error) throw error;
      await signOut();
      onClose();
    } catch (error) {
      console.error('Delete account error:', error);
      toast({
        title: 'Failed to delete account',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    onClose();
  };

  const playVoiceSample = async (voiceId: string) => {
    try {
      setPreviewingVoiceId(voiceId);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ text: "Hi, I'm Astraz, choose your preferred voice and let's proceed on our adventure", voiceId }),
      });
      if (!resp.ok) throw new Error(`TTS request failed (${resp.status})`);
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("audio")) throw new Error("TTS did not return audio");
      const audioBlob = await resp.blob();
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setPreviewingVoiceId(null); };
      audio.onerror = () => { URL.revokeObjectURL(url); setPreviewingVoiceId(null); };
      await audio.play();
    } catch (e) {
      toast({ title: "Voice sample failed", variant: "destructive" });
      setPreviewingVoiceId(null);
    }
  };

  const downloadMedia = async (url: string, prompt: string, ext: string = 'png') => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `astraz-${prompt.slice(0, 20).replace(/\s+/g, '-')}-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast({ title: 'Failed to download', variant: 'destructive' });
    }
  };

  const themes = [
    { value: 'light' as const, icon: Sun, label: 'Light' },
    { value: 'dark' as const, icon: Moon, label: 'Dark' },
    { value: 'system' as const, icon: Monitor, label: 'System' },
  ];

  const handleAISettingsChange = (updates: Partial<AISettings>) => {
    const newSettings = { ...aiSettings, ...updates };
    setAiSettings(newSettings);
    saveAISettings(newSettings);
  };

  const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const pushSupported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

  const handleToggleNotifications = async (enabled: boolean) => {
    if (!user) return;
    setIsTogglingNotifications(true);
    try {
      if (enabled && pushSupported) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          toast({ title: 'Notification permission denied', description: 'Please allow notifications in your browser settings.', variant: 'destructive' });
          setIsTogglingNotifications(false);
          return;
        }
        // Subscribe to Web Push
        const subscribed = await subscribeToPush(user.id);
        if (subscribed) {
          console.log('Web Push subscription successful');
        } else {
          console.warn('Web Push subscription failed, falling back to email');
        }
      }
      await supabase.from('profiles').update({ notifications_enabled: enabled }).eq('user_id', user.id);
      setNotificationsEnabled(enabled);
      if (enabled && !pushSupported) {
        toast({ title: 'Email reminders enabled', description: 'Push notifications aren\'t available on this device, but you\'ll receive reminders via email and in chat.' });
      } else if (enabled) {
        toast({ title: 'Notifications enabled', description: 'You\'ll receive push notifications and/or emails when reminders are due.' });
      }
    } catch (error) {
      console.error('Notification toggle error:', error);
      toast({ title: 'Failed to update notifications', variant: 'destructive' });
    } finally {
      setIsTogglingNotifications(false);
    }
  };

  const handleNotificationPrefChange = async (pref: 'push_and_email' | 'push_only' | 'email_only') => {
    if (!user) return;
    try {
      await supabase.from('profiles').update({ notification_preference: pref } as any).eq('user_id', user.id);
      setNotificationPref(pref);
    } catch {
      toast({ title: 'Failed to update preference', variant: 'destructive' });
    }
  };

  const voiceOptions = [
    { id: 'asteria', name: 'Asteria', desc: 'Feminine, Professional', gender: 'feminine' },
    { id: 'luna', name: 'Luna', desc: 'Feminine, Soft', gender: 'feminine' },
    { id: 'athena', name: 'Athena', desc: 'Feminine, Gentle', gender: 'feminine' },
    { id: 'hera', name: 'Hera', desc: 'Feminine, Warm', gender: 'feminine' },
    { id: 'stella', name: 'Stella', desc: 'Feminine, Clear', gender: 'feminine' },
    { id: 'aurora', name: 'Aurora', desc: 'Feminine, Bright', gender: 'feminine' },
    { id: 'thalia', name: 'Thalia', desc: 'Feminine, Expressive', gender: 'feminine' },
    { id: 'cordelia', name: 'Cordelia', desc: 'Feminine, Elegant', gender: 'feminine' },
    { id: 'orion', name: 'Orion', desc: 'Masculine, Calm', gender: 'masculine' },
    { id: 'zeus', name: 'Zeus', desc: 'Masculine, Deep', gender: 'masculine' },
    { id: 'helios', name: 'Helios', desc: 'Masculine, Warm', gender: 'masculine' },
    { id: 'arcas', name: 'Arcas', desc: 'Masculine, Smooth', gender: 'masculine' },
    { id: 'perseus', name: 'Perseus', desc: 'Masculine, Bold', gender: 'masculine' },
    { id: 'angus', name: 'Angus', desc: 'Masculine, Rich', gender: 'masculine' },
    { id: 'orpheus', name: 'Orpheus', desc: 'Masculine, Melodic', gender: 'masculine' },
    { id: 'apollo', name: 'Apollo', desc: 'Masculine, Confident', gender: 'masculine' },
  ];

  const displayAvatar = profile?.avatar_url;

  const menuItems = [
    { id: 'account' as Section, icon: User, label: 'Account', desc: 'Profile, logout' },
    { id: 'ai_settings' as Section, icon: Bot, label: 'AI Settings', desc: 'Modes, memory, behavior' },
    { id: 'connectors' as Section, icon: Plug, label: 'Connectors', desc: 'Maps, Gmail, Telegram & more' },
    { id: 'voice' as Section, icon: Volume2, label: 'Voice', desc: 'Text-to-speech voice' },
    { id: 'theme' as Section, icon: Sun, label: 'Theme', desc: 'Light, dark, or system' },
    { id: 'usage' as Section, icon: BarChart3, label: 'Usage', desc: 'Messages, images, videos' },
    { id: 'gallery' as Section, icon: Images, label: 'Gallery', desc: 'Generated images & videos' },
  ];

  // Gallery filtered items
  const filteredGalleryItems = galleryItems.filter(item => {
    if (galleryFilter === 'images') return item.type === 'image';
    if (galleryFilter === 'videos') return item.type === 'video';
    return true;
  });

  // Swipe navigation for gallery preview
  const navigatePreview = useCallback((direction: 'prev' | 'next') => {
    const items = filteredGalleryItems;
    if (items.length === 0) return;
    
    let newIndex: number;
    if (direction === 'next') {
      newIndex = (previewIndex + 1) % items.length;
    } else {
      newIndex = (previewIndex - 1 + items.length) % items.length;
    }
    setPreviewIndex(newIndex);
    setPreviewItem(items[newIndex]);
  }, [filteredGalleryItems, previewIndex]);

  const handleSwipe = useCallback((_: never, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 50) {
      if (info.offset.x > 0) navigatePreview('prev');
      else navigatePreview('next');
    }
  }, [navigatePreview]);

  const openPreview = (item: GalleryItem) => {
    const idx = filteredGalleryItems.findIndex(i => i.id === item.id);
    setPreviewIndex(idx >= 0 ? idx : 0);
    setPreviewItem(item);
  };


  const renderMainMenu = () => (
    <div className="space-y-2">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 mb-4">
        <div className="relative group">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-xai-cyan bg-secondary flex items-center justify-center">
            {displayAvatar ? (
              <img src={displayAvatar} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <User className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingAvatar}
            className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center disabled:cursor-not-allowed"
          >
            {isUploadingAvatar ? (
              <Loader2 className="h-4 w-4 text-white animate-spin" />
            ) : (
              <Camera className="h-4 w-4 text-white" />
            )}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{profile?.full_name || 'User'}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
        </div>
      </div>

      {menuItems.map((item) => (
        <motion.button
          key={item.id}
          onClick={() => setActiveSection(item.id)}
          whileHover={{ x: 4 }}
          className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors text-left"
        >
          <item.icon className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="font-medium text-sm">{item.label}</p>
            <p className="text-xs text-muted-foreground">{item.desc}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </motion.button>
      ))}
    </div>
  );

  const renderAccountSection = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground mb-1.5 block">Name</label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <Button variant="xai" onClick={handleSaveName} disabled={isSavingName || name === profile?.full_name}>
            Save
          </Button>
        </div>
      </div>

      <div>
        <label className="text-sm text-muted-foreground mb-1.5 block">Email</label>
        <Input value={user?.email || ''} disabled className="bg-secondary/50" />
      </div>

      {/* Reminder Notifications */}
      <div className="p-3 rounded-lg bg-secondary/50 border border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Reminder Notifications</p>
              <p className="text-xs text-muted-foreground">
                {pushSupported 
                  ? 'Get push & email notifications for reminders' 
                  : 'Get reminders via email & in-chat alerts'}
              </p>
            </div>
          </div>
          <Switch
            checked={notificationsEnabled}
            onCheckedChange={handleToggleNotifications}
            disabled={isTogglingNotifications}
          />
        </div>

        {notificationsEnabled && (
          <div className="pl-8 space-y-2 border-t border-border pt-2">
            <p className="text-xs text-muted-foreground font-medium">Delivery method</p>
            {([
              { value: 'push_and_email' as const, label: 'Push & Email', desc: 'Both push notifications and email' },
              { value: 'push_only' as const, label: 'Push only', desc: pushSupported ? 'Browser push notifications' : 'In-chat alerts only' },
              { value: 'email_only' as const, label: 'Email only', desc: 'Email reminders to your inbox' },
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => handleNotificationPrefChange(opt.value)}
                className={cn(
                  "w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors",
                  notificationPref === opt.value ? "bg-primary/10 border border-primary/30" : "hover:bg-secondary"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                  notificationPref === opt.value ? "border-primary" : "border-muted-foreground"
                )}>
                  {notificationPref === opt.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Subscription Management */}
      <div className="pt-4 border-t border-border">
        <label className="text-sm text-muted-foreground mb-2 block">Subscription</label>
        <ManageSubscription onUpgrade={() => { setUpgradeReason('general'); setShowUpgradeDialog(true); }} />
      </div>

      {/* Privacy Policy link */}
      <a
        href="/privacy-policy"
        target="_blank"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Shield className="h-4 w-4" />
        Privacy Policy & Terms
      </a>

      <div className="pt-4 space-y-3 border-t border-border">
        <Button variant="outline" className="w-full justify-start gap-2" onClick={handleLogout}>
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
              type="password" placeholder="Password" value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)} className="mb-3"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); }}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDeleteAccount} disabled={isDeleting || !deletePassword}>
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete permanently'}
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );




  const renderAISettingsSection = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">AI Mode</h3>
        <div className="space-y-2">
          {(Object.keys(modeDescriptions) as AIMode[]).map((mode) => {
            const { name, description } = modeDescriptions[mode];
            const isSelected = aiSettings.mode === mode;
            return (
              <motion.button
                key={mode}
                onClick={() => handleAISettingsChange({ mode })}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-all text-left ${
                  isSelected ? 'border-xai-cyan bg-xai-cyan/10' : 'border-border hover:border-xai-cyan/50'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  isSelected ? 'border-xai-cyan bg-xai-cyan' : 'border-muted-foreground'
                }`}>
                  {isSelected && <Check className="h-3 w-3 text-white" />}
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-medium ${isSelected ? 'text-xai-cyan' : ''}`}>{name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                </div>
              </motion.button>
            );
          })}
        </div>

        {aiSettings.mode === 'custom' && (
          <div className="mt-3 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Custom personality instructions
            </label>
            <Textarea
              value={aiSettings.customPrompt}
              onChange={(e) => handleAISettingsChange({ customPrompt: e.target.value })}
              placeholder={`Describe exactly how Astraz should behave. For example:\n"Talk like a sarcastic best friend who roasts me when I'm being silly. Use slang, swear if it fits, and don't be overly polite."`}
              className="min-h-[120px] text-sm resize-y"
              maxLength={2000}
            />
            <p className="text-[11px] text-muted-foreground">
              This only changes the AI's personality and tone. All features (web search, images, reminders, etc.) keep working normally.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Follow-up Questions</p>
            <p className="text-xs text-muted-foreground">Ask follow-up questions for deeper answers</p>
          </div>
        </div>
        <Checkbox
          checked={aiSettings.followUpQuestions}
          onCheckedChange={(checked) => handleAISettingsChange({ followUpQuestions: !!checked })}
        />
      </div>

      <div className="p-3 rounded-lg bg-secondary/50 border border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Typing Animation</p>
              <p className="text-xs text-muted-foreground">How responses appear on screen</p>
            </div>
          </div>
          <Checkbox
            checked={aiSettings.typingAnimation}
            onCheckedChange={(checked) => handleAISettingsChange({ typingAnimation: !!checked })}
          />
        </div>

        {aiSettings.typingAnimation && (
          <div className="space-y-1.5 pt-1 border-t border-border">
            <p className="text-xs text-muted-foreground pt-2">Animation Style</p>
            {(Object.keys(typingStyleDescriptions) as TypingStyle[]).map((style) => {
              const { name, description } = typingStyleDescriptions[style];
              const isSelected = aiSettings.typingStyle === style;
              return (
                <button
                  key={style}
                  onClick={() => handleAISettingsChange({ typingStyle: style })}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all text-sm ${
                    isSelected ? 'bg-xai-cyan/10 text-xai-cyan' : 'hover:bg-secondary text-muted-foreground'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'border-xai-cyan bg-xai-cyan' : 'border-muted-foreground'
                  }`}>
                    {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <div>
                    <p className={`font-medium ${isSelected ? 'text-xai-cyan' : 'text-foreground'}`}>{name}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Button variant="outline" className="w-full justify-start gap-3" onClick={() => setShowMemoryPopup(true)}>
        <Brain className="h-5 w-5 text-xai-purple" />
        <div className="text-left">
          <p className="text-sm font-medium">Memory</p>
          <p className="text-xs text-muted-foreground">View what X-AI remembers about you</p>
        </div>
        <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
      </Button>
    </div>
  );

  const renderVoiceSection = () => {
    const feminineVoices = voiceOptions.filter(v => v.gender === 'feminine');
    const masculineVoices = voiceOptions.filter(v => v.gender === 'masculine');

    const renderVoiceButton = (voice: typeof voiceOptions[0]) => (
      <motion.button
        key={voice.id}
        onClick={() => { setSelectedVoice(voice.id); localStorage.setItem('xai-tts-voice', voice.id); }}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className={`flex items-center justify-between gap-2 p-3 rounded-lg border transition-all text-left ${
          selectedVoice === voice.id ? 'border-xai-cyan bg-xai-cyan/10' : 'border-border hover:border-xai-cyan/50'
        }`}
      >
        <div className="min-w-0">
          <span className={`block text-sm font-medium ${selectedVoice === voice.id ? 'text-xai-cyan' : ''}`}>{voice.name}</span>
          <span className="block text-xs text-muted-foreground">{voice.desc}</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedVoice === voice.id && <Check className="h-4 w-4 text-xai-cyan" />}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full"
            onClick={(e) => { e.stopPropagation(); playVoiceSample(voice.id); }}
            disabled={previewingVoiceId === voice.id}>
            {previewingVoiceId === voice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        </div>
      </motion.button>
    );

    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Select a voice for text-to-speech</p>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Feminine</p>
          <div className="grid grid-cols-1 gap-2">{feminineVoices.map(renderVoiceButton)}</div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Masculine</p>
          <div className="grid grid-cols-1 gap-2">{masculineVoices.map(renderVoiceButton)}</div>
        </div>
      </div>
    );
  };

  const renderThemeSection = () => (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Choose your preferred theme</p>
      <div className="grid grid-cols-3 gap-2">
        {themes.map(({ value, icon: Icon, label }) => (
          <motion.button
            key={value}
            onClick={() => setTheme(value)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${
              theme === value ? 'border-xai-cyan bg-xai-cyan/10' : 'border-border hover:border-xai-cyan/50'
            }`}
          >
            <Icon className={`h-6 w-6 ${theme === value ? 'text-xai-cyan' : 'text-muted-foreground'}`} />
            <span className={`text-sm ${theme === value ? 'text-xai-cyan font-medium' : 'text-muted-foreground'}`}>{label}</span>
            {theme === value && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><Check className="h-4 w-4 text-xai-cyan" /></motion.div>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );

  const renderUsageSection = () => (
    <div className="space-y-4">
      {/* Current plan badge */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
        <div>
          <p className="text-sm font-medium">Current Plan</p>
          <p className="text-xs text-muted-foreground">{TIER_CONFIGS[tier].name}</p>
        </div>
        {tier !== 'ultimate' && (
          <Button variant="xai" size="sm" onClick={() => { setUpgradeReason('general'); setShowUpgradeDialog(true); }}>
            Upgrade
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">Your usage statistics</p>
      {isLoadingUsage ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-xai-cyan" /></div>
      ) : usageStats ? (
        <div className="grid grid-cols-1 gap-3">
          <div className="p-4 rounded-lg bg-secondary/50 border border-border">
            <p className="text-2xl font-bold text-xai-cyan">{usageStats.messagesSent}</p>
            <p className="text-sm text-muted-foreground">Messages sent</p>
          </div>
          <div className="p-4 rounded-lg bg-secondary/50 border border-border">
            <p className="text-2xl font-bold text-xai-purple">{usageStats.imagesGenerated}</p>
            <p className="text-sm text-muted-foreground">Images generated</p>
          </div>
          <div className="p-4 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-xai-cyan">
                  {remainingImages === Infinity ? '∞' : remainingImages} / {tierConfig.limits.imagesPerDay === Infinity ? '∞' : tierConfig.limits.imagesPerDay}
                </p>
                <p className="text-sm text-muted-foreground">Remaining daily images</p>
              </div>
              {remainingImages === 0 && tier !== 'ultimate' && (
                <Button variant="xai" size="sm" onClick={() => { setUpgradeReason('image_limit'); setShowUpgradeDialog(true); }}>
                  Upgrade
                </Button>
              )}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-secondary/50 border border-border">
            <p className="text-2xl font-bold text-xai-purple">{usageStats.videosGenerated}</p>
            <p className="text-sm text-muted-foreground">Videos generated</p>
          </div>
          <div className="p-4 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-xai-purple">
                  {remainingVideos === Infinity ? '∞' : remainingVideos} / {tierConfig.limits.videosPerDay === Infinity ? '∞' : tierConfig.limits.videosPerDay}
                </p>
                <p className="text-sm text-muted-foreground">Remaining daily videos</p>
              </div>
              {tierConfig.limits.videosPerDay === 0 || (remainingVideos === 0 && tier !== 'ultimate') ? (
                <Button variant="xai" size="sm" onClick={() => { setUpgradeReason('video_limit'); setShowUpgradeDialog(true); }}>
                  Upgrade
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">Unable to load usage data</p>
      )}
    </div>
  );

  const renderGallerySection = () => (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-secondary/50">
        {(['all', 'images', 'videos'] as GalleryFilter[]).map((filter) => (
          <button
            key={filter}
            onClick={() => setGalleryFilter(filter)}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              galleryFilter === filter
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {filter === 'all' ? 'All' : filter === 'images' ? 'Images' : 'Videos'}
          </button>
        ))}
      </div>

      {isLoadingGallery ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-xai-cyan" /></div>
      ) : filteredGalleryItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Images className="h-12 w-12 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No media yet</p>
          <p className="text-xs text-muted-foreground mt-1">Generated media will appear here</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filteredGalleryItems.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative group cursor-pointer aspect-square rounded-lg overflow-hidden border border-border bg-secondary"
              onClick={() => openPreview(item)}
            >
              {item.type === 'image' ? (
                <img src={item.resolvedUrl || item.url} alt={item.prompt} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full relative">
                  <video src={item.resolvedUrl || item.url} className="w-full h-full object-cover" preload="metadata" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                      <Play className="h-5 w-5 text-white ml-0.5" />
                    </div>
                  </div>
                </div>
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <ExternalLink className="h-6 w-6 text-white" />
              </div>
              {item.type === 'video' && (
                <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">
                  <Video className="h-3 w-3 inline mr-0.5" />VIDEO
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Preview Modal with Swipe */}
      <AnimatePresence>
        {previewItem && (
          <div 
            className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewItem(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              onDragEnd={handleSwipe as any}
              className="relative max-w-lg w-full rounded-xl overflow-hidden bg-card"
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setPreviewItem(null)}
                className="absolute top-2 right-2 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Navigation arrows */}
              {filteredGalleryItems.length > 1 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigatePreview('prev'); }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigatePreview('next'); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
              
              {previewItem.type === 'image' ? (
                <img src={previewItem.resolvedUrl || previewItem.url} alt={previewItem.prompt} className="w-full max-h-[50vh] object-contain" />
              ) : (
                <video src={previewItem.resolvedUrl || previewItem.url} controls autoPlay className="w-full max-h-[50vh]" />
              )}
              
              <div className="p-4 space-y-3">
                <p className="text-sm font-medium line-clamp-2">{previewItem.prompt}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {new Date(previewItem.created_at).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {previewIndex + 1} / {filteredGalleryItems.length}
                  </p>
                </div>
                <Button
                  variant="xai" size="sm" className="w-full gap-2"
                  onClick={() => downloadMedia(
                    previewItem.resolvedUrl || previewItem.url,
                    previewItem.prompt,
                    previewItem.type === 'video' ? 'mp4' : 'png'
                  )}
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  const renderSection = () => {
    switch (activeSection) {
      case 'account': return renderAccountSection();
      case 'ai_settings': return renderAISettingsSection();
      case 'connectors': return <ConnectorsSection />;
      case 'voice': return renderVoiceSection();
      case 'theme': return renderThemeSection();
      case 'usage': return renderUsageSection();
      case 'gallery': return renderGallerySection();
      default: return renderMainMenu();
    }
  };

  const sectionTitles: Record<Section, string> = {
    main: 'Settings',
    account: 'Account',
    ai_settings: 'AI Settings',
    connectors: 'Connectors',
    voice: 'Voice',
    theme: 'Theme',
    usage: 'Usage',
    gallery: 'Gallery',
  };

  return (
    <>
      <UpgradeDialog isOpen={showUpgradeDialog} onClose={() => setShowUpgradeDialog(false)} reason={upgradeReason} />
      <MemoryPopup isOpen={showMemoryPopup} onClose={() => setShowMemoryPopup(false)} />

      <AnimatePresence>
        {showCropper && selectedImage && (
          <ImageCropper
            imageSrc={selectedImage}
            onCropComplete={handleCropComplete}
            onCancel={() => { setShowCropper(false); setSelectedImage(null); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
                  <div className="flex items-center justify-between mb-6">
                    {activeSection !== 'main' ? (
                      <button
                        onClick={() => setActiveSection('main')}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronRight className="h-4 w-4 rotate-180" />
                        Back
                      </button>
                    ) : (
                      <div />
                    )}
                    <h2 className="text-xl font-display font-semibold">{sectionTitles[activeSection]}</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                      <X className="h-5 w-5" />
                    </Button>
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeSection}
                      initial={{ opacity: 0, x: activeSection === 'main' ? -20 : 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: activeSection === 'main' ? 20 : -20 }}
                      transition={{ duration: 0.2 }}
                    >
                      {renderSection()}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
