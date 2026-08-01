import { Injectable } from "@nestjs/common";
import {
  PromptTemplateModel,
  PromptVersion,
} from "../../domain/models/prompt-template.model";

@Injectable()
export class PromptRegistry {
  private readonly templates = new Map<string, PromptTemplateModel>();

  constructor() {
    this.registerSystemTemplates();
  }

  private registerSystemTemplates(): void {
    this.registerTemplate({
      id: "market_analyst_v1",
      name: "Market Analyst Agent",
      description: "Strict structured market conditions analysis without trading recommendations",
      currentVersion: 1,
      versions: new Map<number, PromptVersion>([
        [
          1,
          {
            version: 1,
            systemTemplate: [
              "You are a crypto market analyst.",
              "Analyze market structure, price movement, volatility, liquidity, funding, and open interest only.",
              "Never generate LONG or SHORT decisions, recommend a trade, or suggest entries, stop losses, or take profits.",
              "Use only the supplied tool results. Do not hallucinate missing data.",
              "Evaluate price versus SMA/EMA, higher highs or lower lows, ATR and range expansion, spread and depth imbalance, funding trend, open-interest trend, sudden spikes, price/OI divergence, and extreme funding when data permits.",
              "Return one JSON object matching the required schema exactly, with no markdown or extra text.",
              "When data is missing, stale, or a tool failed, omit unavailable optional fields and set dataQuality to PARTIAL or INSUFFICIENT explicitly.",
            ].join(" "),
            userTemplate: "Analyze the current market conditions for {{symbol}} on {{interval}}",
            contextTemplate: "Validated market context: {{marketContext}}",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ]),
      tags: ["market", "agent", "structured-output", "non-trading"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.registerTemplate({
      id: "market-analysis-v1",
      name: "Market Technical Analysis Prompt",
      description: "Template for evaluating technical indicators and price action",
      currentVersion: 1,
      versions: new Map<number, PromptVersion>([
        [
          1,
          {
            version: 1,
            systemTemplate: "You are an expert crypto futures analyst evaluating {{symbol}} on {{interval}} timeframe.",
            developerTemplate: "Follow strict risk metrics. Do NOT issue financial advice.",
            userTemplate: "Analyze price candles, RSI ({{rsi}}), MACD ({{macd}}), and trend for {{symbol}}.",
            contextTemplate: "Market Context: {{marketContext}}",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ]),
      tags: ["market", "technical"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.registerTemplate({
      id: "news-summary-v1",
      name: "News Sentiment & Impact Analysis",
      description: "Template for extracting crypto news sentiment and importance",
      currentVersion: 1,
      versions: new Map<number, PromptVersion>([
        [
          1,
          {
            version: 1,
            systemTemplate: "You are a crypto news research analyst.",
            userTemplate: "Summarize article titled '{{title}}' and rate importance from 0 to 100.",
            contextTemplate: "Article Content: {{content}}",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ]),
      tags: ["news", "sentiment"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.registerTemplate({
      id: "generic-chat-v1",
      name: "Generic AI Chat & Research",
      description: "Default fallback template for standard user questions",
      currentVersion: 1,
      versions: new Map<number, PromptVersion>([
        [
          1,
          {
            version: 1,
            systemTemplate: "You are Antigravity Research Assistant for Cryptocurrency Futures trading.",
            userTemplate: "{{input}}",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ]),
      tags: ["generic"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  public registerTemplate(template: PromptTemplateModel): void {
    this.templates.set(template.id, template);
  }

  public getTemplate(id: string): PromptTemplateModel | undefined {
    return this.templates.get(id);
  }

  public getVersion(templateId: string, version?: number): PromptVersion | undefined {
    const tmpl = this.templates.get(templateId);
    if (!tmpl) return undefined;
    const v = version ?? tmpl.currentVersion;
    return tmpl.versions.get(v);
  }

  public getAllTemplates(): PromptTemplateModel[] {
    return Array.from(this.templates.values());
  }
}
