import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(__dirname, "..");
const appRoot = path.join(workspaceRoot, "src", "app");
const componentsRoot = path.join(workspaceRoot, "src", "components");

function collectFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function containsForbiddenPattern(filePath: string): string[] {
  const content = readFileSync(filePath, "utf8");
  const patterns = [
    /\buseQuery\s*\(/,
    /\buseInfiniteQuery\s*\(/,
    /\buseSuspenseQuery\s*\(/,
    /\buseQueries\s*\(/,
    /\buseMutation\s*\(/,
    /\bqueryFn\b/,
    /\bmutationFn\b/,
    /\bqueryKey\b/,
  ];

  return patterns
    .map((pattern) => (pattern.test(content) ? pattern.source : null))
    .filter((item): item is string => Boolean(item));
}

describe("React Query architecture", () => {
  it("keeps pages and components free of direct React Query hooks and query/mutation definitions", () => {
    const files = [...collectFiles(appRoot), ...collectFiles(componentsRoot)];
    const violations = files.flatMap((filePath) => {
      const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
      const matches = containsForbiddenPattern(filePath);
      return matches.length > 0 ? [{ relativePath, matches }] : [];
    });

    expect(violations).toEqual([]);
  });
});
