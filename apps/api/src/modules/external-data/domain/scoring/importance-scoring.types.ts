export interface ImportanceAssessment {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reasons: string[];
  scoringVersion: number;
}

export interface ImportanceInput {
  sourceReliabilityScore: number;
  isOfficialSource: boolean;
  category?: string;
  incidentSeverity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  relatedSymbolsCount: number;
  duplicateCount: number;
  publishedAt: Date;
  title: string;
  summary?: string;
  topics?: string[];
  entities?: Array<{ entity: string; entityType: string }>;
}
