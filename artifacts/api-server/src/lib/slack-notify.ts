/**
 * Slack Block Kit posting, shared by the scheduled digests (routes/slack.ts)
 * and any one-off alert that should reach the team the moment something
 * happens — not on the next daily/weekly roundup.
 */
import { logger } from "./logger.js";

export function header(text: string) {
  return { type: "header", text: { type: "plain_text", text, emoji: true } };
}

export function section(text: string) {
  return { type: "section", text: { type: "mrkdwn", text } };
}

export function divider() {
  return { type: "divider" };
}

export async function notifySlack(blocks: unknown[]): Promise<void> {
  const url = process.env["SLACK_WEBHOOK"];
  if (!url) {
    logger.warn("SLACK_WEBHOOK not set — skipping Slack notification");
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${text}`);
  }
}
