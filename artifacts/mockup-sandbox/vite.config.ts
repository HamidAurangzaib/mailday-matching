import { defineConfig, type ConfigEnv, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

// PORT and BASE_PATH are only needed to RUN the dev server / preview — not to
// build. Requiring them unconditionally made `vite build` (and therefore
// `pnpm run build`, which the Replit deploy runs) fail whenever they weren't
// set. Enforce them only when actually serving; a build falls back to defaults.
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
      mockupPreviewPlugin(),
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
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
    },
    server: {
      port: serverPort,
      host: "0.0.0.0",
      allowedHosts: true,
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
