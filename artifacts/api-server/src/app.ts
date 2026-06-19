import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
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
app.use("/api", router);

export default app;
