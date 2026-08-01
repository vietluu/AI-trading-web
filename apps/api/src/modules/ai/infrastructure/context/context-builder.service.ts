import { Injectable, Logger } from "@nestjs/common";
import { ContextCompressor, ContextItem } from "./context-compressor";

export interface ContextSourceData {
  marketData?: Record<string, unknown>;
  indicators?: Record<string, unknown>;
  news?: Array<Record<string, unknown>>;
  macro?: Array<Record<string, unknown>>;
  sentiment?: Record<string, unknown>;
  previousAiResults?: Array<Record<string, unknown>>;
  userSettings?: Record<string, unknown>;
  riskSettings?: Record<string, unknown>;
  openPositions?: Array<Record<string, unknown>>;
  paperPortfolio?: Record<string, unknown>;
  custom?: Record<string, unknown>;
}

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(private readonly compressor: ContextCompressor) {}

  public buildContext(sources: ContextSourceData, maxTokens = 4000): { contextString: string; totalTokens: number } {
    const rawItems: ContextItem[] = [];

    if (sources.riskSettings) {
      const content = `Risk Settings: ${JSON.stringify(sources.riskSettings)}`;
      rawItems.push({
        id: "risk-settings",
        source: "Risk Settings",
        priority: 1,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.userSettings) {
      const content = `User Settings: ${JSON.stringify(sources.userSettings)}`;
      rawItems.push({
        id: "user-settings",
        source: "User Settings",
        priority: 2,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.marketData) {
      const content = `Market Data Snapshot: ${JSON.stringify(sources.marketData)}`;
      rawItems.push({
        id: "market-data",
        source: "Market Data",
        priority: 2,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.indicators) {
      const content = `Technical Indicators: ${JSON.stringify(sources.indicators)}`;
      rawItems.push({
        id: "indicators",
        source: "Indicators",
        priority: 3,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.openPositions) {
      const content = `Open Positions: ${JSON.stringify(sources.openPositions)}`;
      rawItems.push({
        id: "open-positions",
        source: "Open Positions",
        priority: 3,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.paperPortfolio) {
      const content = `Paper Portfolio Summary: ${JSON.stringify(sources.paperPortfolio)}`;
      rawItems.push({
        id: "paper-portfolio",
        source: "Paper Portfolio",
        priority: 4,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.news && sources.news.length > 0) {
      const content = `Recent News Headlines & Sentiment: ${JSON.stringify(sources.news)}`;
      rawItems.push({
        id: "news",
        source: "News",
        priority: 4,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.macro && sources.macro.length > 0) {
      const content = `Macroeconomic Calendar Events: ${JSON.stringify(sources.macro)}`;
      rawItems.push({
        id: "macro",
        source: "Macro",
        priority: 5,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.sentiment) {
      const content = `Market Sentiment (Fear & Greed Index): ${JSON.stringify(sources.sentiment)}`;
      rawItems.push({
        id: "sentiment",
        source: "Sentiment",
        priority: 5,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.previousAiResults && sources.previousAiResults.length > 0) {
      const content = `Previous AI Research Results: ${JSON.stringify(sources.previousAiResults)}`;
      rawItems.push({
        id: "previous-ai-results",
        source: "Previous AI Results",
        priority: 6,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    if (sources.custom) {
      const content = `Additional Context: ${JSON.stringify(sources.custom)}`;
      rawItems.push({
        id: "custom",
        source: "Custom",
        priority: 7,
        content,
        tokens: Math.ceil(content.length / 4),
      });
    }

    const { items, totalTokens } = this.compressor.compress(rawItems, maxTokens);
    const contextString = items.map((i) => `--- ${i.source} ---\n${i.content}`).join("\n\n");

    return { contextString, totalTokens };
  }
}
