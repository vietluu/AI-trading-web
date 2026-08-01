import { Injectable, Logger } from "@nestjs/common";

export interface ContextItem {
  id: string;
  source: string;
  priority: number; // 1 (highest) to 10 (lowest)
  content: string;
  tokens: number;
}

@Injectable()
export class ContextCompressor {
  private readonly logger = new Logger(ContextCompressor.name);

  public deduplicate(items: ContextItem[]): ContextItem[] {
    const seenHashes = new Set<string>();
    const result: ContextItem[] = [];

    for (const item of items) {
      // Basic normalization hash
      const hash = item.content.toLowerCase().trim().slice(0, 100);
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        result.push(item);
      }
    }

    return result;
  }

  public compress(items: ContextItem[], maxTokens: number): { items: ContextItem[]; totalTokens: number } {
    // Deduplicate first
    const uniqueItems = this.deduplicate(items);

    // Sort by priority (1 is highest priority)
    uniqueItems.sort((a, b) => a.priority - b.priority);

    let currentTokens = 0;
    const selected: ContextItem[] = [];

    for (const item of uniqueItems) {
      if (currentTokens + item.tokens <= maxTokens) {
        selected.push(item);
        currentTokens += item.tokens;
      } else {
        this.logger.warn(`Context item ${item.id} (${item.source}) omitted due to token limit (${currentTokens}/${maxTokens})`);
      }
    }

    return { items: selected, totalTokens: currentTokens };
  }
}
