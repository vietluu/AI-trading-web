export type Language = 'en' | 'vi';

export interface Dictionary {
  nav: {
    overview: string;
    market: string;
    decision: string;
    automation: string;
    trading: string;
    insights: string;
    news: string;
    macro: string;
    sentiment: string;
    agentRuns: string;
    performance: string;
    risk: string;
    portfolio: string;
    settings: string;
    logout: string;
    quantIntelligence: string;
    research: string;
    factors: string;
    strategyLab: string;
    portfolioIntelligence: string;
    recommendations: string;
    knowledge: string;
  };
  common: {
    loading: string;
    error: string;
    save: string;
    cancel: string;
    confirm: string;
    success: string;
    toggleLanguage: string;
  };
  auth: {
    enter2faCode: string;
    totpCodeLabel: string;
    verifyEmailVerified: string;
    verifyEmailNotVerified: string;
    resendVerificationEmail: string;
    verificationEmailRequested: string;
    scanQrCode: string;
  };
}

export interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Dictionary;
}
