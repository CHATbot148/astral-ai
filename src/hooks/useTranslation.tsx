import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { getSelectedLanguage, setSelectedLanguage as saveLanguage, getLanguageName } from '@/lib/languages';
import { supabase } from '@/integrations/supabase/client';

interface TranslationContextType {
  language: string;
  setLanguage: (code: string) => void;
  t: (text: string) => string;
  isTranslating: boolean;
}

const TranslationContext = createContext<TranslationContextType>({
  language: 'auto',
  setLanguage: () => {},
  t: (text: string) => text,
  isTranslating: false,
});

// In-memory translation cache
const translationCache = new Map<string, string>();

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [language, setLang] = useState(getSelectedLanguage);
  const [translations, setTranslations] = useState<Map<string, string>>(new Map());
  const [isTranslating, setIsTranslating] = useState(false);
  const [pendingTexts, setPendingTexts] = useState<Set<string>>(new Set());

  const setLanguage = useCallback((code: string) => {
    setLang(code);
    saveLanguage(code);
    // Clear translations when language changes
    setTranslations(new Map());
    translationCache.clear();
  }, []);

  // Batch translate pending texts
  useEffect(() => {
    if (language === 'auto' || language === 'en' || pendingTexts.size === 0) return;

    const textsToTranslate = Array.from(pendingTexts).filter(t => !translationCache.has(`${language}:${t}`));
    if (textsToTranslate.length === 0) return;

    const timer = setTimeout(async () => {
      setIsTranslating(true);
      try {
        // Batch translate up to 50 texts at a time
        const batch = textsToTranslate.slice(0, 50);
        const langName = getLanguageName(language);
        
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ texts: batch, targetLanguage: langName }),
        });

        if (!response.ok) throw new Error('Translation failed');
        const data = await response.json();
        
        if (data.translations && Array.isArray(data.translations)) {
          const newTranslations = new Map(translations);
          data.translations.forEach((translated: string, i: number) => {
            const key = `${language}:${batch[i]}`;
            translationCache.set(key, translated);
            newTranslations.set(batch[i], translated);
          });
          setTranslations(newTranslations);
        }
      } catch (error) {
        console.error('Translation error:', error);
      } finally {
        setIsTranslating(false);
        setPendingTexts(new Set());
      }
    }, 300); // Debounce

    return () => clearTimeout(timer);
  }, [pendingTexts, language, translations]);

  const t = useCallback((text: string): string => {
    if (!text || language === 'auto' || language === 'en') return text;
    
    const cacheKey = `${language}:${text}`;
    const cached = translationCache.get(cacheKey);
    if (cached) return cached;
    
    // Check current translations state
    const current = translations.get(text);
    if (current) return current;

    // Queue for translation
    setPendingTexts(prev => {
      const next = new Set(prev);
      next.add(text);
      return next;
    });

    return text; // Return original while translating
  }, [language, translations]);

  return (
    <TranslationContext.Provider value={{ language, setLanguage, t, isTranslating }}>
      {children}
    </TranslationContext.Provider>
  );
}

export const useTranslation = () => useContext(TranslationContext);
