import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";
import { MemorySearchFilter, SaveMemoryOptions } from "../../domain/models/memory.model";
import { AIMemory, Prisma } from "@prisma/client";

@Injectable()
export class LongMemoryService {
  private readonly logger = new Logger(LongMemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  public async save(options: SaveMemoryOptions): Promise<AIMemory> {
    const expiresAt = options.ttlSeconds
      ? new Date(Date.now() + options.ttlSeconds * 1000)
      : undefined;

    return this.prisma.aIMemory.upsert({
      where: {
        userId_key: {
          userId: options.userId,
          key: options.key,
        },
      },
      create: {
        userId: options.userId,
        sessionId: options.sessionId,
        type: options.type,
        key: options.key,
        content: options.content as unknown as Prisma.InputJsonValue,
        importance: options.importance ?? 50,
        tags: options.tags || [],
        expiresAt,
      },
      update: {
        sessionId: options.sessionId,
        type: options.type,
        content: options.content as unknown as Prisma.InputJsonValue,
        importance: options.importance ?? 50,
        tags: options.tags || [],
        expiresAt,
      },
    });
  }

  public async load(userId: string, key: string): Promise<AIMemory | null> {
    return this.prisma.aIMemory.findUnique({
      where: {
        userId_key: {
          userId,
          key,
        },
      },
    });
  }

  public async search(filter: MemorySearchFilter): Promise<AIMemory[]> {
    const where: Record<string, unknown> = {
      userId: filter.userId,
    };

    if (filter.sessionId) {
      where.sessionId = filter.sessionId;
    }
    if (filter.types && filter.types.length > 0) {
      where.type = { in: filter.types };
    }
    if (filter.tags && filter.tags.length > 0) {
      where.tags = { hasSome: filter.tags };
    }

    return this.prisma.aIMemory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.limit || 20,
    });
  }

  public async delete(userId: string, key: string): Promise<boolean> {
    try {
      await this.prisma.aIMemory.delete({
        where: {
          userId_key: {
            userId,
            key,
          },
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  public async expire(): Promise<number> {
    const result = await this.prisma.aIMemory.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }
}
