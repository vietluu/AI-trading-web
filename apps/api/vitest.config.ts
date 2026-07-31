import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "json", "html"],
    },
    environment: "node",
    include: ["test/**/*.spec.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
