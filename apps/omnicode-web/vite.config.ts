import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The OmniCode kap-server API runs on :8001 in dev. Proxy /api there so the
// home page can read server status (providers, sessions, auth token) same-origin.
const apiPort = Number(process.env.HILBRAS_API_PORT) || 8001;

// When VIS_SINGLEFILE=1 the vis app inlines everything into one file for the CLI
// embed; this app keeps the same flag for parity but stays off by default.
const singlefile = process.env.OMNICODE_WEB_SINGLEFILE === "1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.OMNICODE_WEB_PORT) || 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: singlefile ? "dist-single" : "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
