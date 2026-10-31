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
 * Reads `git rev-parse HEAD` from the checked-out working tree at startup
 * (Replit's deploy is a literal `git fetch` + `git reset --hard`, so .git is
 * always present) and caches it — a deploy always restarts the process, so a
 * stale cache can't outlive the deploy it would be hiding.
 */
const startedAt = new Date().toISOString();
const commit = (() => {
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
