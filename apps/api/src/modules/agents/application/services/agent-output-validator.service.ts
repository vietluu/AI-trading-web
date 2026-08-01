import { Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import type { AgentType } from '../../domain/enums';

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

    const result = params.outputSchema.safeParse(parsed);
    if (result.success) {
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
}
