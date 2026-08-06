import { describe, expect, it } from "vitest";

import { ROUTES } from "@/constants/routes";

describe("ROUTES", () => {
  it("exposes centralized route helpers for settings, news and AI pages", () => {
    expect(ROUTES.settingsAi).toBe("/settings/ai");
    expect(ROUTES.settingsAiTools).toBe("/settings/ai/tools");

    const newsRoute = ROUTES.newsDetail("abc123");
    const pipelineRunRoute = ROUTES.ai.pipelineRunDetail("42");

    expect(newsRoute).toBe("/news/abc123");
    expect(pipelineRunRoute).toBe("/ai/pipeline-runs/42");
  });
});
