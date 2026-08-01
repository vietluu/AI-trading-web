import { Injectable, Logger } from "@nestjs/common";
import {
  PromptVariables,
  RenderedPrompt,
} from "../../domain/models/prompt-template.model";
import { PromptRegistry } from "./prompt-registry";
import { PromptRenderer } from "./prompt-renderer";

@Injectable()
export class PromptEngineService {
  private readonly logger = new Logger(PromptEngineService.name);

  constructor(
    private readonly registry: PromptRegistry,
    private readonly renderer: PromptRenderer
  ) {}

  public render(
    templateId: string,
    variables: PromptVariables,
    version?: number
  ): RenderedPrompt {
    const tmplVersion = this.registry.getVersion(templateId, version);
    if (!tmplVersion) {
      this.logger.warn(`Template ${templateId} (v${version}) not found, falling back to generic-chat-v1`);
      return this.renderDirect({
        userPrompt:
          typeof variables.user.input === "string"
            ? variables.user.input
            : JSON.stringify(variables.user),
        systemPrompt: "You are an AI cryptocurrency futures research platform assistant.",
      });
    }

    const systemPrompt = tmplVersion.systemTemplate
      ? this.renderer.render(tmplVersion.systemTemplate, variables.system || variables.user)
      : undefined;

    const developerPrompt = tmplVersion.developerTemplate
      ? this.renderer.render(tmplVersion.developerTemplate, variables.developer || variables.user)
      : undefined;

    const contextPrompt = tmplVersion.contextTemplate
      ? this.renderer.render(tmplVersion.contextTemplate, variables.context || variables.user)
      : undefined;

    const userPrompt = this.renderer.render(tmplVersion.userTemplate, variables.user);

    const fullPrompt = this.renderer.assembleFullPrompt({
      system: systemPrompt,
      developer: developerPrompt,
      context: contextPrompt,
      user: userPrompt,
      examples: tmplVersion.examples,
      history: variables.history,
      tools: variables.tools,
    });

    return {
      templateId,
      version: tmplVersion.version,
      systemPrompt,
      developerPrompt,
      userPrompt,
      contextPrompt,
      fullPrompt,
    };
  }

  public renderDirect(params: {
    userPrompt: string;
    systemPrompt?: string;
    developerPrompt?: string;
    contextPrompt?: string;
    history?: Array<{ role: string; content: string }>;
    tools?: Array<{ name: string; description: string }>;
  }): RenderedPrompt {
    const fullPrompt = this.renderer.assembleFullPrompt({
      system: params.systemPrompt,
      developer: params.developerPrompt,
      context: params.contextPrompt,
      user: params.userPrompt,
      history: params.history,
      tools: params.tools,
    });

    return {
      templateId: "direct-prompt",
      version: 1,
      systemPrompt: params.systemPrompt,
      developerPrompt: params.developerPrompt,
      userPrompt: params.userPrompt,
      contextPrompt: params.contextPrompt,
      fullPrompt,
    };
  }
}
