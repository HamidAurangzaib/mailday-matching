// COPPA hard-delete routes (Phase 5.1)
//
// Endpoints (all admin-only):
//   POST   /api/admin/coppa/parents/:id/request  — schedule erasure (+7-day cooldown)
//   POST   /api/admin/coppa/parents/:id/cancel   — cancel a pending erasure
//   POST   /api/admin/coppa/parents/:id/execute  — admin-forced immediate execution
//                                                   (still requires the parent to be in
//                                                    requested state, just bypasses the 7d wait)
//   GET    /api/admin/coppa/pending              — list parents pending erasure
//   POST   /api/admin/coppa/run-cron             — manual trigger of the daily cron (testing)
//
// What "erasure" means (lifecycle map § Data deletion):
//   • Anonymise every match row that referenced the parent's children (Phase 5
//     decision: keep the match shell, NULL the child_id, stamp anonymised_at).
//   • Delete the parent's children rows.
//   • Delete the parent row.
//   • Delete dependent records that PostgreSQL cascade doesn't cover:
//       cancellations, cancellation_notes, cancellation_tasks,
//       lifecycle_tasks, confirmation_tokens (most are ON DELETE CASCADE
//       already via FK, but we still explicitly clean to be sure).
//   • Audit log keeps the action record (it's text-keyed; the entity_id stays
//     for forensics but the parent row is gone).

import { Router, type IRouter } from "express";
import cron from "node-cron";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import { logAudit } from "../lib/audit.js";

const router: IRouter = Router();

const COPPA_COOLDOWN_DAYS = 7;

// ─── Erasure executor ────────────────────────────────────────────────────────

export interface CoppaExecuteResult {
  parentId: string;
  childrenDeleted: number;
  matchesAnonymised: number;
  lifecycleTasksCleared: number;
  cancellationsCleared: number;
  confirmationTokensCleared: number;
}

/**
 * Execute the cascade. Caller is responsible for verifying the cooldown has
 * passed (the cron does this); the function itself just runs the deletion.
 *
 * Throws on any failure — the caller should treat that as the erasure NOT
 * having happened (parent + children still in DB, anonymise + retry).
 */
export async function executeCoppaErasure(args: {
  parentId: string;
  actorEmail?: string | null;
  actorId?: string | null;
  note?: string;
}): Promise<CoppaExecuteResult> {
  const result: CoppaExecuteResult = {
    parentId: args.parentId,
    childrenDeleted: 0,
    matchesAnonymised: 0,
    lifecycleTasksCleared: 0,
    cancellationsCleared: 0,
    confirmationTokensCleared: 0,
  };

  const nowIso = new Date().toISOString();

  // 1. Load child IDs for the parent so we can find their match references.
  const { data: childRows } = await supabase
    .from("children")
    .select("id")
    .eq("parent_id", args.parentId);
  const childIds = (childRows ?? []).map((c) => c.id);

  // 2. Anonymise matches. For each match where one of THIS parent's children
  //    is involved, NULL out the appropriate side and stamp anonymised_at.
  if (childIds.length > 0) {
    const { data: affectedMatches } = await supabase
      .from("matches")
      .select("id, child_a_id, child_b_id, anonymised_at")
      .or(
        `child_a_id.in.(${childIds.join(",")}),child_b_id.in.(${childIds.join(",")})`,
      );

    for (const m of affectedMatches ?? []) {
      const updates: Record<string, unknown> = { anonymised_at: nowIso };
      if (m.child_a_id && childIds.includes(m.child_a_id)) updates["child_a_id"] = null;
      if (m.child_b_id && childIds.includes(m.child_b_id)) updates["child_b_id"] = null;
      const { error } = await supabase
        .from("matches")
        .update(updates)
        .eq("id", m.id);
      if (error) {
        logger.warn({ matchId: m.id, error }, "COPPA: failed to anonymise match");
      } else {
        result.matchesAnonymised++;
      }
    }
  }

  // 3. Clear dependent rows that aren't covered by FK cascade or that we want
  //    explicitly removed for the audit trail.
  // lifecycle_tasks
  const { data: lcDeleted } = await supabase
    .from("lifecycle_tasks")
    .delete()
    .eq("parent_id", args.parentId)
    .select("id");
  result.lifecycleTasksCleared = lcDeleted?.length ?? 0;

  // confirmation_tokens
  const { data: ctDeleted } = await supabase
    .from("confirmation_tokens")
    .delete()
    .eq("parent_id", args.parentId)
    .select("token");
  result.confirmationTokensCleared = ctDeleted?.length ?? 0;

  // cancellations + dependent rows. Notes/tasks have ON DELETE CASCADE FKs to
  // cancellations.id; deleting the cancellation row pulls them with it.
  const { data: cnDeleted } = await supabase
    .from("cancellations")
    .delete()
    .eq("parent_id", args.parentId)
    .select("id");
  result.cancellationsCleared = cnDeleted?.length ?? 0;

  // 4. Delete children. After step 2 they're no longer referenced by matches.
  if (childIds.length > 0) {
    const { error: childErr } = await supabase
      .from("children")
      .delete()
      .in("id", childIds);
    if (childErr) {
      throw new Error(`COPPA execute: failed to delete children: ${childErr.message}`);
    }
    result.childrenDeleted = childIds.length;
  }

  // 5. Mark the parent erased BEFORE deleting them — this stamps coppa_erased_at
  //    just in case a subsequent failure leaves the parent row around. Then
  //    delete the parent row.
  await supabase
    .from("parents")
    .update({ coppa_erased_at: nowIso })
    .eq("id", args.parentId);

  const { error: parentErr } = await supabase
    .from("parents")
    .delete()
    .eq("id", args.parentId);
  if (parentErr) {
    throw new Error(`COPPA execute: failed to delete parent: ${parentErr.message}`);
  }

  await logAudit({
    actorId: args.actorId ?? null,
    actorEmail: args.actorEmail ?? "system:coppa-cron",
    action: "parent.coppa_erased",
    entityType: "parent",
    entityId: args.parentId,
    metadata: {
      ...result,
      executed_at: nowIso,
      note: args.note ?? null,
    },
  });

  logger.info({ ...result, parentId: args.parentId }, "COPPA erasure completed");
  return result;
}

