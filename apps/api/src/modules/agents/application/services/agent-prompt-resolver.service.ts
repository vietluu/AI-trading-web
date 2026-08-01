import { Injectable, Logger } from '@nestjs/common';
import { PromptRegistry } from '../../../ai/infrastructure/prompt/prompt-registry';
import { PromptEngineService } from '../../../ai/infrastructure/prompt/prompt-engine.service';
import { RenderedPrompt } from '../../../ai/domain/models/prompt-template.model';
import { AgentError, AgentErrorCode } from '../../domain/errors/agent-errors';
import { createHash } from 'node:crypto';

@Injectable()
export class AgentPromptResolverService {
  private readonly logger = new Logger(AgentPromptResolverService.name);

  constructor(
    private readonly promptRegistry: PromptRegistry,
    private readonly promptEngineService: PromptEngineService,
  ) {}

  public resolve(params: {
    promptId: string;
    promptVersion: number;
    variables?: Record<string, unknown>;
    contextString?: string;
  }): { renderedPrompt: RenderedPrompt; promptHash: string } {
    const promptTemplate = this.promptRegistry.getTemplate(params.promptId);
    if (!promptTemplate) {
      throw new AgentError(
        AgentErrorCode.AGENT_PROMPT_NOT_FOUND,
        `Prompt template ${params.promptId} not found in PromptRegistry`,
        false,
      );
    }

    const versionObj = this.promptRegistry.getVersion(params.promptId, params.promptVersion);
    if (!versionObj) {
      throw new AgentError(
        AgentErrorCode.AGENT_PROMPT_NOT_FOUND,
        `Prompt template ${params.promptId} version ${params.promptVersion} not found`,
        false,
      );
    }

    const renderedPrompt = this.promptEngineService.render(
      params.promptId,
      {
        user: (params.variables || {}),
        context: { marketContext: params.contextString || '' },
      },
      params.promptVersion,
    );

    const promptString = JSON.stringify(renderedPrompt);
    const promptHash = createHash('sha256').update(promptString).digest('hex');

    return {
      renderedPrompt,
      promptHash,
    };
  }
}
