import { Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AgentType } from '../../domain/enums';

@Injectable()
export class AgentOutputValidatorService {
  private readonly logger = new Logger(AgentOutputValidatorService.name);

  validate<T>(params: {
    rawOutput: string | Record<string, unknown>;
    outputSchema: ZodType<T>;
    agentType: AgentType;
    runId: string;
  }): { valid: boolean; validatedOutput?: T; rawOutput: string; errors?: string[] } {
    let parsed: unknown = params.rawOutput;
    const rawOutputString = typeof params.rawOutput === 'string' ? params.rawOutput : JSON.stringify(params.rawOutput);

    if (typeof params.rawOutput === 'string') {
      try {
        parsed = JSON.parse(params.rawOutput);
      } catch {
        return {
          valid: false,
          rawOutput: rawOutputString,
          errors: ['Invalid JSON format'],
        };
      }
    }

    const repaired = this.repairKnownStructuralOmissions(parsed, params.agentType);
    const result = params.outputSchema.safeParse(repaired);
    if (result.success) {
      if (repaired !== parsed) {
        this.logger.warn({
          event: 'agent_output_structural_repair_applied',
          agentType: params.agentType,
          runId: params.runId,
        });
      }
      return {
        valid: true,
        validatedOutput: result.data,
        rawOutput: rawOutputString,
      };
    } else {
      return {
        valid: false,
        rawOutput: rawOutputString,
        errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      };
    }
  }

  private repairKnownStructuralOmissions(parsed: unknown, agentType: AgentType): unknown {
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return parsed;
    }

    const output = parsed as Record<string, unknown>;
    if (agentType === AgentType.ON_CHAIN_ANALYST) {
      const missingFlows = output.flows === undefined;
      const missingSignals = output.signals === undefined;
      if (!missingFlows && !missingSignals) return parsed;

      return {
        ...output,
        ...(missingFlows ? { flows: {} } : {}),
        ...(missingSignals ? { signals: [] } : {}),
      };
    }

    if (agentType === AgentType.TECHNICAL_ANALYST) {
      if (output.divergence !== undefined) return parsed;

      return {
        ...output,
        divergence: {
          rsiDivergence: 'NONE',
          macdDivergence: 'NONE',
        },
      };
    }

    if (agentType !== AgentType.MARKET_ANALYST) return parsed;

    const missingLiquidity = output.liquidity === undefined;
    const missingDerivatives = output.derivatives === undefined;
    const missingAnomalies = output.anomalies === undefined;
    if (!missingLiquidity && !missingDerivatives && !missingAnomalies) return parsed;

    return {
      ...output,
      ...(missingLiquidity ? { liquidity: {} } : {}),
      ...(missingDerivatives ? { derivatives: {} } : {}),
      ...(missingAnomalies ? { anomalies: [] } : {}),
    };
  }
}
