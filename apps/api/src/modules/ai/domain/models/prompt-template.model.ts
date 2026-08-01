export interface PromptExample {
  input: string;
  output: string;
}

export interface PromptVersion {
  version: number;
  systemTemplate?: string;
  developerTemplate?: string;
  userTemplate: string;
  contextTemplate?: string;
  examples?: PromptExample[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptTemplateModel {
  id: string;
  name: string;
  description: string;
  currentVersion: number;
  versions: Map<number, PromptVersion>;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptVariables {
  system?: Record<string, unknown>;
  developer?: Record<string, unknown>;
  user: Record<string, unknown>;
  context?: Record<string, unknown>;
  history?: Array<{ role: string; content: string }>;
  tools?: Array<{ name: string; description: string }>;
}

export interface RenderedPrompt {
  templateId: string;
  version: number;
  systemPrompt?: string;
  developerPrompt?: string;
  userPrompt: string;
  contextPrompt?: string;
  fullPrompt: string;
}
