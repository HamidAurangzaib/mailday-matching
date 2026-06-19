import app from "./app";
import { logger } from "./lib/logger";
import { startRechargeSync } from "./routes/sync.js";
import { startSlackScheduler } from "./routes/slack.js";
import { startKlaviyoSync } from "./routes/klaviyo-sync.js";
import { startLifecycleCrons } from "./routes/lifecycle-jobs.js";
import { startCoppaCron } from "./routes/coppa.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startRechargeSync();
  startSlackScheduler();
  startKlaviyoSync();
  startLifecycleCrons();
  startCoppaCron();
});
