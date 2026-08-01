import { Injectable, Logger } from "@nestjs/common";
import type { ToolResult } from "../../domain/contracts/tool-result.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";
import { ToolExecutorService } from "./tool-executor.service";

export interface ParallelInvocationItem {
  toolName: string;
  arguments: unknown;
}

@Injectable()
export class ParallelToolExecutorService {
  private readonly logger = new Logger(ParallelToolExecutorService.name);

  constructor(private readonly executor: ToolExecutorService) {}

  public async executeParallel(
    items: ParallelInvocationItem[],
    context: ToolExecutionContext,
    maxConcurrency = 3
  ): Promise<ToolResult[]> {
    this.logger.log(`Executing ${items.length} tools in parallel (max concurrency: ${maxConcurrency})`);
    const results: ToolResult[] = [];

    for (let i = 0; i < items.length; i += maxConcurrency) {
      const batch = items.slice(i, i + maxConcurrency);
      const batchPromises = batch.map((item, idx) =>
        this.executor.execute(item.toolName, item.arguments, {
          ...context,
          invocationId: `${context.invocationId}-${i + idx}`,
        })
      );

      const batchResults = await Promise.allSettled(batchPromises);
      for (const res of batchResults) {
        if (res.status === "fulfilled") {
          results.push(res.value);
        } else {
          this.logger.error(`Parallel tool execution rejected: ${res.reason}`);
        }
      }
    }

    return results;
  }
}
