import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws in any non-server context; vitest tests run in
      // Node but do not go through Next.js module transforms. Map to an empty
      // stub so tests that import server-only files don't crash.
      "server-only": path.resolve(__dirname, "./src/__mocks__/server-only.ts"),
    },
  },
});
