import { describe, expect, it } from "vitest";
import { validateAnalysisOutput } from "../../src/analyzer/schemas.js";

describe("validateAnalysisOutput", () => {
  it("keeps the analysis when a skill has an unknown category", () => {
    const output = validateAnalysisOutput({
      skills: [
        { name: "s1", description: "Skill one", category: "framework" },
        { name: "s2", description: "Skill two", category: "security" },
        { name: "s3", description: "Skill three" },
      ],
      summary: "A repo",
    });

    expect(output?.summary).toBe("A repo");
    expect(output?.skills).toMatchObject([
      { name: "s1", category: "patterns" },
      { name: "s2", category: "security" },
      { name: "s3", category: "patterns" },
    ]);
  });
});
