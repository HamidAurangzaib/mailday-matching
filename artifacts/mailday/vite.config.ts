import { defineConfig, type ConfigEnv, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT and BASE_PATH are only needed to RUN the dev server / preview — not to
// build. Requiring them unconditionally made `vite build` (and `pnpm run build`)
// fail whenever they weren't set (e.g. a manual Shell build). Enforce them only
// when serving; a production build falls back to base "/" and a default port.
export default defineConfig(async ({ command }: ConfigEnv): Promise<UserConfig> => {
  const isServe = command === "serve";
  const rawPort = process.env.PORT;

  if (isServe && !rawPort) {
    throw new Error("PORT environment variable is required but was not provided.");
  }
  const port = Number(rawPort);
  if (isServe && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH;
  if (isServe && !basePath) {
    throw new Error("BASE_PATH environment variable is required but was not provided.");
  }

  const serverPort = Number.isNaN(port) || port <= 0 ? 5173 : port;

  return {
    base: basePath ?? "/",
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port: serverPort,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
      // Local-dev only: forward /api/* to the local API server on 8080.
      // On Replit, an external reverse proxy handles this, and `vite dev` isn't
      // used in production anyway — `vite build` ignores `server.proxy`.
      proxy: {
        "/api": {
          target: process.env.API_PROXY_TARGET ?? "http://localhost:8080",
          changeOrigin: true,
        },
      },
      fs: {
        strict: true,
      },
    },
    preview: {
      port: serverPort,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
