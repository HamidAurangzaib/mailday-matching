import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import { logAudit } from "../lib/audit.js";

const router: IRouter = Router();

// GET /users — list all app users (admin only)
router.get("/users", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, role, created_at")
      .order("created_at");

    if (error) {
      req.log?.error({ error }, "Error fetching users");
      res.status(500).json({ error: "Failed to fetch users" });
      return;
    }

    res.json(data || []);
  } catch (err) {
    req.log?.error({ err }, "Error fetching users");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /users — create a new user (admin only)
router.post("/users", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    if (!["admin", "va"].includes(role)) {
      res.status(400).json({ error: "role must be 'admin' or 'va'" });
      return;
    }

    // Check if email already exists
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email.toLowerCase())
      .single();

    if (existing) {
      res.status(409).json({ error: "A user with that email already exists" });
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("users")
      .insert({ email: email.toLowerCase(), password_hash, role })
      .select("id, email, role, created_at")
      .single();

    if (error || !data) {
      req.log?.error({ error }, "Error creating user");
      res.status(500).json({ error: "Failed to create user" });
      return;
    }

    await logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      action: "user.created",
      entityType: "user",
      entityId: data.id,
      payloadAfter: { email: data.email, role: data.role },
      req,
    });

    res.status(201).json(data);
  } catch (err) {
    req.log?.error({ err }, "Error creating user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /users/:id — update role or reset password (admin only)
router.patch("/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { role, password } = req.body;
    const updateFields: Record<string, unknown> = {};

    // Prevent editing yourself
    if (req.user?.id === req.params.id && role && role !== req.user.role) {
      res.status(400).json({ error: "You cannot change your own role" });
      return;
    }

    if (role) {
      if (!["admin", "va"].includes(role)) {
        res.status(400).json({ error: "role must be 'admin' or 'va'" });
        return;
      }
      updateFields.role = role;
    }

    if (password) {
      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }
      updateFields.password_hash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const { data: before } = await supabase
      .from("users")
      .select("id, email, role")
      .eq("id", req.params.id)
      .single();

    const { data, error } = await supabase
      .from("users")
      .update(updateFields)
      .eq("id", req.params.id)
      .select("id, email, role, created_at")
      .single();

    if (error || !data) {
      res.status(404).json({ error: "User not found or update failed" });
      return;
    }

    await logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      action: password ? "user.password_reset" : "user.role_changed",
      entityType: "user",
      entityId: data.id,
      payloadBefore: before ?? null,
      payloadAfter: { email: data.email, role: data.role },
      metadata: { fields_changed: Object.keys(updateFields).filter((f) => f !== "password_hash") },
      req,
    });

    res.json(data);
  } catch (err) {
    req.log?.error({ err }, "Error updating user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /users/:id — remove a user (admin only, cannot delete yourself)
router.delete("/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    if (req.user?.id === req.params.id) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }

    const { data: before } = await supabase
      .from("users")
      .select("id, email, role")
      .eq("id", req.params.id)
      .single();

    const { error } = await supabase
      .from("users")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      req.log?.error({ error }, "Error deleting user");
      res.status(500).json({ error: "Failed to delete user" });
      return;
    }

    await logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      action: "user.deleted",
      entityType: "user",
      entityId: String(req.params.id ?? ""),
      payloadBefore: before ?? null,
      req,
    });

    res.status(204).send();
  } catch (err) {
    req.log?.error({ err }, "Error deleting user");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
