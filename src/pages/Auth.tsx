import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, User, Loader2, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable';
import { z } from 'zod';
import astrazLogo from '@/assets/astraz-logo.png';

const emailSchema = z.string().email('Please enter a valid email address');
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');

type AuthStep = 'credentials' | 'verify-otp' | 'forgot-password' | 'reset-password';

const authSpring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 } as const;
const modeButtonClass = (active: boolean) =>
  `relative z-10 flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors duration-300 ${active ? 'text-indigo-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`;

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState<AuthStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; otp?: string; newPassword?: string }>({});

  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();

  useEffect(() => { if (user) navigate('/'); }, [user, navigate]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};
    try { emailSchema.parse(email); } catch (e) {
      if (e instanceof z.ZodError) newErrors.email = e.errors[0].message;
    }
    try { passwordSchema.parse(password); } catch (e) {
      if (e instanceof z.ZodError) newErrors.password = e.errors[0].message;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSendOtp = async () => {
    if (!validateForm()) return;
    setSendingOtp(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-otp', { body: { email, name } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Verification code sent', description: 'Check your email for the 6-digit code.' });
      setStep('verify-otp');
    } catch (error) {
      toast({ title: 'Failed to send code', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    } finally { setSendingOtp(false); }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) { setErrors({ otp: 'Please enter the 6-digit code' }); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', { body: { email, otp, password, name } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Welcome to Astraz', description: 'Your account is ready. Sign in to continue.' });
      setIsLogin(true); setStep('credentials'); setOtp('');
    } catch (error) {
      toast({ title: 'Verification failed', description: error instanceof Error ? error.message : 'Invalid code', variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    try {
      const { error } = await signIn(email, password);
      if (error) {
        toast({ title: 'Login failed', description: error.message.includes('Invalid login credentials') ? 'Invalid email or password.' : error.message, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth('google', { redirect_uri: window.location.origin });
      if (error) {
        toast({ title: 'Google sign in failed', description: error.message, variant: 'destructive' });
        setLoading(false);
      }
    } catch (error) {
      toast({ title: 'Google sign in failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) await handleLogin(e); else await handleSendOtp();
  };

  const switchAuthMode = (nextIsLogin: boolean) => {
    if (nextIsLogin === isLogin) return;
    setErrors({});
    setIsLogin(nextIsLogin);
  };

  const handleForgotPassword = async () => {
    try { emailSchema.parse(email); } catch (e) {
      if (e instanceof z.ZodError) { setErrors({ email: e.errors[0].message }); return; }
    }
    setSendingOtp(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-otp', { body: { email, isPasswordReset: true } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Reset code sent', description: 'Check your email for the 6-digit code.' });
      setStep('reset-password');
    } catch (error) {
      toast({ title: 'Failed to send code', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    } finally { setSendingOtp(false); }
  };

  const handleResetPassword = async () => {
    if (otp.length !== 6) { setErrors({ otp: 'Please enter the 6-digit code' }); return; }
    try { passwordSchema.parse(newPassword); } catch (e) {
      if (e instanceof z.ZodError) { setErrors({ newPassword: e.errors[0].message }); return; }
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', { body: { email, otp, newPassword, isPasswordReset: true } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Password reset successful', description: 'Sign in with your new password.' });
      setStep('credentials'); setIsLogin(true); setOtp(''); setNewPassword(''); setPassword('');
    } catch (error) {
      toast({ title: 'Reset failed', description: error instanceof Error ? error.message : 'Invalid code', variant: 'destructive' });
    } finally { setLoading(false); }
  };

  // Reusable input class — glass field, dark+light adaptive
  const fieldClass =
    'w-full h-14 px-5 rounded-2xl text-[15px] bg-slate-100/60 dark:bg-white/[0.04] border border-transparent ' +
    'text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 ' +
    'focus:outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:border-indigo-500/60 ' +
    'focus:ring-4 focus:ring-indigo-500/15 transition-all';

  return (
    <main className="min-h-[100dvh] w-full md:grid md:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)] flex items-center justify-center p-5 sm:p-6 md:p-0 relative overflow-hidden bg-indigo-50/50 dark:bg-slate-950 md:bg-background">
      <Helmet>
        <title>Sign In | Astraz AI Assistant</title>
        <meta name="description" content="Sign in or create an Astraz account to chat with AI, generate images and videos, and access your conversations across devices." />
        <link rel="canonical" href="https://astraz.lovable.app/auth" />
        <meta property="og:title" content="Sign In | Astraz AI Assistant" />
        <meta property="og:description" content="Sign in or create an Astraz account to chat with AI, generate images and videos, and access your conversations across devices." />
        <meta property="og:url" content="https://astraz.lovable.app/auth" />
      </Helmet>

      {/* Mobile glass backdrop */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden md:hidden">
        <div className="absolute -top-[15%] -left-[15%] w-[65%] h-[65%] rounded-full bg-indigo-500/25 dark:bg-indigo-600/15 blur-[120px]" />
        <div className="absolute -bottom-[20%] -right-[15%] w-[65%] h-[65%] rounded-full bg-cyan-400/25 dark:bg-cyan-500/12 blur-[120px]" />
        {/* Giant blurred Astraz logo as backdrop */}
        <img
          src={astrazLogo}
          alt=""
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[140%] max-w-none h-auto opacity-[0.06] dark:opacity-[0.08] blur-3xl select-none"
        />
      </div>

      {/* Desktop showcase pane — modern, animated, cinematic */}
      <section className="relative hidden md:flex h-full min-h-[100dvh] flex-col justify-between overflow-hidden border-r border-white/5 bg-[#050510] p-12 text-white">
        {/* Animated aurora orbs */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -top-[20%] -left-[10%] h-[70%] w-[70%] rounded-full bg-indigo-500/30 blur-[140px]"
          animate={{ x: [0, 40, -20, 0], y: [0, 30, -10, 0], scale: [1, 1.08, 0.96, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-[25%] -right-[10%] h-[75%] w-[75%] rounded-full bg-fuchsia-500/25 blur-[160px]"
          animate={{ x: [0, -30, 20, 0], y: [0, -20, 15, 0], scale: [1, 1.1, 0.95, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute top-[30%] left-[35%] h-[45%] w-[45%] rounded-full bg-cyan-400/20 blur-[130px]"
          animate={{ x: [0, 20, -30, 0], y: [0, -25, 20, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Grid overlay */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(ellipse at 50% 40%, black 40%, transparent 75%)',
          }}
        />

        {/* Floating particles */}
        {[...Array(14)].map((_, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="pointer-events-none absolute h-1 w-1 rounded-full bg-white/60"
            style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%` }}
            animate={{ y: [0, -20, 0], opacity: [0.15, 0.85, 0.15] }}
            transition={{ duration: 4 + (i % 5), repeat: Infinity, delay: i * 0.3, ease: 'easeInOut' }}
          />
        ))}

        {/* Brand header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex items-center gap-3"
        >
          <motion.div
            animate={{ rotate: [0, 4, -4, 0] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            className="relative"
          >
            <div className="absolute inset-0 rounded-full bg-indigo-500/40 blur-2xl" />
            <img src={astrazLogo} alt="Astraz" className="relative h-14 w-14 object-contain drop-shadow-[0_0_28px_rgba(129,140,248,0.7)]" />
          </motion.div>
          <div>
            <p className="font-display text-2xl font-bold tracking-tight">Astraz</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/50">by Astrinique</p>
          </div>
        </motion.div>

        {/* Hero copy */}
        <div className="relative z-10 max-w-xl">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 backdrop-blur-xl"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">Online · Ready</span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="font-display text-[3.5rem] font-bold leading-[1.05] tracking-tight"
          >
            Your intelligent{' '}
            <span className="relative inline-block bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
              companion.
              <motion.span
                aria-hidden="true"
                className="absolute -inset-x-2 bottom-1 -z-10 h-3 bg-gradient-to-r from-indigo-500/40 to-fuchsia-500/40 blur-xl"
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 max-w-md text-[15px] leading-7 text-white/65"
          >
            Chat, generate cinematic images and videos, analyze files, set reminders — one workspace synced across every device.
          </motion.p>

          {/* Feature pill grid */}
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.55 } } }}
            className="mt-8 grid grid-cols-2 gap-2.5 max-w-md"
          >
            {[
              { icon: '💬', label: 'Multi-model chat' },
              { icon: '🎨', label: 'AI image studio' },
              { icon: '🎬', label: 'Cinematic video' },
              { icon: '🎙️', label: 'Voice calls' },
            ].map((f) => (
              <motion.div
                key={f.label}
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="group flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 backdrop-blur-xl transition-colors hover:border-indigo-400/40 hover:bg-white/[0.06]"
              >
                <span className="text-lg transition-transform group-hover:scale-110">{f.icon}</span>
                <span className="text-[13px] font-medium text-white/85">{f.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Footer attribution */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.9 }}
          className="relative z-10 flex items-center justify-between"
        >
          <a
            href="https://astrinique.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.32em] text-white/45 transition-colors hover:text-white"
          >
            <span className="h-px w-8 bg-white/30 transition-all group-hover:w-12 group-hover:bg-white/60" />
            Made by Astrinique
          </a>
          <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/30">v · 2026</p>
        </motion.div>
      </section>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[400px] md:max-w-md md:justify-self-center"
      >
        <motion.div
          layout
          transition={authSpring}
          className="backdrop-blur-2xl bg-white/75 dark:bg-slate-900/55 md:bg-card md:dark:bg-card border border-white/60 dark:border-white/10 md:border-border rounded-[2.25rem] md:rounded-3xl p-7 sm:p-8 shadow-[0_24px_80px_-20px_rgba(79,70,229,0.35)] dark:shadow-[0_24px_80px_-20px_rgba(0,0,0,0.6)] md:shadow-2xl"
        >

          {/* Brand header */}
          <div className="text-center mb-7">
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              className="inline-block mb-3 active:scale-95 transition-transform"
            >
              <img src={astrazLogo} alt="Astraz" className="w-16 h-16 mx-auto object-contain drop-shadow-[0_0_20px_hsl(244_76%_59%/0.45)]" />
            </button>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Astraz</h1>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Your intelligent companion
            </p>
          </div>

          <AnimatePresence mode="wait">
            {step === 'credentials' && (
              <motion.div
                key="credentials"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                {/* Segmented Sign in / Sign up */}
                <div className="relative grid grid-cols-2 p-1.5 bg-slate-200/60 dark:bg-slate-800/50 rounded-2xl mb-7 overflow-hidden">
                  <span
                    aria-hidden="true"
                    className={`absolute left-1.5 top-1.5 bottom-1.5 w-[calc(50%-0.375rem)] rounded-xl bg-white dark:bg-slate-700 shadow-sm transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] will-change-transform ${isLogin ? 'translate-x-0' : 'translate-x-[calc(100%+0.75rem)]'}`}
                  />
                  <button type="button" onClick={() => switchAuthMode(true)} className={modeButtonClass(isLogin)}>
                    Sign in
                  </button>
                  <button type="button" onClick={() => switchAuthMode(false)} className={modeButtonClass(!isLogin)}>
                    Sign up
                  </button>
                </div>

                {/* Google */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full h-14 px-4 mb-5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-center justify-center gap-3 text-[15px] font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-60"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Continue with Google
                </button>

                {/* Divider */}
                <div className="relative mb-5 text-center">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200 dark:border-slate-800" /></div>
                  <span className="relative px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 bg-white/75 dark:bg-slate-900/55">
                    Or with email
                  </span>
                </div>

                {/* Form */}
                <motion.form layout onSubmit={handleSubmit} className="space-y-3.5" transition={authSpring}>
                  <div className={`grid transition-[grid-template-rows,opacity,transform,filter] duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${isLogin ? 'grid-rows-[0fr] opacity-0 -translate-y-2 blur-sm' : 'grid-rows-[1fr] opacity-100 translate-y-0 blur-0'}`}>
                    <div className="overflow-hidden">
                      <div className="relative pb-0.5">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Full name (optional)"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className={`${fieldClass} pl-11`}
                          autoComplete="name"
                          tabIndex={isLogin ? -1 : 0}
                          aria-hidden={isLogin}
                        />
                      </div>
                    </div>
                  </div>

                  <motion.div layout transition={authSpring}>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setErrors(p => ({ ...p, email: undefined })); }}
                        className={`${fieldClass} pl-11 ${errors.email ? 'border-destructive/70' : ''}`}
                      />
                    </div>
                    {errors.email && <p className="text-xs text-destructive mt-1.5 ml-1">{errors.email}</p>}
                  </motion.div>

                  <motion.div layout transition={authSpring}>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={isLogin ? 'current-password' : 'new-password'}
                        placeholder="Password"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setErrors(p => ({ ...p, password: undefined })); }}
                        className={`${fieldClass} pl-11 pr-12 ${errors.password ? 'border-destructive/70' : ''}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(s => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.password && <p className="text-xs text-destructive mt-1.5 ml-1">{errors.password}</p>}
                  </motion.div>

                  <AnimatePresence initial={false} mode="popLayout">
                    {isLogin && (
                    <motion.div
                      key="forgot-link"
                      layout
                      initial={{ opacity: 0, height: 0, y: -6 }}
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      exit={{ opacity: 0, height: 0, y: -6 }}
                      transition={authSpring}
                      className="flex justify-end overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setStep('forgot-password')}
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500"
                      >
                        Forgot password?
                      </button>
                    </motion.div>
                    )}
                  </AnimatePresence>

                  <button
                    type="submit"
                    disabled={loading || sendingOtp}
                    className="w-full h-14 mt-2 rounded-2xl bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-400 text-white font-bold text-[15px] shadow-[0_10px_30px_-10px_hsl(244_76%_59%/0.6)] active:scale-[0.98] transition-all disabled:opacity-70 flex items-center justify-center"
                  >
                    {(loading || sendingOtp)
                      ? <Loader2 className="h-5 w-5 animate-spin" />
                      : (isLogin ? 'Sign in' : 'Create account')}
                  </button>
                </motion.form>

                <p className="mt-6 text-center text-[10.5px] leading-relaxed text-slate-400 dark:text-slate-500 px-3">
                  By continuing you agree to our{' '}
                  <a href="/privacy-policy" className="text-slate-600 dark:text-slate-300 underline underline-offset-2">Privacy Policy</a>.
                </p>
              </motion.div>
            )}

            {step === 'verify-otp' && (
              <motion.div
                key="verify-otp"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              >
                <div className="mb-6 text-center">
                  <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white mb-1">Verify your email</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Code sent to <span className="text-slate-800 dark:text-slate-200 font-medium">{email}</span></p>
                </div>
                <input
                  type="text" inputMode="numeric" maxLength={6}
                  placeholder="000000" value={otp}
                  onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setErrors(p => ({ ...p, otp: undefined })); }}
                  className={`${fieldClass} h-16 text-center text-2xl tracking-[0.45em] font-mono ${errors.otp ? 'border-destructive/70' : ''}`}
                />
                {errors.otp && <p className="text-xs text-destructive mt-1.5 ml-1">{errors.otp}</p>}
                <button
                  onClick={handleVerifyOtp}
                  disabled={loading || otp.length !== 6}
                  className="w-full h-14 mt-4 rounded-2xl bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 text-white font-bold disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify & create account'}
                </button>
                <div className="flex items-center justify-between text-sm mt-4">
                  <button onClick={() => { setStep('credentials'); setOtp(''); }} className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <button onClick={handleSendOtp} disabled={sendingOtp} className="text-indigo-600 dark:text-indigo-400 font-semibold disabled:opacity-50">
                    {sendingOtp ? 'Sending…' : 'Resend code'}
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'forgot-password' && (
              <motion.div key="forgot" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="mb-6 text-center">
                  <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white mb-1">Forgot password?</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Enter your email to receive a reset code.</p>
                </div>
                <div className="relative mb-3">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="email" inputMode="email" placeholder="Email address" value={email}
                    onChange={(e) => { setEmail(e.target.value); setErrors(p => ({ ...p, email: undefined })); }}
                    className={`${fieldClass} pl-11 ${errors.email ? 'border-destructive/70' : ''}`}
                  />
                </div>
                {errors.email && <p className="text-xs text-destructive mb-2 ml-1">{errors.email}</p>}
                <button
                  onClick={handleForgotPassword} disabled={sendingOtp}
                  className="w-full h-14 mt-2 rounded-2xl bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 text-white font-bold disabled:opacity-60 active:scale-[0.98] transition-all flex items-center justify-center"
                >
                  {sendingOtp ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send reset code'}
                </button>
                <button onClick={() => { setStep('credentials'); setErrors({}); }} className="mt-4 inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                  <ArrowLeft className="h-4 w-4" /> Back to sign in
                </button>
              </motion.div>
            )}

            {step === 'reset-password' && (
              <motion.div key="reset" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="mb-6 text-center">
                  <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white mb-1">Reset password</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Enter the code sent to <span className="text-slate-800 dark:text-slate-200 font-medium">{email}</span></p>
                </div>
                <div className="space-y-3.5">
                  <input
                    type="text" inputMode="numeric" maxLength={6}
                    placeholder="000000" value={otp}
                    onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setErrors(p => ({ ...p, otp: undefined })); }}
                    className={`${fieldClass} h-16 text-center text-2xl tracking-[0.45em] font-mono ${errors.otp ? 'border-destructive/70' : ''}`}
                  />
                  {errors.otp && <p className="text-xs text-destructive ml-1">{errors.otp}</p>}
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      type="password" placeholder="New password" value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setErrors(p => ({ ...p, newPassword: undefined })); }}
                      className={`${fieldClass} pl-11 ${errors.newPassword ? 'border-destructive/70' : ''}`}
                    />
                  </div>
                  {errors.newPassword && <p className="text-xs text-destructive ml-1">{errors.newPassword}</p>}
                  <button
                    onClick={handleResetPassword} disabled={loading || otp.length !== 6}
                    className="w-full h-14 rounded-2xl bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 text-white font-bold disabled:opacity-60 active:scale-[0.98] transition-all flex items-center justify-center"
                  >
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Reset password'}
                  </button>
                  <div className="flex items-center justify-between text-sm">
                    <button onClick={() => { setStep('forgot-password'); setOtp(''); setNewPassword(''); }} className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                      <ArrowLeft className="h-3.5 w-3.5" /> Back
                    </button>
                    <button onClick={handleForgotPassword} disabled={sendingOtp} className="text-indigo-600 dark:text-indigo-400 font-semibold disabled:opacity-50">
                      {sendingOtp ? 'Sending…' : 'Resend code'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Attribution */}
        <div className="mt-6 text-center md:hidden">
          <a
            href="https://astrinique.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
          >
            Made by Astrinique
          </a>
        </div>
      </motion.div>
    </main>
  );
};

export default Auth;
