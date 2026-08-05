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
  quant: {
    title: string;
    subtitle: string;
    scorecardGrade: string;
    expectedValue: string;
    expectedValueDesc: string;
    profitFactor: string;
    profitFactorDesc: string;
    sharpeCalmar: string;
    sharpeCalmarDesc: string;
    survivalRate: string;
    maxDrawdown: string;
    scorecardHeader: string;
    researchTitle: string;
    researchSubtitle: string;
    factorsTitle: string;
    factorsSubtitle: string;
    strategyLabTitle: string;
    strategyLabSubtitle: string;
    runSimulation: string;
    simulating: string;
    simulationResult: string;
    portfolioTitle: string;
    portfolioSubtitle: string;
    recommendedAllocation: string;
    recommendationsTitle: string;
    recommendationsSubtitle: string;
    problemStatement: string;
    evidenceText: string;
    expectedBenefit: string;
    estimatedRisk: string;
    approveRecommendation: string;
    rejectRecommendation: string;
    knowledgeTitle: string;
    knowledgeSubtitle: string;
  };
  profile: {
    title: string;
    username: string;
    email: string;
    securityVerification: string;
    memberSince: string;
    logout: string;
  };
  security: {
    title: string;
    changePassword: string;
    currentPassword: string;
    newPassword: string;
    activeSessions: string;
    thisDevice: string;
    logOutAllDevices: string;
    twoFactorAuth: string;
    setupAuthenticator: string;
    scanQrCodeTitle: string;
    scanQrCodeDesc: string;
    manualKey: string;
    confirm2FA: string;
    disable2FA: string;
  };
  accountNav: {
    profile: string;
    security: string;
    apiKeys: string;
    sessions: string;
  };
}

export interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Dictionary;
}
