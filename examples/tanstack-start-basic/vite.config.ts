import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { copyTranslater } from "@copytranslater/tanstack-start/vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    copyTranslater({ root: import.meta.dirname }),
    tanstackStart(),
    react(),
  ],
  build: {
    manifest: true,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