// ─── Daily cron: execute due erasures ────────────────────────────────────────

export interface CoppaCronResult {
  scanned: number;
  executed: number;
  errors: string[];
  ranAt: string;
}

/**
 * Find parents whose `coppa_erase_requested_at` is at least COPPA_COOLDOWN_DAYS
 * ago and execute the erasure for each.
 */
export async function runCoppaErasureCron(): Promise<CoppaCronResult> {
  const result: CoppaCronResult = {
    scanned: 0,
    executed: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  const cutoff = new Date(
    Date.now() - COPPA_COOLDOWN_DAYS * 86400000,
  ).toISOString();

  const { data: due, error } = await supabase
    .from("parents")
    .select("id, email, first_name, coppa_erase_requested_at, coppa_erase_requested_by, coppa_erased_at")
    .lte("coppa_erase_requested_at", cutoff)
    .is("coppa_erased_at", null);

  if (error) {
    result.errors.push(`load: ${error.message}`);
    return result;
  }
  if (!due || due.length === 0) {
    logger.info(result, "COPPA cron: no due erasures");
    return result;
  }

  result.scanned = due.length;

  for (const p of due) {
    try {
      await executeCoppaErasure({
        parentId: p.id,
        actorEmail: `system:coppa-cron(originally:${p.coppa_erase_requested_by ?? "unknown"})`,
      });
      result.executed++;
    } catch (err) {
      result.errors.push(`parent ${p.id}: ${String(err)}`);
      logger.error({ err, parentId: p.id }, "COPPA cron: erasure failed");
    }
  }

  logger.info(result, "COPPA cron completed");
  return result;
}

// ─── Cron scheduler ──────────────────────────────────────────────────────────

let coppaJob: ReturnType<typeof cron.schedule> | null = null;

export function startCoppaCron(): void {
  // 9:30 AM MT daily — after the other lifecycle crons (9:00–9:25).
  coppaJob = cron.schedule(
    "30 9 * * *",
    () => {
      void runCoppaErasureCron().catch((err) =>
        logger.error({ err }, "COPPA cron failed"),
      );
    },
    { timezone: "America/Denver" },
  );
  logger.info("COPPA cron scheduled (9:30 daily — America/Denver)");
}

export function stopCoppaCron(): void {
  coppaJob?.stop();
  coppaJob = null;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/coppa/parents/:id/request
 * Body: { reason?: string }
 *
 * Two-step deletion request. Sets coppa_erase_requested_at to NOW. Also creates
 * a `coppa_deletion_pending` lifecycle_task so the team sees it in Action
 * Items and can cancel it during the cooldown if it was a mistake.
 */
router.post(
  "/admin/coppa/parents/:id/request",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params["id"] ?? "");
      if (!id) {
        res.status(400).json({ error: "Missing parent id" });
        return;
      }
      const reason = ((req.body as { reason?: string } | undefined)?.reason ?? "").trim();

      const { data: parent } = await supabase
        .from("parents")
        .select("id, email, first_name, last_name, coppa_erase_requested_at, coppa_erased_at")
        .eq("id", id)
        .single();
      if (!parent) {
        res.status(404).json({ error: "Parent not found" });
        return;
      }
      if (parent.coppa_erased_at) {
        res.status(409).json({ error: "Parent has already been erased" });
        return;
      }
      if (parent.coppa_erase_requested_at) {
        res.status(409).json({ error: "Erasure is already requested for this parent" });
        return;
      }

      const nowIso = new Date().toISOString();
      const executeAt = new Date(Date.now() + COPPA_COOLDOWN_DAYS * 86400000).toISOString();
      const actor = req.user?.email ?? req.user?.id ?? "unknown";

      await supabase
        .from("parents")
        .update({
          coppa_erase_requested_at: nowIso,
          coppa_erase_requested_by: actor,
        })
        .eq("id", id);

      const familyName =
        `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim() ||
        parent.email;
      await supabase.from("lifecycle_tasks").insert({
        type: "coppa_deletion_pending",
        title: `COPPA erasure pending — ${familyName}`,
        description:
          `Requested by ${actor}${reason ? `: ${reason}` : ""}. ` +
          `Will execute after ${COPPA_COOLDOWN_DAYS} days (~${executeAt.split("T")[0]}). ` +
          `Complete this task to CANCEL the erasure.`,
        parent_id: id,
      });

      await logAudit({
        actorId: req.user?.id,
        actorEmail: req.user?.email,
        action: "parent.coppa_erasure_requested",
        entityType: "parent",
        entityId: id,
        metadata: { reason, execute_after: executeAt },
        req,
      });

      res.json({
        parent_id: id,
        coppa_erase_requested_at: nowIso,
        execute_after: executeAt,
      });
    } catch (err) {
      req.log?.error({ err }, "COPPA request endpoint error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * POST /api/admin/coppa/parents/:id/cancel
 * Cancel a pending erasure. Clears coppa_erase_requested_at and completes the
 * lifecycle_tasks row. Anyone admin can cancel (no second admin required).
 */
router.post(
  "/admin/coppa/parents/:id/cancel",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params["id"] ?? "");
      const { data: parent } = await supabase
        .from("parents")
        .select("id, coppa_erase_requested_at, coppa_erased_at")
        .eq("id", id)
        .single();
      if (!parent) {
        res.status(404).json({ error: "Parent not found" });
        return;
      }
      if (parent.coppa_erased_at) {
        res.status(409).json({ error: "Parent has already been erased" });
        return;
      }
      if (!parent.coppa_erase_requested_at) {
        res.status(409).json({ error: "No erasure is requested for this parent" });
        return;
      }

      await supabase
        .from("parents")
        .update({
          coppa_erase_requested_at: null,
          coppa_erase_requested_by: null,
        })
        .eq("id", id);

      // Mark any open coppa_deletion_pending task complete.
      const completedBy = req.user?.email ?? req.user?.id ?? "unknown";
      await supabase
        .from("lifecycle_tasks")
        .update({
          completed: true,
          completed_at: new Date().toISOString(),
          completed_by: completedBy,
        })
        .eq("type", "coppa_deletion_pending")
        .eq("parent_id", id)
        .eq("completed", false);

      await logAudit({
        actorId: req.user?.id,
        actorEmail: req.user?.email,
        action: "parent.coppa_erasure_cancelled",
        entityType: "parent",
        entityId: id,
        req,
      });

      res.json({ parent_id: id, cancelled: true });
    } catch (err) {
      req.log?.error({ err }, "COPPA cancel endpoint error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * POST /api/admin/coppa/parents/:id/execute
 * Bypass the cooldown and execute now. Still requires the parent to be in
 * 'requested' state (one-step bypass, not a one-shot deletion).
 */
router.post(
  "/admin/coppa/parents/:id/execute",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params["id"] ?? "");
      const { data: parent } = await supabase
        .from("parents")
        .select("id, coppa_erase_requested_at, coppa_erased_at")
        .eq("id", id)
        .single();
      if (!parent) {
        res.status(404).json({ error: "Parent not found" });
        return;
      }
      if (parent.coppa_erased_at) {
        res.status(409).json({ error: "Parent has already been erased" });
        return;
      }
      if (!parent.coppa_erase_requested_at) {
        res.status(409).json({ error: "No erasure is requested — call /request first" });
        return;
      }

      const result = await executeCoppaErasure({
        parentId: id,
        actorId: req.user?.id,
        actorEmail: req.user?.email,
        note: "Manual immediate execution (cooldown bypassed)",
      });

      res.json(result);
    } catch (err) {
      req.log?.error({ err }, "COPPA execute endpoint error");
      res.status(500).json({ error: String(err) });
    }
  },
);

/**
 * GET /api/admin/coppa/pending
 * List parents pending erasure with their countdown.
 */
router.get(
  "/admin/coppa/pending",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    const { data, error } = await supabase
      .from("parents")
      .select("id, email, first_name, last_name, coppa_erase_requested_at, coppa_erase_requested_by")
      .not("coppa_erase_requested_at", "is", null)
      .is("coppa_erased_at", null)
      .order("coppa_erase_requested_at", { ascending: true });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data ?? []);
  },
);

/**
 * POST /api/admin/coppa/run-cron
 * Manual cron trigger (test helper).
 */
router.post(
  "/admin/coppa/run-cron",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    req.log?.info({ by: req.user?.email }, "Manual COPPA cron run triggered");
    const result = await runCoppaErasureCron();
    res.json(result);
  },
);

export default router;
