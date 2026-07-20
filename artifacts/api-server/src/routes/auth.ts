import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { signToken } from "../lib/jwt.js";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { LoginBody } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";
import { appBaseUrl } from "../lib/app-url.js";

const router: IRouter = Router();

const EMAIL_HTML = (resetUrl: string) => `
  <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="margin-bottom:8px">Reset your password</h2>
    <p style="color:#555;margin-bottom:24px">
      Click the button below to set a new password. This link expires in 1 hour.
    </p>
    <a href="${resetUrl}"
       style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;
              padding:12px 24px;border-radius:6px;font-weight:600">
      Reset password
    </a>
    <p style="color:#999;font-size:12px;margin-top:24px">
      If you didn't request this, you can safely ignore this email.
    </p>
  </div>
`;

const EMAIL_TEXT = (resetUrl: string) =>
  `Reset your MailDay password\n\nClick here (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`;

async function sendResetEmail(toEmail: string, resetUrl: string): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;

  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "MailDay Admin <hello@joinmailday.com>",
        to: [toEmail],
        subject: "Reset your MailDay password",
        html: EMAIL_HTML(resetUrl),
        text: EMAIL_TEXT(resetUrl),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, "Resend API error");
      return false;
    }
    return true;
  }

  logger.warn({ resetUrl }, "No email provider configured — password reset link (copy to reset)");
  return false;
}

router.post("/auth/login", async (req, res) => {
  try {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { email, password } = parsed.data;

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, role, password_hash")
      .eq("email", email.toLowerCase())
      .single();

    if (error || !user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    req.log?.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.json({ success: true });
});

router.get("/auth/me", requireAuth, (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
});

router.patch("/auth/me/password", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      res.status(400).json({ error: "current_password and new_password are required" });
      return;
    }
    if (new_password.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters" });
      return;
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, password_hash")
      .eq("id", req.user!.id)
      .single();

    if (error || !user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const password_hash = await bcrypt.hash(new_password, 10);
    const { error: updateErr } = await supabase
      .from("users")
      .update({ password_hash })
      .eq("id", user.id);

    if (updateErr) {
      req.log?.error({ updateErr }, "Error updating password");
      res.status(500).json({ error: "Failed to update password" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    req.log?.error({ err }, "Error changing password");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, email")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (!user) {
      res.json({ success: true });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await supabase
      .from("users")
      .update({ reset_token: token, reset_token_expires_at: expiresAt })
      .eq("id", user.id);

    const resetUrl = `${appBaseUrl()}/reset-password?token=${token}`;

    const sent = await sendResetEmail(user.email, resetUrl);
    if (!sent) {
      req.log?.info({ resetUrl, userId: user.id }, "Reset link generated (SMTP not configured)");
    }

    res.json({ success: true });
  } catch (err) {
    req.log?.error({ err }, "Forgot password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      res.status(400).json({ error: "token and new_password are required" });
      return;
    }
    if (new_password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, reset_token, reset_token_expires_at")
      .eq("reset_token", token)
      .single();

    if (!user || !user.reset_token_expires_at) {
      res.status(400).json({ error: "Invalid or expired reset link" });
      return;
    }

    if (new Date(user.reset_token_expires_at) < new Date()) {
      res.status(400).json({ error: "This reset link has expired. Please request a new one." });
      return;
    }

    const password_hash = await bcrypt.hash(new_password, 10);
    const { error: updateErr } = await supabase
      .from("users")
      .update({ password_hash, reset_token: null, reset_token_expires_at: null })
      .eq("id", user.id);

    if (updateErr) {
      req.log?.error({ updateErr }, "Error resetting password");
      res.status(500).json({ error: "Failed to reset password" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    req.log?.error({ err }, "Reset password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
