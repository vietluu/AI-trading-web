import { describe, expect, it } from "vitest";
import { PipelineSystemController } from "../../src/modules/pipeline/presentation/pipeline-system.controller";

describe("PipelineSystemController", () => {
  it("does not expose global queue pause or resume operations", () => {
    expect(PipelineSystemController.prototype).not.toHaveProperty("pause");
    expect(PipelineSystemController.prototype).not.toHaveProperty("resume");
  });
});
