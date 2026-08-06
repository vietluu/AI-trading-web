import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export interface KnowledgeArchiveItem {
  id: string;
  title: string;
  category: string;
  summary: string;
  content: Record<string, unknown>;
  reproducibleHash: string;
  createdAt: string;
}

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listArchives(category?: string): Promise<KnowledgeArchiveItem[]> {
    try {
      const rows = await (this.prisma as any).knowledgeArchive.findMany({
        where: category ? { category } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        summary: r.summary,
        content: r.contentJson as Record<string, unknown>,
        reproducibleHash: r.reproducibleHash,
        createdAt: r.createdAt.toISOString(),
      }));
    } catch (error) {
      this.logger.warn({
        event: 'knowledge_archive_db_error',
        message: 'Database query failed or unmigrated; returning empty list',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
