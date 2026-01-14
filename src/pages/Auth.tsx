import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import xaiLogo from '@/assets/xai-logo.png';

const emailSchema = z.string().email('Please enter a valid email address');
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');

type AuthStep = 'credentials' | 'verify-otp';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState<AuthStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; otp?: string }>({});

  const { user, signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};
    
    try {
      emailSchema.parse(email);
    } catch (e) {
      if (e instanceof z.ZodError) {
        newErrors.email = e.errors[0].message;
      }
    }

    try {
      passwordSchema.parse(password);
    } catch (e) {
      if (e instanceof z.ZodError) {
        newErrors.password = e.errors[0].message;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSendOtp = async () => {
    if (!validateForm()) return;

    setSendingOtp(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-otp', {
        body: { email, name },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Verification code sent!',
        description: 'Check your email for the 6-digit code.',
      });
      setStep('verify-otp');
    } catch (error) {
      toast({
        title: 'Failed to send code',
        description: error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      setErrors({ otp: 'Please enter the 6-digit code' });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: { email, otp, password, name },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Welcome to X-AI!',
        description: 'Your account has been created. Please log in.',
      });

      // Switch to login mode
      setIsLogin(true);
      setStep('credentials');
      setOtp('');
    } catch (error) {
      toast({
        title: 'Verification failed',
        description: error instanceof Error ? error.message : 'Invalid code',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    try {
      const { error } = await signIn(email, password);
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          toast({
            title: 'Login failed',
            description: 'Invalid email or password. Please try again.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Login failed',
            description: error.message,
            variant: 'destructive',
          });
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      toast({
        title: 'Google sign in failed',
        description: error.message,
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      await handleLogin(e);
    } else {
      await handleSendOtp();
    }
  };

  const resendOtp = async () => {
    await handleSendOtp();
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Form */}
      <div className="w-full md:w-1/2 lg:w-1/3 flex items-center justify-center p-6 bg-card">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, type: 'spring' }}
            className="flex items-center gap-3 mb-8"
          >
            <div className="w-12 h-12 rounded-full overflow-hidden xai-glow">
              <img src={xaiLogo} alt="X-AI" className="w-full h-full object-cover" />
            </div>
            <span className="text-2xl font-display font-bold xai-gradient-text">X-AI</span>
          </motion.div>

          <AnimatePresence mode="wait">
            {step === 'credentials' ? (
              <motion.div
                key="credentials"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                {/* Title */}
                <div className="mb-8">
                  <h1 className="text-3xl font-display font-bold mb-2">
                    {isLogin ? 'Welcome back' : 'Create Your Account'}
                  </h1>
                  <p className="text-muted-foreground">
                    {isLogin
                      ? 'Sign in to continue to X-AI'
                      : 'Sign Up to X-AI to continue.'}
                  </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  {!isLogin && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Full name (optional)"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="pl-10 h-12"
                        />
                      </div>
                    </motion.div>
                  )}

                  <div>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setErrors(prev => ({ ...prev, email: undefined }));
                        }}
                        className={`pl-10 h-12 ${errors.email ? 'border-destructive' : ''}`}
                      />
                    </div>
                    {errors.email && (
                      <p className="text-sm text-destructive mt-1">{errors.email}</p>
                    )}
                  </div>

                  <div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setErrors(prev => ({ ...prev, password: undefined }));
                        }}
                        className={`pl-10 h-12 ${errors.password ? 'border-destructive' : ''}`}
                      />
                    </div>
                    {errors.password && (
                      <p className="text-sm text-destructive mt-1">{errors.password}</p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-12 bg-gradient-to-r from-xai-cyan to-xai-purple text-white hover:opacity-90"
                    disabled={loading || sendingOtp}
                  >
                    {(loading || sendingOtp) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        {isLogin ? 'Sign in' : 'Continue'}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </form>

                {/* Divider */}
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">OR</span>
                  </div>
                </div>

                {/* Google Sign In */}
                <Button
                  variant="outline"
                  className="w-full h-12"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                >
                  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </Button>

                {/* Switch Mode */}
                <p className="text-center mt-6 text-muted-foreground">
                  {isLogin ? "Don't have an account?" : 'Already have an account?'}
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setErrors({});
                    }}
                    className="text-xai-cyan hover:underline ml-1 font-medium"
                  >
                    {isLogin ? 'Sign up' : 'Log in'}
                  </button>
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="verify-otp"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                {/* OTP Verification */}
                <div className="mb-8">
                  <h1 className="text-3xl font-display font-bold mb-2">
                    Verify Your Email
                  </h1>
                  <p className="text-muted-foreground">
                    We sent a 6-digit code to <span className="text-foreground font-medium">{email}</span>
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <Input
                      type="text"
                      placeholder="Enter 6-digit code"
                      value={otp}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setOtp(val);
                        setErrors(prev => ({ ...prev, otp: undefined }));
                      }}
                      className={`h-14 text-center text-2xl tracking-[0.5em] font-mono ${errors.otp ? 'border-destructive' : ''}`}
                      maxLength={6}
                    />
                    {errors.otp && (
                      <p className="text-sm text-destructive mt-1">{errors.otp}</p>
                    )}
                  </div>

                  <Button
                    onClick={handleVerifyOtp}
                    className="w-full h-12 bg-gradient-to-r from-xai-cyan to-xai-purple text-white hover:opacity-90"
                    disabled={loading || otp.length !== 6}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Verify & Create Account'
                    )}
                  </Button>

                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      onClick={() => {
                        setStep('credentials');
                        setOtp('');
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={resendOtp}
                      disabled={sendingOtp}
                      className="text-xai-cyan hover:underline disabled:opacity-50"
                    >
                      {sendingOtp ? 'Sending...' : 'Resend code'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Right side - Branding (2/3) */}
      <div className="hidden md:flex md:w-1/2 lg:w-2/3 relative bg-gradient-to-br from-background via-background to-xai-cyan/5 overflow-hidden items-center justify-center">
        {/* Background pattern */}
        <div className="absolute inset-0 auth-bg-pattern opacity-100 dark:opacity-80" />
        
        {/* Large logo in background */}
        <div className="relative z-10 flex flex-col items-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="relative"
          >
            <div className="w-48 md:w-56 lg:w-64 h-48 md:h-56 lg:h-64 rounded-full overflow-hidden xai-glow">
              <img src={xaiLogo} alt="X-AI" className="w-full h-full object-cover" />
            </div>
            <motion.div
              className="absolute -inset-8 rounded-full bg-gradient-to-br from-xai-cyan/20 to-xai-purple/20 blur-3xl -z-10"
              animate={{ scale: [1, 1.1, 1], opacity: [0.4, 0.6, 0.4] }}
              transition={{ duration: 4, repeat: Infinity }}
            />
          </motion.div>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-8 text-3xl md:text-4xl lg:text-5xl font-display font-bold text-foreground/80"
          >
            Made by X-Tech
          </motion.p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
