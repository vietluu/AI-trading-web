"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Dictionary, I18nContextType, Language } from './i18n.types';
import { en } from './dictionaries/en';
import { vi } from './dictionaries/vi';

const STORAGE_KEY = 'trading_agents_lang';
const DEFAULT_LANGUAGE: Language = 'en';

const dictionaries: Record<Language, Dictionary> = { en, vi };

const I18nContext = createContext<I18nContextType>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
  t: en,
});

export function detectBrowserLanguage(): Language {
  if (typeof window === 'undefined' || !navigator.language) {
    return DEFAULT_LANGUAGE;
  }
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('vi')) {
    return 'vi';
  }
  return DEFAULT_LANGUAGE;
}

export function LanguageProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (saved && (saved === 'en' || saved === 'vi')) {
      setLanguageState(saved);
    } else {
      const detected = detectBrowserLanguage();
      setLanguageState(detected);
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, lang);
    }
  };

  const t = dictionaries[language] || en;

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation(): I18nContextType {
  return useContext(I18nContext);
}
