/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths: the same bundle serves from GitHub Pages
  // (/Space-data-centers/) and from `vite preview` at /.
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
  test: {
    environment: "node",
    include: ["src/test/**/*.test.ts"],
  },
});
