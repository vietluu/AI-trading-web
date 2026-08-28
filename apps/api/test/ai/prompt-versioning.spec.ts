import { describe, expect, it, beforeEach } from "vitest";
import { PromptRegistry } from "../../src/modules/ai/infrastructure/prompt/prompt-registry";
import { AgentRegistryService } from "../../src/modules/agents/infrastructure/registry/agent-registry.service";
import { SYSTEM_DIAGNOSTIC_DEFINITION } from "../../src/modules/agents/domain/definitions/system-diagnostic.definition";

describe("Prompt & Model Policy Versioning", () => {
  let promptRegistry: PromptRegistry;
  let agentRegistry: AgentRegistryService;

  beforeEach(() => {
    promptRegistry = new PromptRegistry();
    agentRegistry = new AgentRegistryService();
  });

  it("preserves historical versions when adding a new prompt version", () => {
    const templateId = "macro_analyst_v1";
    const initial = promptRegistry.getTemplate(templateId);
    expect(initial?.currentVersion).toBe(1);

    // Add version 2
    promptRegistry.addVersion(templateId, {
      version: 2,
      systemTemplate: "Updated macro instructions v2",
      userTemplate: "Analyze macro v2",
    });

    const v1 = promptRegistry.getVersion(templateId, 1);
    const v2 = promptRegistry.getVersion(templateId, 2);
    const current = promptRegistry.getTemplate(templateId);

    expect(v1?.systemTemplate).not.toBe(v2?.systemTemplate);
    expect(v2?.systemTemplate).toBe("Updated macro instructions v2");
    expect(current?.currentVersion).toBe(2);
  });

  it("changes definition hash when agent promptVersion changes", () => {
    const hashV1 = agentRegistry.calculateDefinitionHash(SYSTEM_DIAGNOSTIC_DEFINITION);

    const updatedDef = {
      ...SYSTEM_DIAGNOSTIC_DEFINITION,
      promptVersion: 2,
    };
    const hashV2 = agentRegistry.calculateDefinitionHash(updatedDef);

    expect(hashV1).not.toBe(hashV2);
    expect(hashV1).toHaveLength(64);
    expect(hashV2).toHaveLength(64);
  });

  it("changes definition hash when agent promptId changes", () => {
    const hashV1 = agentRegistry.calculateDefinitionHash(SYSTEM_DIAGNOSTIC_DEFINITION);

    const updatedDef = {
      ...SYSTEM_DIAGNOSTIC_DEFINITION,
      promptId: "system_diagnostic_v2",
    };
    const hashV2 = agentRegistry.calculateDefinitionHash(updatedDef);

    expect(hashV1).not.toBe(hashV2);
  });
});
