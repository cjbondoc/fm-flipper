import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo-name>/.
export default defineConfig({
  base: "/fm-flipper/",
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
