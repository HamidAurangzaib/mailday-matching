// Phase 5.2: Read-only audit log viewer endpoints.
//
//   GET /api/admin/audit-log?action=&entity_type=&actor=&date_from=&date_to=&limit=&offset=
//   GET /api/admin/audit-log/filters — distinct values for the filter dropdowns
//
// Admin-only. All filters optional; defaults to most-recent 100.

import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

router.get(
  "/admin/audit-log",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = Math.min(parseInt(q.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, MAX_LIMIT);
      const offset = Math.max(parseInt(q.offset ?? "0", 10) || 0, 0);

      let query = supabase
        .from("audit_log")
        .select(
          "id, actor_id, actor_email, actor_ip, action, entity_type, entity_id, payload_before, payload_after, metadata, created_at",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (q.action) query = query.eq("action", q.action);
      if (q.entity_type) query = query.eq("entity_type", q.entity_type);
      if (q.entity_id) query = query.eq("entity_id", q.entity_id);
      if (q.actor) query = query.ilike("actor_email", `%${q.actor}%`);
      if (q.date_from) query = query.gte("created_at", q.date_from);
      if (q.date_to) query = query.lte("created_at", q.date_to);

      const { data, error, count } = await query;
      if (error) {
        req.log?.error({ error }, "Audit log query failed");
        res.status(500).json({ error: "Failed to load audit log" });
        return;
      }
      res.json({
        rows: data ?? [],
        total: count ?? 0,
        limit,
        offset,
      });
    } catch (err) {
      req.log?.error({ err }, "Audit log endpoint error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get(
  "/admin/audit-log/filters",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const [actionsRes, entityTypesRes] = await Promise.all([
        supabase.from("audit_log").select("action").order("action"),
        supabase.from("audit_log").select("entity_type").order("entity_type"),
      ]);
      const actions = new Set<string>();
      const entityTypes = new Set<string>();
      for (const row of actionsRes.data ?? []) if (row.action) actions.add(row.action);
      for (const row of entityTypesRes.data ?? []) if (row.entity_type) entityTypes.add(row.entity_type);
      res.json({
        actions: [...actions].sort(),
        entity_types: [...entityTypes].sort(),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

export default router;
