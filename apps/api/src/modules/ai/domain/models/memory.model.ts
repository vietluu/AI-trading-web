import type { AIMemoryType } from "@platform/shared";

export interface MemoryRecord {
  id: string;
  userId: string;
  sessionId?: string;
  type: AIMemoryType;
  key: string;
  content: Record<string, unknown>;
  importance: number;
  tags: string[];
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveMemoryOptions {
  userId: string;
  sessionId?: string;
  type: AIMemoryType;
  key: string;
  content: Record<string, unknown>;
  importance?: number;
  tags?: string[];
  ttlSeconds?: number;
}

export interface MemorySearchFilter {
  userId: string;
  sessionId?: string;
  types?: AIMemoryType[];
  tags?: string[];
  query?: string;
  limit?: number;
}
