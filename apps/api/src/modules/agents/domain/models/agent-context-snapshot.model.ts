export interface AgentContextSnapshot {
  readonly id: string;
  readonly userId?: string;
  readonly symbol?: string;
  readonly provider?: string;
  readonly timeframe?: string;
  readonly createdAt: Date;
  readonly sourceDataCutoff: Date;
  readonly schemaVersion: number;
  readonly builderVersion: string;
  readonly contextHash: string;
  readonly tokenEstimate: number;
  readonly marketSnapshotReferences: string[];
  readonly newsReferences: string[];
  readonly macroReferences: string[];
  readonly sentimentReferences: string[];
  readonly userSettingReference?: string;
  readonly memoryReferences: string[];
  readonly serializedContext: Record<string, unknown>;
}
