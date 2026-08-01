import { Injectable, Logger } from "@nestjs/common";
import { MemorySearchFilter, SaveMemoryOptions } from "../../domain/models/memory.model";
import { LongMemoryService } from "./long-memory.service";
import { ShortMemoryService } from "./short-memory.service";
import { AIMemory } from "@prisma/client";

@Injectable()
export class MemoryManagerService {
  private readonly logger = new Logger(MemoryManagerService.name);

  constructor(
    private readonly shortMemory: ShortMemoryService,
    private readonly longMemory: LongMemoryService
  ) {}

  public async save(options: SaveMemoryOptions): Promise<void> {
    // Save to short memory (Redis) for fast key access
    await this.shortMemory.save(options);
    // Save to long memory (Postgres) for persistent history
    await this.longMemory.save(options);
  }

  public async load(userId: string, key: string): Promise<Record<string, unknown> | null> {
    // Attempt fast Redis read first
    const shortRes = await this.shortMemory.load(userId, key);
    if (shortRes) {
      return shortRes;
    }
    // Fall back to Postgres DB
    const longRes = await this.longMemory.load(userId, key);
    if (longRes) {
      return {
        id: longRes.id,
        userId: longRes.userId,
        type: longRes.type,
        key: longRes.key,
        content: longRes.content as Record<string, unknown>,
        importance: longRes.importance,
        tags: longRes.tags,
      };
    }
    return null;
  }

  public async search(filter: MemorySearchFilter): Promise<AIMemory[]> {
    return this.longMemory.search(filter);
  }

  public async delete(userId: string, key: string): Promise<void> {
    await this.shortMemory.delete(userId, key);
    await this.longMemory.delete(userId, key);
  }

  public async expire(): Promise<number> {
    return this.longMemory.expire();
  }
}
