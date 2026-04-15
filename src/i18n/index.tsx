import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { de } from './de';
import { en } from './en';

type Language = 'de' | 'en';

const translations = { de, en };

type Translations = typeof de | typeof en;

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    // 1. Gespeicherte Präferenz
    const saved = localStorage.getItem('opencognit_language');
    if (saved === 'de' || saved === 'en') return saved;
    // 2. Browser-Sprache erkennen
    const browserLang = navigator.language?.slice(0, 2).toLowerCase();
    if (browserLang === 'de') return 'de';
    // 3. Fallback: Englisch (global)
    return 'en';
  });

  useEffect(() => {
    localStorage.setItem('opencognit_language', language);
    document.documentElement.lang = language;
    // Persist to backend so agents respond in the right language
    const token = localStorage.getItem('opencognit_token');
    if (token) {
      fetch('/api/einstellungen/ui_language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wert: language, unternehmenId: '' }),
      }).catch(() => {/* fire-and-forget */});
    }
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const t = translations[language];
  const isRTL = false; // Can be extended for Arabic/Hebrew support

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, isRTL }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

// Helper hook for translations
export function useTranslation() {
  const { t, language, setLanguage } = useI18n();
  return { t, language, setLanguage };
}
