import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the first proxy hop (Replit's edge) so req.ip resolves to the real
// visitor address instead of the proxy's. Without this, express-rate-limit
// keys every visitor to the same bucket and either bans everyone at once or
// is effectively bypassable. See audit report §4.6.
app.set("trust proxy", 1);

const allowedOrigins = (process.env["REPLIT_DOMAINS"] ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => `https://${d}`);

if (process.env["NODE_ENV"] !== "production") {
  allowedOrigins.push("http://localhost", "http://localhost:80");
}

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  }),
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later." },
});

// Stricter limiter for password-reset and password-change operations.
// Helps mitigate password-reset email flooding and brute-force of
// current-password on /auth/me/password. See audit report §4.2.
const passwordOpsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password operations, please try again later." },
});

// A5 (defence-in-depth): per-IP ceiling on the unauthenticated public forms.
// Turnstile is the real bot gate; this is the backstop for when a token is
// farmed or Cloudflare is unreachable (verifyTurnstile deliberately allows on a
// network error rather than locking real families out).
//
// The budget is generous on purpose: onboarding is several calls for a family
// with multiple children (form load + attestation + one per child), and shared
// NAT means several genuine families can share an IP. It still turns bulk
// submission from cheap into impractical.
const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions from this connection. Please try again in a little while." },
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as import("express").Request & { rawBody: Buffer }).rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/forgot-password", passwordOpsLimiter);
app.use("/api/auth/reset-password", passwordOpsLimiter);
app.use("/api/auth/me/password", passwordOpsLimiter);

// A5: every unauthenticated public form. Mounted per-path rather than on
// /api/give-a-key so the authenticated admin routes under it stay unlimited.
app.use("/api/onboarding", publicFormLimiter);
app.use("/api/give-a-key/apply", publicFormLimiter);
app.use("/api/give-a-key/po-box", publicFormLimiter);
app.use("/api/address-change/request", publicFormLimiter);

app.use("/api", router);

// Serve the built admin dashboard (SPA) from this same server, so ONE address
// (e.g. app.joinmailday.com) serves both the dashboard and the /api engine.
// Because the UI is then same-origin with the API, the frontend's /api calls
// need no CORS. Resolved relative to this bundle's location (cwd-independent),
// overridable via CLIENT_DIST_PATH. Falls back to API-only if no build present.
const clientDist =
  process.env["CLIENT_DIST_PATH"] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../mailday/dist/public");

if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-/api GET that isn't a real static file → index.html,
  // so client-side routes (e.g. /login, /children) load correctly on refresh.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
  logger.info({ clientDist }, "Serving admin dashboard (SPA) from this server");
} else {
  logger.warn({ clientDist }, "Frontend build not found — running API-only");
}

export default app;
