import { Router, type IRouter } from "express";
import { execSync } from "node:child_process";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * What commit is actually running, right now, on this server.
 *
 * Added after three separate incidents where code was believed live (merged,
 * even committed weeks earlier) and wasn't — the gap was never that the fix
 * was wrong, it was that nobody could check, after deploying, what the server
 * was actually running. Hit this URL right after every deploy; the commit it
 * reports must match `git log -1` on main, or the deploy didn't take.
 *
 * `BUILD_COMMIT` is inlined into the bundle at BUILD time by build.mjs (an
 * esbuild `define`), not read at runtime — a first version of this shelled
 * out to `git rev-parse HEAD` when the server started and got null in
 * production, because the deployed process's working directory isn't inside
 * the git checkout. Baking it in at build time means it can't depend on the
 * runtime environment at all. Falls back to a runtime `git rev-parse HEAD`
 * only for `pnpm dev`, which runs the TypeScript directly rather than through
 * build.mjs, so BUILD_COMMIT is never set there.
 */
const startedAt = new Date().toISOString();
const commit = ((): string | null => {
  const baked = process.env["BUILD_COMMIT"];
  if (baked) return baked;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null; // no .git here (e.g. a from-scratch local run) — not fatal
  }
})();

router.get("/version", (_req, res) => {
  res.json({ commit, commitShort: commit?.slice(0, 7) ?? null, startedAt });
});

export default router;
