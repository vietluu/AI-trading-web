import { Injectable, Logger } from "@nestjs/common";
import { ToolExecutorService } from "../infrastructure/executors/tool-executor.service";
import { ToolLoopGuard } from "../infrastructure/policies/tool-loop.guard";
import type { ToolResult } from "../domain/contracts/tool-result.contract";
import type { ToolExecutionContext } from "../domain/contracts/tool-context.contract";

export interface RequestedToolCall {
  providerCallId: string;
  toolName: string;
  arguments: unknown;
}

export interface ToolLoopStepResult {
  shouldContinue: boolean;
  stopReason?: string;
  toolResults: Array<{
    providerCallId: string;
    toolName: string;
    result: ToolResult;
  }>;
}

@Injectable()
export class ToolLoopRunnerService {
  private readonly logger = new Logger(ToolLoopRunnerService.name);

  constructor(
    private readonly executor: ToolExecutorService,
    private readonly loopGuard: ToolLoopGuard
  ) {}

  public async runStep(
    requestedCalls: RequestedToolCall[],
    context: ToolExecutionContext,
    history: Array<{ toolName: string; args: unknown }>,
    currentRound: number,
    maxRounds = 5
  ): Promise<ToolLoopStepResult> {
    const results: Array<{ providerCallId: string; toolName: string; result: ToolResult }> = [];

    for (const call of requestedCalls) {
      // Evaluate Loop Guard
      const loopCheck = this.loopGuard.evaluateLoop({
        toolName: call.toolName,
        args: call.arguments,
        history,
        currentRound,
        maxRounds,
      });

      if (!loopCheck.allowed) {
        this.logger.warn(`LoopGuard stopped execution of tool '${call.toolName}': ${loopCheck.reason}`);
        return {
          shouldContinue: false,
          stopReason: loopCheck.reason,
          toolResults: results,
        };
      }

      const invContext: ToolExecutionContext = {
        ...context,
        invocationId: `${context.invocationId}-${call.providerCallId}`,
      };

      const result = await this.executor.execute(call.toolName, call.arguments, invContext);
      results.push({
        providerCallId: call.providerCallId,
        toolName: call.toolName,
        result,
      });

      history.push({ toolName: call.toolName, args: call.arguments });
    }

    return {
      shouldContinue: true,
      toolResults: results,
    };
  }
}
