import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./integration/browser",
  fullyParallel: true,
  projects: ["chromium", "firefox", "webkit"].map((browserName) => ({
    name: browserName,
    use: { browserName },
  })),
});
