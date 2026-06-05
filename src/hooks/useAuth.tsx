import { useState, useEffect, useRef, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Fire-and-forget — never await inside onAuthStateChange to avoid the
// Supabase race-condition deadlock that randomly breaks manual logins.
const updateLastSeen = (userId: string) => {
  void supabase
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('user_id', userId)
    .then(({ error }) => {
      if (error) console.warn('Failed to update last_seen_at:', error.message);
    });
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    // 1) Subscribe FIRST so we never miss an event during restoration.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        userIdRef.current = nextSession?.user?.id ?? null;
        setLoading(false);

        if (nextSession?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
          updateLastSeen(nextSession.user.id);
        }
      }
    );

    // 2) Then restore the existing session from storage.
    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      userIdRef.current = existing?.user?.id ?? null;
      setLoading(false);
      if (existing?.user) updateLastSeen(existing.user.id);
    });

    // 3) Periodic last-seen ping — independent of auth re-subscription.
    const intervalId = setInterval(() => {
      if (userIdRef.current) updateLastSeen(userIdRef.current);
    }, 5 * 60 * 1000);

    return () => {
      subscription.unsubscribe();
      clearInterval(intervalId);
    };
  }, []); // mount once — do NOT depend on user.id (that re-subscribes and clobbers sessions)

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl },
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
