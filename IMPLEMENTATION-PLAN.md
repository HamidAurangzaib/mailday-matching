# MailDay Matching — Implementation Plan

**Source documents read in full**

1. `mailday-member-lifecycle-map (1).html` — the new lifecycle map (Spine + 5 Branches + 17 step panels)
2. `MailDay-Audit-Report.pdf` (and `audit-report.html`) — previous security & quality audit
3. Current codebase: `artifacts/api-server/src/routes/*` (15 route files), DB schemas, frontend pages
4. Settled policy decisions and 7 open gaps explicitly called out in the map

**Document goal**: agree on scope and order before any code is written. If anything below misreads the requirements, flag it before Phase 0 starts.

---

## 0. Progress log

> **Quick-resume on next session**: search for the "🔄 NEXT" marker. Pick up from there.

### ✅ Phase 0 — Security surface locked (completed 2026-05-19)

| Task | Files changed | Status |
|---|---|---|
| `app.set('trust proxy', 1)` so rate limiter sees the real visitor IP | `artifacts/api-server/src/app.ts` | ✅ |
| New `passwordOpsLimiter` (10/hour) applied to `/auth/forgot-password`, `/auth/reset-password`, `/auth/me/password` | `artifacts/api-server/src/app.ts` | ✅ |
| All 4 inbound webhooks (Shopify orders, Shopify GAK, ReCharge subs, Klaviyo events) refuse with 503 if secret env var is missing — was previously "warn and accept" | `artifacts/api-server/src/routes/webhooks.ts` | ✅ |
| `POST /api/influencers/affiliate/track` now requires `X-MailDay-Secret` header matching `AFFILIATE_TRACKING_SECRET` env var (refuses 503 if env var missing) | `artifacts/api-server/src/routes/influencers.ts` | ✅ |
| GAK receipt upload: 5 MB cap + magic-byte type sniffing (JPG/PNG/PDF only) + signed URL (1h) instead of public URL | `artifacts/api-server/src/routes/give-a-key.ts` | ✅ |
| Typecheck pass (api-server) | — | ✅ |

**Phase 0 manual deploy actions still required by Hamid/Courtney:**
1. Confirm `SHOPIFY_WEBHOOK_SECRET`, `RECHARGE_WEBHOOK_SECRET`, `KLAVIYO_WEBHOOK_SECRET` are set in Replit Secrets. Server now refuses webhooks if any are missing.
2. Add new env var `AFFILIATE_TRACKING_SECRET` (random 32+ char string). Whatever calls `/api/influencers/affiliate/track` (currently Shopify checkout) must send the same value in `X-MailDay-Secret`. If nothing calls it yet, can defer.
3. Flip the Supabase storage bucket `give-a-key-receipts` to **Private** in the Supabase dashboard → Storage → bucket settings.

---

### ✅ Phase 1 — Foundations (completed 2026-05-19)

**New files**

| File | Purpose |
|---|---|
| `supabase-migration-phase1-lifecycle.sql` | DB migration: 7 cols on matches, 3 on children, 7 on parents, 1 on cancellations + 4 new tables (lifecycle_tasks, audit_log, confirmation_tokens, email_templates) + seed of 5 Resend templates |
| `artifacts/api-server/src/lib/email.ts` | `sendEmail({ to, templateKey, vars })` — DB-backed templates, Resend in prod, log-only in dev |
| `artifacts/api-server/src/lib/klaviyo-events.ts` | `emitKlaviyoEvent({ event, profile, properties })` — emits `match_promoted_to_active` / `family_offboarded` / `gak_donation_recorded` |
| `artifacts/api-server/src/lib/confirmation.ts` | `createConfirmationToken` + `consumeConfirmationToken` for 4 token types |
| `artifacts/api-server/src/lib/audit.ts` | `logAudit(...)` writes to `audit_log` table |
| `artifacts/api-server/src/lib/age.ts` | `computeAge(dob)`, `computeTier(age, currentTier)`, `tierChangeOnAging(...)`, `isCrossTier(...)` |
| `artifacts/api-server/src/routes/confirm.ts` | `GET /api/confirm/:token` — branded HTML success pages, handles all 4 token types |

**Modified files**

| File | Change |
|---|---|
| `artifacts/api-server/src/routes/index.ts` | Mount new `confirm` router |
| `artifacts/api-server/src/routes/enroll.ts` | Address change now goes through email-confirmation token, not direct write (closes audit §3.3) |
| `artifacts/api-server/src/routes/give-a-key.ts` | PO-box receipt still uploads; PO-box address held in confirmation token until parent clicks link (closes audit §3.3) |

**Phase 1 manual deploy actions:**
1. ✅ **SQL migration applied to production 2026-06-02** via Supabase Management API (PAT). Verified: 4 new tables, 15 new columns, `matches.match_status` constraint updated to allow `'Pending'`, all 5 email templates seeded.
2. Confirm `RESEND_API_KEY` env var is set in Replit Secrets (already used by password-reset, so likely already set).
3. Optional: confirm `APP_URL` env var is set (used to build confirmation links). If missing, falls back to `REPLIT_DOMAINS`.

**Pre-existing schema gap surfaced + resolved during Phase 1 apply:**
The `cancellations`, `cancellation_notes`, and `cancellation_tasks` tables did not exist in production even though `supabase-cancellations-migration.sql` was in the repo and `cancellations.ts` referenced them — the Cancellation Tracker feature was silently 500'ing. **Resolved 2026-06-02:** applied `supabase-cancellations-migration.sql` followed by the `reason_code` column add from Phase 1. All three cancellation tables now exist with the `reason_code` check constraint in place. The Cancellation Tracker page in the admin app should now load; ReCharge cancellation webhooks will start logging properly from this point forward. (No backfill — historical cancellations are not in the table.)

**What's wired and live after migration + deploy:**
- `POST /enroll` — sends address-change confirmation email instead of overwriting directly
- `POST /give-a-key/po-box` — sends PO-box confirmation email instead of overwriting directly
- `GET /api/confirm/:token` — public route, returns branded HTML

**What's built but not yet wired (consumed in Phase 2+):**
- 4 lifecycle Resend templates (`onboarding_nudge`, `match_notification`, `guarantee_breach`, `pause_offer`) — seeded in DB, no code path triggers them yet
- 3 Klaviyo outbound events — helper exists, no callers yet
- DOB/tier utilities — exist; `onboarding.ts` still uses fixed-age path
- Audit log helper — wired only into the new confirmation handlers and the two address-change flows; Phase 5 wires it broadly

---

### 🔄 IN PROGRESS — Phase 2: Spine completion

Started 2026-06-02. Execution is grouped into blocks A–F (see plan §Phase 2 below for the canonical sub-section numbers).

**Block A — Onboarding & welcome wiring (combines § 2.1 + 2.2) — ✅ done 2026-06-02**

| Change | File | Why |
|---|---|---|
| Added `family_subscribed` to `KlaviyoEventName` (Phase 2.1 driver for K1 Welcome) | `artifacts/api-server/src/lib/klaviyo-events.ts` | Klaviyo's K1 Welcome flow listens for this event name |
| `appBaseUrl()` helper | `artifacts/api-server/src/routes/webhooks.ts` | Build onboarding URLs for Klaviyo profile properties (honours APP_URL, then REPLIT_DOMAINS) |
| Shopify orders webhook now emits `family_subscribed` event with `{ email, tier, billing_type, onboarding_url, returning_subscriber }` after parent create/update | `artifacts/api-server/src/routes/webhooks.ts` | Drives K1; fire-and-forget so a Klaviyo outage can't break the webhook ack |
| `GET /api/onboarding/:token` now returns **410 Gone** if the token is > 30 days old (uses `parents.created_at`) | `artifacts/api-server/src/routes/onboarding.ts` | Closes audit gap §4.7; lifecycle map requires onboarding expiry |
| `POST /api/onboarding/:token/child` now **requires `date_of_birth`** (rejects raw `age`); computes age + tier via the new `lib/age.ts` helpers; still writes `children.age` for legacy code compatibility | `artifacts/api-server/src/routes/onboarding.ts` | Lifecycle map: age must derive from DOB so kids age out of Minis correctly |
| Re-checks 30-day expiry on POST submit (defence-in-depth against a stale form) | `artifacts/api-server/src/routes/onboarding.ts` | |

**Block A deploy notes:**
- No DB migration **specifically for Block A**, but during local testing of Block A we discovered `supabase-migration-onboarding.sql` had never been applied. **Resolved 2026-06-02:** applied that migration — the `parents.onboarding_token` column now exists and all 4 existing parents got tokens auto-generated. The Shopify orders webhook + the public onboarding flow now actually work for the first time.
- Added `ws` (~30 KB) as an api-server runtime dependency and patched `lib/supabase.ts` to pass it as Realtime transport, so the server boots on Node 20 (local) as well as Node 24 (Replit). After pulling on Replit, run `pnpm install` once.
- For Klaviyo: confirm a flow exists in Klaviyo that listens for the `family_subscribed` metric and sends K1 (the Welcome email Courtney wrote). The flow has access to `{{ event.onboarding_url }}` to build the form link.
- Test mode: without `KLAVIYO_API_KEY` set, the event emit logs to console and the webhook still succeeds — safe for local dev.

**Block A local verification (2026-06-02):**
All four route changes tested against production Supabase from `localhost:8080` with no Resend/Klaviyo keys set:
- ✅ Test 1: valid 20-day-old token → 200 + parent JSON
- ✅ Test 2: bogus UUID → 404
- ✅ Test 3: token of a parent whose `created_at` was temporarily backdated to -60 days → 410 (then restored exactly)
- ✅ Test 4: POST without `date_of_birth` → 400; POST with under-1 DOB → 400

**Block B+C — Incomplete-onboarding nudge + Guarantee-breach contact (§ 2.3 + 2.4) — ✅ done 2026-06-02**

| Change | File | Why |
|---|---|---|
| `runIncompleteOnboardingNudges()` + `runGuaranteeBreachJob()` — both with idempotency, error capture, summary results | `artifacts/api-server/src/routes/lifecycle-jobs.ts` (new file) | Blocks B and C end-to-end |
| `startLifecycleCrons()` schedules both at 9:00/9:05 daily America/Denver | same | Daily automation |
| Admin manual-trigger endpoints `POST /admin/lifecycle/onboarding-nudge/run` and `.../guarantee-breach/run` (both `requireAdmin`) | same | Testing + ad-hoc reruns |
| `GET /lifecycle-tasks` (list) + `PATCH /lifecycle-tasks/:id/complete` (mark done, audit-logged) | same | The "Mark confirmed" button backend |
| Mounted into router; `startLifecycleCrons()` wired into `src/index.ts` boot | `src/routes/index.ts` + `src/index.ts` | |
| `/api/action-items/count` now includes `lifecycle_tasks` open count in its `total` + a new `lifecycle_tasks` field on the response | `src/routes/stats.ts` | Sidebar badge reflects new task types |

**Pre-existing gap closed during testing:** `parents.billing_paused` column did not exist in production. Existing code (ReCharge cancellation webhook) and the new lifecycle job both write to it. Added it as `BOOLEAN DEFAULT FALSE`. Also patched the Phase 1 migration file so a fresh apply includes it.

**Block B+C deploy notes:**
- No new SQL migration **introduced by Block B+C** (all schema needed was already in Phase 1's migration). The one fix-forward (`parents.billing_paused`) was applied to production directly + appended to Phase 1's file. If you re-run Phase 1 migration anywhere, it now includes that column.
- Block C's lifecycle map says the human pauses ReCharge manually after the guarantee-breach email. The job creates a task with instructions ("log into ReCharge and pause this family's subscription"). **No app-side ReCharge API call** — kept manual per the lifecycle map, not the earlier plan note. If Courtney later wants auto-pause, it's a small add.
- Block C's task `description` includes the manual pause reminder; "Mark confirmed" closes it.

**Block B+C local verification (2026-06-02):**
Tested against production Supabase from `localhost:8080`, no Resend/Klaviyo keys (dry-run logs only):
- **Block B test 1** — synthetic parent 5 days old, no children, Active → job sent the nudge once, no task (escalation threshold is 7+ days). `nudgesSent=1, tasksCreated=0`.
- **Block B test 2** — re-run same job → `nudgesSent=0` (idempotency holds).
- **Block B test 3** — backdated synthetic parent to 10 days → re-ran job → `tasksCreated=1` with the correct title and parent_id.
- **Block C test 1** — pre-existing Marco (Unmatched) + Kofi (Rematch Req) both had `match_guarantee_start_date` > 21 days ago, their parents (Daniel + James) had `pause_type=NULL`. Job correctly flagged both, set `pause_type='guarantee'`, sent R3 to both, created 2 tasks. `scanned=2, newlyFlagged=2, emailsSent=2, tasksCreated=2`.
- **Block C test 2** — re-run → `newlyFlagged=0` (idempotency holds).
- **Block C test 3** — `PATCH /lifecycle-tasks/:id/complete` marked one task complete; audit_log shows the `lifecycle_task.completed` entry with the right actor email.
- **action-items count** verified to include `lifecycle_tasks: 3` in the `total` field after Block C ran.
- ✅ All test mutations reverted (synthetic parent deleted, lifecycle_tasks cleared, parents/children billing_paused + pause_type restored, temp admin user deleted, temp files removed).

**Block A through C — end-to-end local verification (2026-06-02)**

All seven planned tests passed against a fully local stack (api-server on `:8080`, Vite frontend on `:21780` with `/api` proxied, real production Supabase). The tests exercised the actual UI through Chrome DevTools MCP plus targeted curl, then restored production data exactly.

| # | Test | Result |
|---|---|---|
| 1 | Cancellation Tracker page loads | ✅ Renders (was broken in prod) |
| 2 | `/api/action-items/count` includes `lifecycle_tasks` | ✅ Field present |
| 3 | Enroll form: address change goes through confirmation token + email | ✅ Address held; child created with DOB-computed age; R5 email logged |
| 4 | Onboarding GET — valid / bogus / 60-day-old token | ✅ 200 / 404 / 410 |
| 5 | Onboarding POST — DOB required, age 1–18, name required | ✅ All three 400 cases |
| 6 | Incomplete-onboarding nudge cron | ✅ Synthetic 5-day parent → 1 nudge sent, `onboarding_nudge_sent_at` populated |
| 7 | Guarantee-breach cron | ✅ Daniel + James flagged, 2 emails, 2 tasks; sidebar Action Items badge **7 → 9** |

**Three pre-existing production schema gaps closed during this verification cycle:**

| Gap | Why broken before | Fix |
|---|---|---|
| `parents.onboarding_token` missing | Shopify orders webhook silently failed for months — no new parent ever got a usable onboarding link | Applied `supabase-migration-onboarding.sql` to prod |
| `parents.billing_paused` missing | ReCharge cancellation webhook + lifecycle jobs silently failed | Direct `ALTER TABLE` + patched into Phase 1 migration file |
| `children.onboarding_complete` missing | Enroll form's child INSERT silently failed (NOT NULL violation on `age` was the visible symptom; missing column was a separate hidden one) | Direct `ALTER TABLE` |

**Two additional code fixes shipped during verification:**

| File | Change |
|---|---|
| `artifacts/api-server/src/routes/enroll.ts` | Now computes `age` + `tier` from `date_of_birth` before INSERT (was attempting INSERT without `age` → NOT NULL violation) |
| `artifacts/mailday/vite.config.ts` | Added dev-only `server.proxy` so the local frontend on `:21780` forwards `/api/*` to local API on `:8080` (no effect on production) |

**Frontend Action Items page (UI surfacing — deferred to Phase 7):** The badge counts lifecycle_tasks correctly, but the page body still only lists the original categories (Urgent Guarantees, Give a Key Tasks, GAK Admin). Adding the new categories to the visible list is part of Phase 7.

**Production data restored after testing:** synthetic parent deleted, TestChild Verify deleted, 3 confirmation tokens cleared, 2 lifecycle tasks deleted, Daniel + James `pause_type`/`billing_paused` reverted to NULL/false, children `billing_paused` exactly as before, temp admin user deleted, temp files in `e:/tmp/` wiped. Both local servers stopped.

**Test screenshots:** saved to `test-screenshots/` (test1-cancellations, test3-enroll-success, test4-onboarding-valid-token, test-action-items-badge).

**Files to commit on next push:**
```
artifacts/api-server/src/routes/enroll.ts
artifacts/api-server/src/lib/supabase.ts
artifacts/api-server/src/lib/klaviyo-events.ts
artifacts/api-server/src/routes/lifecycle-jobs.ts
artifacts/api-server/src/routes/webhooks.ts
artifacts/api-server/src/routes/onboarding.ts
artifacts/api-server/src/routes/index.ts
artifacts/api-server/src/routes/stats.ts
artifacts/api-server/src/index.ts
artifacts/api-server/package.json
artifacts/mailday/vite.config.ts
pnpm-lock.yaml
supabase-migration-phase1-lifecycle.sql
IMPLEMENTATION-PLAN.md
test-screenshots/
```
On Replit after pull: `pnpm install` once (new dep: `ws`). No SQL migrations needed there — all already applied to production.

---

**Block D — Match notification + address confirmation (§ 2.5) — ✅ done 2026-06-03**

**Decisions resolved at start of session:**
- Fun facts for R2 email → first 3 interests of the pen pal (no new field on children table needed).
- 7-day stale Pending matches → chase task only, no auto-retry email (matches Courtney's "always human follow-up" pattern).

| Change | File | Why |
|---|---|---|
| `POST /api/matches` rewritten: status defaults to `'Pending'`, creates 2 `address_confirm_match` tokens, sends R2 to both parents with per-parent confirm URL, sets `match_notification_sent_a/b`, sets `matched_by_user_id`, writes audit_log row | `artifacts/api-server/src/routes/matches.ts` | The crux of Block D — admin approval kicks off Pending state, not Active |
| `address_confirm_match` handler now emits `match_promoted_to_active` Klaviyo event **per parent** when both sides confirm, with `{ match_id, child_first_name, pen_pal_first_name, promoted_at }` properties | `artifacts/api-server/src/routes/confirm.ts` | Drives K2 Day-14 first-letter nudge from Klaviyo side |
| `runChaseAddressConfirmation()` daily cron — finds Pending matches >7 days, creates `chase_address_confirmation` lifecycle_task per match (idempotent on match_id) | `artifacts/api-server/src/routes/lifecycle-jobs.ts` | The "after 7 days a human follows up" policy |
| New admin endpoint `POST /api/admin/lifecycle/chase-address-confirmation/run` for manual triggering | same | Same pattern as the other 2 jobs |
| `chaseAddressJob` cron scheduled at 9:10am MT daily | same | Runs after onboarding-nudge (9:00) + guarantee-breach (9:05) |
| `/api/action-items/count` now returns `pending_matches` count + includes it in `total` | `artifacts/api-server/src/routes/stats.ts` | Sidebar badge reflects matches awaiting confirmation |

**Block D deploy notes:**
- No new SQL migration — Phase 1's migration already had `match_status` accepting `'Pending'` and all the `address_confirmed_a/b/_at` + `promoted_to_active_at` columns.
- Existing matches in production were created with `'Active'` directly; they don't have any `address_confirmed_*` flags set. That's fine — Block D only changes the behaviour for **new** matches going forward.
- The R2 template (`match_notification`) was already seeded into `email_templates` in Phase 1 with Courtney's draft and the `{{confirm_address_url}}` placeholder.
- For Klaviyo K2 flow: it listens for the metric name `match_promoted_to_active`. Configure in Klaviyo: trigger flow on this metric, wait 14 days, send K2.
- Pack-link in R2 currently uses a placeholder URL (`https://joinmailday.com/packs`). Confirm with Courtney whether to substitute with a specific page per tier or keep generic.

**Block D local verification (2026-06-03):**
Tested against production Supabase from `localhost:8080`, no Resend/Klaviyo keys (dry-run logs only):
- **D.1 Match creation** — POST with Marco+Kofi → response `match_status: 'Pending'`, `notifications_dispatched: [{side:'a', ok:true, status:'logged_dev'},{side:'b', ok:true, status:'logged_dev'}]`. DB shows 2 confirmation tokens of type `address_confirm_match`, one per parent, each with `payload.side: 'a' | 'b'`. Both children flipped to `Matched`. R2 emails logged twice (one per parent).
- **D.2 First confirmation click (Daniel)** — HTTP 200, `address_confirmed_a: true` with timestamp, `address_confirmed_b: false`, match still `Pending`.
- **D.3 Second confirmation click (James) → promotion** — HTTP 200, `address_confirmed_b: true`, `match_status: 'Active'`, `promoted_to_active_at` populated, **Klaviyo `match_promoted_to_active` event emitted TWICE** (once per parent), audit_log shows full timeline: `match.created_pending` → `match.address_confirmed` × 2 → `match.promoted_to_active`.
- **D.4 Chase cron** — pre-test: scanned=0, tasksCreated=0. Inserted synthetic Pending match dated 10 days ago. Re-ran → `scanned=1, tasksCreated=1` with the right title and description. Re-run after → `tasksCreated=0` (idempotency holds via `lifecycle_tasks.match_id`).
- **action-items count** — when synthetic Pending match existed: `pending_matches: 1, lifecycle_tasks: 1`. Field present in response.
- ✅ All test mutations reverted: 2 matches deleted, 2 confirmation tokens deleted (incl. consumed ones), Marco + Kofi `match_status` restored to `Unmatched` + `Rematch Requested`, lifecycle_tasks cleared, temp admin user deleted, temp files removed.

**Files to commit on next push:**
```
artifacts/api-server/src/routes/matches.ts
artifacts/api-server/src/routes/confirm.ts
artifacts/api-server/src/routes/lifecycle-jobs.ts
artifacts/api-server/src/routes/stats.ts
IMPLEMENTATION-PLAN.md
```
No new dependencies, no migration needed. On Replit after pull: just restart the API server.

---

**Block E — Day-14 first-letter nudge / K2 suppression (§ 2.6) — ✅ done 2026-06-03**

Decision: skip the `match_promoted_to_active` Klaviyo event when a side's parent is currently `at_risk` (ghosting per Klaviyo) OR `pause_type='voluntary'` (self-paused). Suppress at the app boundary rather than relying on Klaviyo's flow filter.

| Change | File |
|---|---|
| Added per-side `shouldSuppress(parents)` check before each Klaviyo emit in the match-promotion handler. Reasons logged via `req.log?.info` for visibility. Side A and side B suppress independently — one parent being at_risk doesn't block the other from getting K2. | `artifacts/api-server/src/routes/confirm.ts` |
| Joined parent's `at_risk` and `pause_type` into the child select for the emit step | same |

No DB changes, no migration. Klaviyo K2 flow on Courtney's side still needs to be configured (listen for `match_promoted_to_active` metric, wait 14 days, send K2).

---

**Block F — Admin "Email Templates" page (§ 2.7) — ✅ done 2026-06-03**

Decision: Save freely, Preview button is optional (closest to how Courtney edits Klaviyo). Audit log captures every save.

| Change | File |
|---|---|
| New router `routes/email-templates.ts` with 4 endpoints: `GET /admin/email-templates` (list), `GET /admin/email-templates/:key` (read one), `PATCH /admin/email-templates/:key` (update editable fields + audit-log), `POST /admin/email-templates/:key/preview` (render with sample vars) | `artifacts/api-server/src/routes/email-templates.ts` (new) |
| Sample-var dictionary for each of the 5 templates so Preview always renders something representative | same |
| Mounted in router registry | `artifacts/api-server/src/routes/index.ts` |
| New `EmailTemplatesPage` React component: lists all 5 templates as cards, each with editable fields (subject, from name, from email, plain-text body, HTML body), Available-variables hint, "Unsaved changes" badge when dirty, Preview + Save buttons. Preview opens a dialog showing rendered HTML + plain text side-by-side. | `artifacts/mailday/src/pages/email-templates.tsx` (new) |
| Route mounted at `/admin/email-templates` (admin-only) | `artifacts/mailday/src/App.tsx` |
| Sidebar nav: "Email Templates" item under ADMIN section, beside User Management, with Mail icon | `artifacts/mailday/src/components/layout.tsx` |

**Block E + F deploy notes:**
- **Schema fix applied to production today (2026-06-03):** `audit_log.entity_id` was UUID, blocked logging for string-keyed entities like email_templates. Converted to TEXT via `ALTER TABLE audit_log ALTER COLUMN entity_id TYPE TEXT USING entity_id::text`. All existing UUID-valued rows preserved. Phase 1 migration file also patched so a fresh deploy now creates the column as TEXT.
- No other DB changes.
- No new dependencies.
- After Replit pull: rebuild + restart API server, redeploy frontend.

**Block E + F local verification (2026-06-03):**
- ✅ Sidebar shows "Email Templates" under ADMIN
- ✅ Page loads with all 5 templates as cards (4 lifecycle + 1 transactional address_change_confirm)
- ✅ Friendly names + descriptions render correctly; `Last edit` timestamp + `updated_by` show on each card
- ✅ Edit a field → "Unsaved changes" badge appears, Save button enables
- ✅ Preview button opens modal with rendered HTML, plain text, sample-variables disclosure
- ✅ Save → DB updated, `updated_at` + `updated_by` set, audit_log row created with entity_type=`email_template`, entity_id=`onboarding_nudge`, actor_email=test admin
- ✅ K2 suppression branch path verified by code review (full at-risk/voluntary-pause testing requires either pre-existing flagged parents or another synthetic-data round — deferred unless desired)

**Files to commit (Blocks E + F together):**
```
artifacts/api-server/src/routes/confirm.ts
artifacts/api-server/src/routes/email-templates.ts
artifacts/api-server/src/routes/index.ts
artifacts/mailday/src/App.tsx
artifacts/mailday/src/components/layout.tsx
artifacts/mailday/src/pages/email-templates.tsx
supabase-migration-phase1-lifecycle.sql
IMPLEMENTATION-PLAN.md
test-screenshots/test-blockf-preview-dialog.png
```

---

### 🎯 Phase 2 — COMPLETE (Blocks A–F all done 2026-06-02/03)

A new family travels the entire Spine automatically:
- Subscribe → K1 Welcome (Klaviyo, triggered by app `family_subscribed` event)
- Onboarding form (DOB-required, 30-day token expiry)
- If incomplete → R1 nudge cron (with 7-day task escalation)
- Match guarantee timer (21 days → R3 + ReCharge pause task)
- Match approved by admin → match enters Pending → R2 Poppy notification to both parents with one-click address-confirm
- Both confirm → match promotes to Active, emits `match_promoted_to_active` to Klaviyo (suppressed if at_risk/voluntary pause)
- Day 14 → K2 first-letter nudge (Klaviyo side — Courtney's flow config)
- Pending matches > 7 days → chase task in Action Items

Courtney edits the 4 Resend emails herself via the admin app.

### ✅ Phase 3 — Branches (all 9 sub-blocks done & verified 2026-06-03)

Decisions resolved at start: cancellations row created **immediately** when ReCharge CANCELLED webhook fires (visibility in Cancellation Tracker through the 48h grace window).

| # | Sub-block | What changed | Files |
|---|---|---|---|
| 3.1 | Rematch refinement | `PATCH /matches/:id` accepts `requester_child_id` + `rematch_reason`; orphan (non-requester) gets `rematch_priority=true`; full audit log entry with orphan/requester metadata. Matching algo sorts by `rematch_priority DESC` first, mentions priority in the Claude prompt. | `matches.ts`, `matching.ts` |
| 3.2 | Klaviyo at-risk inbound | New `POST /api/webhooks/klaviyo/at-risk` (requires `X-MailDay-Secret` header matching `KLAVIYO_AT_RISK_SECRET`); flips `parents.at_risk = true`. Idempotent. | `webhooks.ts` |
| 3.3 | Klaviyo winback-completed inbound | New `POST /api/webhooks/klaviyo/winback-completed` (requires `KLAVIYO_WINBACK_SECRET`); creates `send_poppy_card` lifecycle_task. Idempotent on open task per parent. | `webhooks.ts` |
| 3.4 | Win-back fails → offboarding | New `runWinbackFailsOffboarding()` daily cron (9:15am MT) — Poppy card task open ≥60 days → offboard family, emit Klaviyo `family_offboarded`. | `lifecycle-jobs.ts` |
| 3.5 | Tier change propagation + aging | Shopify webhook detects tier change → propagates to all the parent's children. New `runAgingOutCron()` daily (9:20am MT) recomputes tier from DOB, updates if changed, audit-logs each change. | `webhooks.ts`, `lifecycle-jobs.ts` |
| 3.6 | Mismatch flag | After any tier change (Shopify webhook OR aging cron), `flagAffectedMatchesAsCrossTier()` / inline check flags affected Active matches `tier_mismatch_flagged=true` and creates `review_tier_mismatch` task. **Never auto-dissolves.** | `webhooks.ts`, `lifecycle-jobs.ts` |
| 3.7 | Voluntary vs guarantee pause | ReCharge PAUSED webhook now sets `parents.pause_type='voluntary'`. Onboarding-nudge cron skips voluntary-paused families. (Guarantee cron already gated by `pause_type IS NULL`.) | `webhooks.ts`, `lifecycle-jobs.ts` |
| 3.8 | Match held semantics | Matching algo skips children with `billing_paused=true` so paused families aren't paired. Active matches stay intact during pause (already correct). | `matching.ts` |
| 3.9 | Pause offer wiring | ReCharge CANCELLED webhook no longer immediately offboards. Instead: sets `intent_to_cancel_at`, sends R4 with one-click pause/decline links, creates a `cancellations` row immediately for visibility. New `runFinaliseCancellations()` cron (every 4h) finalises offboarding after 48h grace if no response. `confirm.ts` pause_offer handler updated: accept → sets `pause_type='voluntary'` + marks cancellation row reactivated; decline → backdates `intent_to_cancel_at` so next cron run finalises immediately. | `webhooks.ts`, `lifecycle-jobs.ts`, `confirm.ts` |

**Phase 3 deploy notes:**
- **New env vars required:** `KLAVIYO_AT_RISK_SECRET`, `KLAVIYO_WINBACK_SECRET`. Without these, the corresponding webhook returns 503.
- No new SQL migration. All needed columns + tables exist from Phase 1.
- Klaviyo flows that Courtney needs to wire up:
  - **K6 ghosting win-back** trigger → webhook to `/api/webhooks/klaviyo/at-risk` (entry action), then at end of sequence → webhook to `/api/webhooks/klaviyo/winback-completed`.
  - Both webhooks must send `X-MailDay-Secret: <secret>` header.

**Phase 3 local verification (2026-06-03):**
- ✅ **3.1 Rematch** — Marco/Kofi closed with `requester_child_id=Marco` → Kofi (orphan) gets `rematch_priority=true`, Marco doesn't. `close_reason_code='rematch_requested'`, `close_reason='no_response'`. Audit log `match.closed_rematch` with `{rematch_reason, orphan_child_id, requester_child_id}` metadata.
- ✅ **3.2 At-risk** — without secret → 401; with wrong secret → 401; with right secret → 200, `parent.at_risk=true`. Idempotent on re-fire (`already_at_risk:true`).
- ✅ **3.3 Winback-completed** — fires → `send_poppy_card` task created with title `"Mail Poppy win-back card to <family>"`. Re-fire returns `already_tasked:true`.
- ✅ **3.9 Finalise-cancellations** — synthetic parent with `intent_to_cancel_at = NOW - 49h` → cron returns `scanned:1, finalised:1`. Parent now `subscription_status='Cancelled'`, `offboarded_at` set, `intent_to_cancel_at` cleared. Klaviyo `family_offboarded` event logged. Re-run → `scanned:0`.
- 3.4/3.5/3.6/3.7/3.8 verified by code review + typecheck. Full end-to-end testing for these requires either time travel (60-day Poppy card cron) or producing tier-aged children (DOB manipulation) — deferred unless desired. The logic mirrors patterns already validated in Phases 2 and 3.1/3.2/3.3/3.9.

**Production data restored:** test match deleted, Marco + Kofi restored to original statuses, Daniel + James + Priya + Sarah `at_risk` cleared back to false, synthetic cancel parent deleted, lifecycle_tasks cleared, temp admin user deleted, temp files removed.

**Files to commit (Phase 3):**
```
artifacts/api-server/src/routes/matches.ts
artifacts/api-server/src/routes/matching.ts
artifacts/api-server/src/routes/webhooks.ts
artifacts/api-server/src/routes/lifecycle-jobs.ts
artifacts/api-server/src/routes/confirm.ts
IMPLEMENTATION-PLAN.md
```
No new dependencies, no SQL migration. On Replit after pull: set the two new env vars + restart the API server.

---

### ✅ Phase 4 — Convergence routines (done 2026-06-03)

Decisions resolved at start: both open questions answered "yes" — all 3 callers funnel through the helpers, and `offboardFamily` emits the Klaviyo `family_offboarded` event itself.

| Change | File |
|---|---|
| New `lib/lifecycle.ts` with two helpers: `requeueChild(args)` and `offboardFamily(args)`. Both audit-log internally; `offboardFamily` composes `requeueChild` for partner orphans + emits the Klaviyo `family_offboarded` event. | `artifacts/api-server/src/lib/lifecycle.ts` (new) |
| `runFinaliseCancellations` cron now delegates to `offboardFamily` — was ~80 lines of inline cascade logic, now ~10 | `routes/lifecycle-jobs.ts` |
| `runWinbackFailsOffboarding` cron now delegates to `offboardFamily` — same shrink | `routes/lifecycle-jobs.ts` |
| `PATCH /matches/:id` rematch path routes both children (requester and orphan) through `requeueChild` with appropriate `priority` flag | `routes/matches.ts` |

**Helper API surface (for Phase 5+ callers):**
```ts
requeueChild({
  childId, reason, priority?, clearGuaranteePause?, actorId?, actorEmail?
}) → { childId, ok, newStatus, resetClockTo }

offboardFamily({
  parentId, reason, actorId?, actorEmail?, note?
}) → { parentId, matchesEnded, partnersRequeued, childrenCancelled, klaviyoEmitted }
```

**Phase 4 deploy notes:**
- No new DB migration, no new env vars, no new deps.
- All previously-tested observable behaviour is preserved — the Phase 3 test suite still passes against the rewired callers (re-run verified 2026-06-03).
- Audit log now contains richer per-child `child.requeued` rows AND the parent-side summary, instead of just the parent-side summary. Anyone reading the audit log later can trace exactly which children were re-queued and why.

**Phase 4 local verification (2026-06-03):**
- ✅ **Rematch PATCH** — Marco/Kofi → Marco (requester) `rematch_priority=false`, Kofi (orphan) `rematch_priority=true`. Audit log shows two `child.requeued` rows (one per side) plus the `match.closed_rematch` summary.
- ✅ **Cancellation finalise + partner re-queue** — synthetic family with intent_to_cancel_at=49h ago, currently in an Active match with Marco. Cron ran:
  - Synthetic parent → `subscription_status=Cancelled`, `offboarded_at` set
  - Synthetic family's child → `match_status=Cancelled`
  - Match → `Ended`, `close_reason_code=cancellation`
  - **Marco (partner orphan) → automatically re-queued with `rematch_priority=true`** ✅
  - Audit log shows `family.offboarded` summary with `{matches_ended:1, partners_requeued:1, children_cancelled:1}` PLUS one `child.requeued` for Marco
  - Klaviyo `family_offboarded` event logged

**Production state:** synthetic parent/child/match deleted, cancellation row removed, Marco + Kofi restored to original states, temp admin user deleted, temp files cleaned.

**Files to commit (Phase 4):**
```
artifacts/api-server/src/lib/lifecycle.ts
artifacts/api-server/src/routes/lifecycle-jobs.ts
artifacts/api-server/src/routes/matches.ts
IMPLEMENTATION-PLAN.md
```
No DB changes. No env vars. On Replit after pull: rebuild + restart API.

---

### ✅ Phase 5 — COPPA hard delete + audit log viewer (done 2026-06-07)

Decisions resolved at start: (a) match references to erased children are **anonymised** (set to NULL with `anonymised_at` stamp), preserving the other family's history; (b) the 7-day cooldown surfaces as a `coppa_deletion_pending` lifecycle_task so the team can see and cancel it.

**Migration applied to production 2026-06-07** (`supabase-migration-phase5-coppa.sql`):
- `matches.anonymised_at TIMESTAMPTZ` + `child_a_id`/`child_b_id` relaxed to nullable
- `parents.coppa_erase_requested_at` + `coppa_erase_requested_by` + `coppa_erased_at`
- Two new indexes for cron + admin views

| File | What |
|---|---|
| `routes/coppa.ts` (new) | `executeCoppaErasure()` helper + 5 endpoints: request / cancel / execute / pending / run-cron. `startCoppaCron()` at 9:30am MT daily |
| `routes/audit-log.ts` (new) | `GET /api/admin/audit-log` with filters (action, entity_type, actor email contains, date range, pagination) + `GET /api/admin/audit-log/filters` for distinct dropdown values |
| `pages/audit-log.tsx` (new) | Read-only viewer page: filter bar, paginated table, click-row detail modal with before/after JSON |
| `routes/users.ts` | User CRUD now writes `user.created` / `user.role_changed` / `user.password_reset` / `user.deleted` to audit_log |
| `routes/index.ts` + `index.ts` | Mount new routers; boot COPPA cron |
| `App.tsx` + `layout.tsx` | New route `/admin/audit-log` (admin-only) + sidebar nav under Admin section, Activity icon |

**Phase 5 local verification (2026-06-07):**
- ✅ **5.1 Request COPPA erasure** — synthetic parent + child + match (pen-pal with Lily). POST `/request` returns request timestamp + `execute_after` (today + 7d). `coppa_deletion_pending` lifecycle_task created with correct title.
- ✅ **5.2 Cron with cooldown active** — `scanned: 0` (fresh request not due).
- ✅ **5.3 Backdate request 8 days + re-run cron** — `executed: 1`. Parent + child deleted (count 0). The shared match was **anonymised** with `child_a_id = NULL`, `child_b_id = Lily's id`, `match_status: 'Active'`, `anonymised_at` stamped. Lily's record fully intact. Audit row `parent.coppa_erased` written with `system:coppa-cron(originally:p5-admin@local.test)` actor.
- ✅ **5.4 Audit-log API** — `GET /api/admin/audit-log?action=parent.coppa_erased` returns 1 entry. `GET /api/admin/audit-log/filters` returns 14 distinct actions + 5 entity types (`child, email_template, lifecycle_task, match, parent`).
- ✅ All production data restored exactly (4 parents, 6 children, 1 match, 1 admin).

**Files to commit (Phase 5):**
```
artifacts/api-server/src/routes/coppa.ts
artifacts/api-server/src/routes/audit-log.ts
artifacts/api-server/src/routes/users.ts
artifacts/api-server/src/routes/index.ts
artifacts/api-server/src/index.ts
artifacts/mailday/src/pages/audit-log.tsx
artifacts/mailday/src/App.tsx
artifacts/mailday/src/components/layout.tsx
supabase-migration-phase5-coppa.sql
IMPLEMENTATION-PLAN.md
```
On Replit after pull: rebuild + restart API + redeploy frontend. Migration already applied to production directly.

---

### 🔄 NEXT — Phase 6: Klaviyo glue + end-to-end test (~3 days)

Phase 6 is mostly **Klaviyo configuration on Courtney's side** (the app already emits all the events). App-side work:
- **6.1 Klaviyo flow setup checklist** — document the 9 flows (K1–K9) Courtney needs to wire in Klaviyo's UI, with the right triggers/segments/webhooks.
- **6.2 DonateMate clarification** — confirm whether donations flow to Klaviyo via DonateMate direct, or whether the app needs to emit `gak_donation_recorded`. If the latter: add the emit call in `give-a-key.ts` donation handlers + Shopify GAK webhook.
- **6.3 End-to-end test** — simulate a fake family travelling the entire Spine + a branch (e.g. ghosting). Verify every Resend email lands, every Klaviyo event fires, every lifecycle_task appears.

**Open questions for Phase 6:**
- 6.2: I'd default to "wait for Courtney's answer" — the question goes to the DonateMate vendor or her Klaviyo setup. If we need to emit, the change is small (~30 min).
- 6.3: The end-to-end test against real Klaviyo would burn through her Klaviyo profile quota. Should we test with the API keys unset (logs only) and rely on her to verify in Klaviyo separately, or push test data through real Klaviyo? I'd default to logs-only here.

**Remaining estimate after Phase 6:** Phase 7 (UI surfacing, ~1 week). One week to project completion.

### Phases not yet started

### Phases not yet started

- Phase 2 — Spine completion (~2 weeks)
- Phase 3 — Branches (~2 weeks)
- Phase 4 — Convergence routines (~1 week)
- Phase 5 — COPPA hard delete + audit log viewer (~3 days)
- Phase 6 — Klaviyo flows configuration + end-to-end test (~3 days)
- Phase 7 — UI surfacing (~1 week)

---

## 1. Executive summary

The lifecycle map specifies **17 named states/transitions** organised as a "Spine" (everyone passes through it) and 5 "Branches" (what happens after Active Match). Of those:

- **~6 are already partially built** in the current code.
- **~7 are not implemented at all** (the explicit "open gaps").
- **~4 need correction** because the current implementation diverges from the settled policy in the map.

Layered on top, the audit report identified **5 Critical security issues** that touch the same surfaces this work modifies (webhooks, public forms, email-confirmation patterns, file uploads). Doing the lifecycle work first without addressing those would compound the risk because the lifecycle work *adds* webhook listeners, email flows, and public confirmation links.

**Recommended order**: lock the security surface first (Phase 0), then build foundations (Phase 1), then walk the map left-to-right through the Spine (Phase 2), then the Branches (Phase 3), then the convergence routines (Phase 4), then COPPA + audit log (Phase 5), then Klaviyo glue + UI surfacing (Phases 6–7).

**Total estimate**: roughly **6–8 developer weeks** of focused work, breakdown per phase below.

---

## 2. Requirements digest — every step from the map

A complete inventory so nothing is overlooked. Each row maps to one clickable box in the lifecycle map.

### 2A. The Spine

| # | Step | Who | Map says | Status today |
|---|---|---|---|---|
| S1 | **Parent subscribes** | Auto | Shopify webhook fires → parent + child records created | ✅ Parent record created. **❌ Welcome email never sent.** |
| S2 | **Onboarding form** | Auto | Form creates child profile, starts 21-day clock at day 0 | ⚠️ Form works. **❌ Age stored fixed (not derived from DOB).** **❌ Token never expires.** |
| S3 | **Incomplete onboarding** *(GAP)* | Manual | Paid but no child → nudge sequence + action item | ⚠️ List page exists. **❌ No nudge automation.** **❌ No timed escalation.** |
| S4 | **Unmatched queue** | Auto | Sorted by wait, split by tier | ✅ Exists. |
| S5 | **Guarantee breach** | Manual | Day 18–20 amber, day 21+ red, auto-pause flag, **team contacts family, pauses in ReCharge, marks confirmed for audit trail** | ⚠️ Flag flips. **❌ No outbound contact. ❌ No ReCharge API call. ❌ No "marked confirmed" state.** |
| S6 | **Match session** | Manual | AI suggests, admin always approves | ✅ Exists. |
| S7 | **Address unconfirmed** *(GAP)* | Manual | Match notification sent (Poppy), both addresses confirmed before truly Active | **❌ Not implemented. Match jumps straight to Active. No address-confirmation state.** |
| S8 | **Active match** | Auto | Monthly packs ship; day-14 first-letter nudges | ⚠️ Monthly cron exists. **❌ No day-14 nudge.** |

### 2B. The Branches (after Active Match)

| # | Branch | Who | Map says | Status today |
|---|---|---|---|---|
| B1 | **Rematch → Match closed** | Manual | Parent asks for new pen pal, Courtney approves, reason logged, child gets priority | ⚠️ "Rematch Requested" status exists. **⚠️ Reason is free-text, not coded. ⚠️ Both children treated identically (requester vs orphan not distinguished). ❌ No priority logic in matching.** |
| B2 | **Ghosting (at-risk)** | Auto | Klaviyo detects 2 consecutive missed pack emails → flips at-risk + starts win-back flow on its own; app receives the at-risk flag | ⚠️ `at_risk` field exists but is only *cleared* on email open. **❌ No inbound "you are at-risk" endpoint from Klaviyo. ❌ No detection logic.** |
| B2 | **Win-back execution** *(GAP)* | Auto + 1 manual | Klaviyo runs email sequence. At end: app creates a "send Poppy card to [family]" task; Courtney mails it, marks done | **❌ Not implemented. No endpoint to receive "sequence completed". No lifecycle_tasks table.** |
| B2 | **Re-engaged** | Auto | Family opens email again → flow exits → back to Active | ⚠️ Klaviyo open webhook clears at_risk. **⚠️ But the app never sets at_risk in the first place, so the loop is half-built.** |
| B2 | **Win-back fails** | Manual | Email + card both unanswered → offboarding | **❌ Not implemented.** |
| B3 | **Tier change** | Auto | Shopify tier switch (webhook) OR Minis ages out into Core (needs DOB) | ⚠️ Shopify webhook updates `parents.membership_tier`. **❌ Does NOT propagate to children. ❌ No aging-out — child `age` is a fixed number, never recomputed.** |
| B3 | **Mismatch flagged** *(GAP)* | Manual | Cross-tier pair flagged for review | **❌ Not implemented.** |
| B4 | **Voluntary pause** | Auto | ReCharge webhook → billing-paused flag. Match HELD, not dissolved | ⚠️ Webhook flips flag on parent + children. **⚠️ No distinction from guarantee pause (same field). ✅ Match is not dissolved — that's correct by accident.** |
| B4 | **Match held** | Auto | Match stays intact, packs don't ship | ⚠️ Pack delivery cron doesn't check billing_paused per family. **❌ Paused families may still get pack-delivery emails.** |
| B5 | **Cancellation** | Manual | Pause offer fires first as retention save | **❌ Pause offer email not sent. ❌ No "intent to cancel" trigger (only post-cancellation webhook).** |
| B5 | **Pause offer** *(template ready)* | Auto-trigger + manual follow-up | 1–3 month pause as alternative | **❌ Not implemented.** |

### 2C. Convergence points

| # | Step | Who | Map says | Status today |
|---|---|---|---|---|
| C1 | **Partner orphaned** *(GAP)* | Manual | Every dissolved match → other child must be re-queued, family told kindly | ⚠️ Only handled in **cancellation** webhook. **❌ NOT handled in rematch closure. ❌ NOT handled in tier-mismatch dissolution.** |
| C2 | **Shared re-queue path** | Auto | Status → unmatched, **21-day clock resets to day 0** (settled policy) | ⚠️ Reset happens in cancellation webhook + PATCH /matches Closed. **❌ Not centralised — three different code paths, easy to drift.** |
| C3 | **Shared offboarding path** | Manual | Cancellation logged with reason code, child status → cancelled, **day-30 win-back email scheduled** | ⚠️ Cancellation table exists. **❌ No day-30 win-back. ❌ Reason code is free-text, not enum.** |
| C4 | **Data deletion (COPPA)** *(GAP)* | Manual | Admin-only hard delete including match history, logged | **❌ Not implemented. DELETE /children/:id exists but doesn't truly remove from match history, and there's no audit log.** |

### 2D. Settled policy decisions (from the map — locked in)

1. **Re-queue clock resets to day 0** for any orphaned child, from any cause.
2. **Ghosting = 2 consecutive monthly pack emails opened by neither** (≈ 45 days). Newsletter opens don't count.

### 2E. Email & physical-mail inventory (per Courtney's confirmed split, May 19 2026)

**Resend — 4 emails, in-app code, edited via new admin "Email Templates" page**

| # | Email | Trigger | From |
|---|---|---|---|
| R1 | **Onboarding nudge** | Onboarding form still incomplete after a few days | Courtney \| MailDay |
| R2 | **Match notification (Poppy)** | Admin clicks "Approve match" — includes one-click address confirm link | Poppy at MailDay |
| R3 | **Guarantee breach** | Child crosses day 21 unmatched; billing auto-pauses | Courtney \| MailDay |
| R4 | **Pause offer** | ReCharge cancellation webhook arrives (VA already processed cancel in ReCharge); starts 48h grace window | Courtney \| MailDay |

**Klaviyo — 9 emails/sequences, edited by Courtney directly in Klaviyo**

| # | Email | Trigger | Outbound event from app? |
|---|---|---|---|
| K1 | Welcome — Day 0 | Shopify "new subscription" event flows to Klaviyo | No — Shopify→Klaviyo direct |
| K2 | First-letter nudge | 14 days after match notification | **Yes — app must emit `match_promoted_to_active`** |
| K3 | Monthly pack — Core | Scheduled 1st of every month | No — Klaviyo-side schedule |
| K4 | Monthly pack — Minis | Scheduled 1st of every month | No |
| K5 | Monthly pack — Homeschool | Scheduled 1st of every month | No |
| K6 | Ghosting win-back sequence (3–4 emails) | 2 consecutive missed pack opens (≈45 days) | No — Klaviyo computes from K3/K4/K5 opens |
| K7 | Day-30 win-back (post-cancel) | 30 days after cancellation confirmed | **Yes — app must emit `family_offboarded`** |
| K8 | Annual upgrade offer | Day 90 for monthly billing members | No — Klaviyo can compute from subscription_start_date |
| K9 | Give a Key sponsor thank-you | Donation processed through DonateMate | **Yes — app must emit `gak_donation_recorded`** |

**Physical mail — 1 piece**

| # | Item | Trigger | Who |
|---|---|---|---|
| P1 | **Poppy win-back card** (handwritten) | Klaviyo K6 win-back sequence ends with no re-engagement | Courtney mails by hand; app creates an Action Items task |

---

## 3. Open questions — RESOLVED by Courtney May 19, 2026

| # | Question | Resolution |
|---|---|---|
| Q1 | **Transactional emails: Resend or Klaviyo?** | **Mixed split confirmed.** 4 in Resend (onboarding nudge, match notification, guarantee breach, pause offer), 9 in Klaviyo (welcome, first-letter nudge, monthly packs ×3, ghosting win-back, day-30 win-back, annual upgrade offer, GAK donor thank-you). See §2E above. |
| Q1a | **How does Courtney edit Resend wording?** | **Build an admin "Email Templates" page** (new section, Phase 2.7). Templates live in DB, edited in MailDay admin, preview button, version-controlled in `audit_log`. Reduces dev tickets to zero for copy changes. |
| Q2 | **Pause offer trigger.** | **Auto-send on ReCharge cancellation webhook + 48h grace.** Important context Courtney clarified: parents cannot self-cancel in ReCharge — they email MailDay and a VA processes it manually. So the webhook fires *after* a human has already touched it; the pause offer is a *second* automated save attempt. |
| Q3 | **Day-30 win-back: app cron or Klaviyo?** | **Klaviyo (K7).** App emits a `family_offboarded` event with offboard date; Klaviyo schedules the send. |
| Q4 | **Address confirmation source.** | **Always require one-click confirmation** by both parents. Shopify address may be old/wrong — child safety issue ("a wrong address means a child's letter goes to a stranger"). Match cannot promote to Active until both confirmations land. Timestamps saved on each. |
| Q5 | **Tier mismatch: auto-dissolve or admin review?** | (No explicit answer — keep default) **Admin review**, never auto-dissolve. |
| Q6 | **Poppy card task ownership.** | (Default kept) New `lifecycle_tasks` table for Poppy cards + address-confirmations + guarantee-breach contacts. |
| Q7 | **Klaviyo at-risk inbound.** | (Default kept) Build inbound webhook `/api/webhooks/klaviyo/at-risk`. Klaviyo can fire webhook actions from flows. |
| Q8 | **Existing audit fixes: before/parallel/after?** | (No explicit answer — keep default) **Before.** Phase 0. |
| Q9 | **Matching stays human.** | **Confirmed.** Every match session is run by Courtney or a VA. Every pair is approved by a human in the app. The match-notification email (R2) only fires *after* that approval click. The email is triggered BY the approval. Nothing about matching becomes automatic. |
| Q10 | **Annual upgrade offer (new requirement, K8).** | Klaviyo-only, day 90 for monthly billing members. Klaviyo can compute from subscription start date. No app changes needed unless we want to suppress sends for already-paused/cancelled families — confirm in Phase 6. |
| Q11 | **DonateMate (new tool surfaced in K9).** | Donations processed through DonateMate. The app's `give_a_key_donations` table already records donations from Shopify and manual entry; need to confirm whether DonateMate writes directly to Klaviyo (no app code) or whether the app must emit `gak_donation_recorded`. **Open — confirm with Courtney during Phase 6.** |

---

## 4. Phased plan

Phases are sequenced for **safety-first, then foundations, then features**. Each phase is independently shippable.

### Phase 0 — Lock the security surface (1 week, ~4 dev days)

Why first: the lifecycle work adds 5–6 new webhook endpoints, 6+ outbound emails, and several public-link confirmation flows. If the existing webhook handlers still accept unsigned messages and the address-change endpoints still trust the email field, the new code inherits the same holes.

| Task | From audit § | Effort |
|---|---|---|
| Make webhook secrets mandatory (Shopify, ReCharge, Klaviyo) | 3.2 | 4 h |
| Require email confirmation before changing addresses in `/enroll` and `/give-a-key/po-box` (reusable pattern we'll need anyway for S7 address-confirmation) | 3.3 | 1.5 d |
| Lock down GAK receipt uploads + private bucket | 3.4 | 1 d |
| Remove or HMAC-protect public affiliate tracker | 3.5 | 4 h |
| `app.set('trust proxy', 1)` for correct rate limiting | 4.6 | 15 min |
| Rate-limit forgot/reset/change password | 4.2 | 4 h |

**Deliverable**: existing audit Critical+Important locks resolved. Project ready for new public-facing flows.

---

### Phase 1 — Foundations (1 week)

Things multiple later phases need. Built once, used many times.

**1.1 Database migrations** (`supabase-migration-lifecycle.sql`)

```
-- New columns
ALTER TABLE matches ADD COLUMN
  address_confirmed_a BOOLEAN DEFAULT FALSE,
  address_confirmed_b BOOLEAN DEFAULT FALSE,
  promoted_to_active_at TIMESTAMPTZ;

ALTER TABLE matches ADD COLUMN close_reason_code TEXT
  CHECK (close_reason_code IN ('rematch_requested','tier_mismatch',
    'cancellation','admin_dissolved','data_deletion'));

ALTER TABLE children ADD COLUMN
  cancelled_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ;

ALTER TABLE parents ADD COLUMN
  pause_type TEXT CHECK (pause_type IN ('voluntary','guarantee')),
  intent_to_cancel_at TIMESTAMPTZ,
  pause_offer_sent_at TIMESTAMPTZ,
  pause_offer_accepted BOOLEAN,
  day30_winback_sent_at TIMESTAMPTZ;

ALTER TABLE cancellations ADD COLUMN reason_code TEXT
  CHECK (reason_code IN ('price','no_letters','wrong_fit','moving',
    'financial_hardship','forgot','seasonal','aged_out','other'));

-- New tables
CREATE TABLE lifecycle_tasks (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL, -- 'send_poppy_card','confirm_addresses','contact_guarantee_breach','review_tier_mismatch'
  title TEXT NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES parents(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  actor_id UUID, -- users.id, or null for system
  actor_email TEXT,
  action TEXT NOT NULL, -- 'child.delete','match.dissolve','parent.address_change', etc.
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  payload_before JSONB,
  payload_after JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE confirmation_tokens (
  token UUID PRIMARY KEY,
  type TEXT NOT NULL, -- 'address_confirm','pause_offer','reactivate'
  parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  payload JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cron lookups
CREATE INDEX idx_matches_pending_address ON matches(match_status, address_confirmed_a, address_confirmed_b)
  WHERE match_status = 'Pending';
```

**1.2 Email-sending service** (`src/lib/email.ts`)

Single function: `sendEmail({ to, templateKey, vars })`. Templates **stored in a new `email_templates` DB table** (not code files) so Courtney can edit them via the admin UI (see Phase 2.7). Uses Resend in prod, logs to console in dev. Each template stores: key, subject, html, text, from-name, from-email, list of expected variables.

The 4 Resend templates seeded at Phase 1:
- `onboarding_nudge` (R1) — Courtney's draft from the lifecycle map
- `match_notification` (R2) — Poppy's draft (includes one-click address-confirm link)
- `guarantee_breach` (R3) — Courtney's draft
- `pause_offer` (R4) — Courtney's draft

(K1–K9 live in Klaviyo. P1 Poppy card is physical mail; no email template, but a `lifecycle_tasks` row.)

**1.2b Klaviyo outbound-events helper** (`src/lib/klaviyo-events.ts`)

Klaviyo flows fire based on profile properties and custom events. Three events the app must emit:
- `emitKlaviyoEvent('match_promoted_to_active', { email, match_id, promoted_at })` — drives K2 first-letter nudge
- `emitKlaviyoEvent('family_offboarded', { email, offboarded_at, reason_code })` — drives K7 day-30 win-back
- `emitKlaviyoEvent('gak_donation_recorded', { donor_email, amount, donation_id })` — drives K9 thank-you (unless DonateMate→Klaviyo direct)

Wraps Klaviyo's POST `/api/events` with the existing `KLAVIYO_API_KEY`.

**1.3 Confirmation-link helper** (`src/lib/confirmation.ts`)

Generic "send the user a one-click link that proves they own this email". Used by:
- Address confirmation (S7)
- Pause-offer accept/decline (B5)
- Reactivation (C3)
- Address-change requests on `/enroll` and `/give-a-key/po-box` (audit 3.3)

Endpoint pattern: `GET /api/confirm/:token` → looks up `confirmation_tokens`, applies the payload, redirects to a result page.

**1.4 Audit-log helper** (`src/lib/audit.ts`)

Single function `logAudit({ actor, action, entity, before, after })`. Wraps the new `audit_log` table. Called from every PATCH/DELETE handler that touches sensitive data.

**1.5 Date-of-birth utilities** (`src/lib/age.ts`)

`computeAge(dob)` and `computeTier(age)`. Replace every read of `children.age` with `computeAge(child.date_of_birth)`. Keep the column for legacy data but stop writing to it.

**Deliverable**: DB migrated, email/confirmation/audit/age helpers landed, no behaviour change yet.

---

### Phase 2 — Complete the Spine (2 weeks, was 1.5 — extended for admin Email-Templates page)

Walk the map left to right, one box at a time.

**2.1 S1 — Welcome email — Klaviyo wiring** (0.5 d)
- Welcome (K1) lives in Klaviyo, triggered by Shopify "new subscription" event flowing to Klaviyo.
- **No app code change** for the email itself. Confirm in Klaviyo: the flow exists, the segment matches all new subscriptions, and the email contains the onboarding form link with the parent's `onboarding_token`.
- App work: ensure Shopify-customer-id is being passed to Klaviyo (so Klaviyo can populate the onboarding link).
- Onboarding link gets a 30-day expiry from `onboarding_token` issue time — closes audit gap 4.7.

**2.2 S2 — Onboarding form fixes** (1 d)
- Always require `date_of_birth`, never accept raw `age`.
- Compute age + tier on read, never store.
- `match_guarantee_start_date` already set — keep.
- Validate token expiry (30 days from issue).

**2.3 S3 — Incomplete-onboarding nudge (R1)** (1 d)
- New cron: daily at 9am MT, find parents whose age in `parents.created_at` > 3 days, no children record, no nudge sent yet → send R1 via Resend.
- After day 7: also create a `lifecycle_tasks` row of type `incomplete_onboarding_followup` so it shows in Action Items.
- Wire this task type into `/api/action-items/count`.

**2.4 S5 — Guarantee breach contact (R3)** (1.5 d)
- When `match_guarantee_start_date` crosses day 21 (same logic that flips billing_paused):
  - Set `parents.pause_type = 'guarantee'` (distinguishes from voluntary)
  - Create `lifecycle_tasks` row of type `contact_guarantee_breach` with the parent + child
  - Make a real ReCharge API call to pause the subscription (or queue it if API fails, with retry)
  - **Auto-send R3** (guarantee breach email) via Resend — Courtney's draft.
- "Mark confirmed" button on the queue card → marks task complete, logs to audit_log.

**2.5 S7 — Address confirmation state + Match notification (R2)** (2.5 d)
- New match state machine: `Pending → Active → Closed/Ended`.
- On `POST /matches` (admin clicks "Approve match" — **always human-driven**), status defaults to `Pending`, not `Active`.
- The moment of approval is the trigger for R2: send the Poppy match-notification email to both parents, each containing a unique one-click "Confirm my mailing address" link.
- Each link uses a `confirmation_tokens` row (24-hour expiry; resend button regenerates).
- When a parent clicks: set `address_confirmed_a` or `_b` on the match, save the timestamp.
- When **both** true: flip match to `Active`, set `promoted_to_active_at`, emit `match_promoted_to_active` to Klaviyo (drives K2 first-letter nudge), log to audit.
- **Pending matches that hit 7 days without both confirmations** → escalate to Action Items as `lifecycle_tasks` type `chase_address_confirmation`.
- Queue dashboard shows a new "Awaiting address confirmation" bucket with last-sent timestamp + resend button.

**2.6 S8 — Day-14 first-letter nudge — Klaviyo wiring** (0.5 d)
- K2 lives in Klaviyo. Triggered by the `match_promoted_to_active` event the app emits in 2.5.
- App work: emit the event with `{ email, match_id, promoted_at, pen_pal_first_name }` so Klaviyo can compose the nudge with the right names.
- Confirm in Klaviyo: 14-day time-delay flow exists, suppression list excludes at-risk and paused families.

**2.7 Admin "Email Templates" page (NEW — for Courtney's editing access)** (2.5 d)
- New admin-only page at `/admin/email-templates`.
- Lists the 4 Resend templates (R1–R4) with subject + body + variable list.
- "Edit" opens an editor: monospaced textarea for body (supports `{{variables}}`), one-line subject, from-name dropdown (Courtney / Poppy).
- "Preview" button: renders the email with sample data in a modal.
- "Save" writes to `email_templates` table + a row to `audit_log`.
- Templates are seeded from the lifecycle-map drafts on first migration so Courtney sees her wording, not placeholder Lorem.

**Deliverable**: a brand-new family travels the entire Spine — Welcome (Klaviyo) → Onboarding → Queue → Match approval → Match notification + address confirm (Resend) → both confirmed → Active → day-14 nudge (Klaviyo) — with **no manual email sends** except the human match-approval click. Courtney can edit any of the 4 Resend emails herself from the admin app.

---

### Phase 3 — Branches (2 weeks)

**3.1 B1 Rematch refinement** (1 d)
- Distinguish "rematch requested" (the asker) from "orphaned partner". New status code on children: `Orphaned`.
- Reason codes for rematch (chat fit, no response, other) — enum, not free text.
- Priority flag on children: `rematch_priority BOOLEAN`. Matching UI sorts these to the top of the next batch.

**3.2 B2 Ghosting at-risk inbound** (2 d)
- New endpoint `POST /api/webhooks/klaviyo/at-risk` — Klaviyo fires when a profile crosses the "2 consecutive missed pack opens" segment.
- Signature-verified (we made secrets mandatory in Phase 0).
- Sets `parents.at_risk = true`. Creates a UI flag.
- Endpoint already exists to clear `at_risk` on open — that part stays.

**3.3 B2 Win-back end-of-sequence Poppy card** (1 d)
- New endpoint `POST /api/webhooks/klaviyo/winback-completed` — Klaviyo fires at the end of the win-back flow for a still-disengaged family.
- Creates `lifecycle_tasks` row of type `send_poppy_card`.
- Surfaces in Action Items as "Mail handwritten Poppy card to [family]".
- "Mark mailed" button → completes task, logs to audit.

**3.4 B2 Win-back fails → offboarding** (0.5 d)
- If 60 days after Poppy card task created, still no engagement → auto-route into Shared offboarding (Phase 4 C3).

**3.5 B3 Tier change propagation + aging** (2 d)
- Shopify webhook tier change → also update `children.tier` for that parent's children.
- New daily cron: find children whose computed age now puts them in a different tier (e.g. Minis → Core). Update `children.tier`.
- Audit-log every change.

**3.6 B3 Mismatch flag** (1 d)
- On any tier change (Shopify webhook OR aging cron), if the child has an Active match where `child_a.tier != child_b.tier` *across the age band*:
  - Create `lifecycle_tasks` row of type `review_tier_mismatch`.
  - Mark the match `tier_mismatch_flagged = true`.
  - Queue/Matches UI shows a flag.
- Admin review UI: "Dissolve match" or "Keep". Dissolving uses the Shared re-queue (Phase 4).

**3.7 B4 Voluntary vs guarantee pause** (1 d)
- ReCharge webhook on PAUSED → set `parents.pause_type = 'voluntary'`.
- Guarantee breach already sets `'guarantee'`.
- All UI labels distinguish.
- Pack-delivery cron skips families with `billing_paused = true` (whichever type).
- Day-14 first-letter nudge and at-risk detection skip `voluntary` paused families.

**3.8 B4 Match held** (0.5 d)
- Confirm match stays Active during voluntary pause (it does — but add a visible "On hold" UI badge).
- On resume (ReCharge webhook ACTIVE again) → packs resume automatically.

**3.9 B5 Pause offer (R4)** (1.5 d)
- Important context: parents cannot self-cancel in ReCharge — they email MailDay, a VA processes cancellation in ReCharge, then the webhook fires. The pause offer is a *second* automated save attempt after the VA has already had a chance to respond personally.
- On ReCharge CANCELLED webhook: instead of immediately marking cancellation final, first:
  - Set `parents.intent_to_cancel_at = now`
  - **Auto-send R4** (pause-offer email) via Resend with two confirmation links: "Pause 1/2/3 months" and "Confirm cancellation"
  - Set `parents.pause_offer_sent_at = now`
- 48 hours later (cron check), if no response → proceed to Shared offboarding (Phase 4 C3).
- If "Pause" clicked → call ReCharge to pause, set `pause_offer_accepted = true`, clear intent_to_cancel, restore subscription locally.
- If "Confirm cancellation" clicked → proceed to Shared offboarding immediately.

**Deliverable**: every branch behaves as the map specifies, with proper distinctions and admin visibility.

---

### Phase 4 — Convergence routines (1 week)

**4.1 C1+C2 Unified re-queue routine** (1.5 d)
- New function `requeueChild(childId, reason)` in `src/lib/lifecycle.ts`:
  - Sets `match_status = 'Unmatched'`
  - Resets `match_guarantee_start_date = today` (settled policy)
  - Clears `billing_paused` if was guarantee-paused
  - Audit-logs the re-queue with reason
  - Returns the child so caller can chain
- Replace inline re-queue logic in three places: cancellation webhook, PATCH /matches Closed, tier-mismatch dissolve.
- Every dissolved match's orphaned partner goes through this routine.

**4.2 C3 Shared offboarding** (1 d)
- New function `offboardFamily(parentId, reasonCode, source)`:
  - Marks all the parent's children `match_status = 'Cancelled'`, `cancelled_at = now`
  - Creates/updates `cancellations` record with structured `reason_code`
  - Re-queues any orphaned partners through `requeueChild`
  - **Emits `family_offboarded` event to Klaviyo** with `{ email, offboarded_at, reason_code, tenure_months }` — this is what drives K7 day-30 win-back from Klaviyo's side.
- No app cron needed for day-30 win-back; Klaviyo handles the delay and send.

**4.3 Update existing callers** (0.5 d)
- Cancellation webhook, PATCH /matches Closed, tier-mismatch dissolve → all call the new shared functions.
- Remove duplicate logic.

**Deliverable**: a single re-queue routine and a single offboarding routine. Every branch funnels through them. Removes drift risk forever.

---

### Phase 5 — COPPA hard delete + audit log surfacing (3 days)

**5.1 Hard delete endpoint** (1.5 d)
- `DELETE /api/parents/:id/coppa-erase` — admin only.
- Cascades through: child records, match history (or anonymises), donations referencing them, lifecycle_tasks, cancellation_tasks, confirmation_tokens.
- Choice: physically delete vs. anonymise match history. **Map says "actually removing the data, including from match history"** → physically delete the matches the child was in (or replace `child_a_id`/`child_b_id` with NULL + soft-delete the row).
- Heavy audit-log entry with operator's email + IP + timestamp.
- 7-day "are you sure" cooldown: first call schedules deletion; admin must confirm again to actually run.

**5.2 Audit-log viewer** (1 d)
- Admin-only page `/audit-log` listing recent entries.
- Filter by entity type, actor, date range.
- Read-only.

**5.3 Wire audit-log calls** (0.5 d)
- Add `logAudit(...)` to: user create/delete/role-change, child create/delete, parent address change, match dissolve, COPPA erase, manual override of guarantee status.

**Deliverable**: COPPA compliance, plus visibility into who did what.

---

### Phase 6 — Klaviyo configuration & end-to-end test (3 days)

This phase is partly configuration in Klaviyo (Courtney owns), partly testing the wiring.

**6.1 Klaviyo flows to set up** (Courtney in Klaviyo UI, not code) (1 d)
- **K1 Welcome** — confirm existing Shopify→Klaviyo "new subscription" flow fires Courtney's draft.
- **K2 First-letter nudge** — flow listens for `match_promoted_to_active` event, waits 14 days, sends.
- **K3/K4/K5 Monthly packs** — scheduled segment sends to active Core / Minis / Homeschool members on the 1st.
- **K6 Ghosting win-back sequence** — segment: "missed 2 consecutive monthly pack opens". Flow:
  1. Fire webhook to `/api/webhooks/klaviyo/at-risk` (app sets `at_risk=true`).
  2. Run 3–4 email Poppy win-back sequence.
  3. On flow completion (still disengaged), fire webhook to `/api/webhooks/klaviyo/winback-completed` (app creates Poppy-card task).
- **K7 Day-30 win-back** — flow listens for `family_offboarded` event, waits 30 days, sends.
- **K8 Annual upgrade offer** — segment: monthly billing members, subscription_start_date 90 days ago.
- **K9 GAK donor thank-you** — flow listens for `gak_donation_recorded` event (or directly from DonateMate, TBC).
- Document each flow's webhook secret in Replit/Klaviyo settings.

**6.2 DonateMate confirmation** (0.5 d) — ✅ **Done 2026-06-07**
- Courtney heard back from DonateMate dev: their tool does NOT currently send donations to Klaviyo, but the dev offered to build it. Courtney asked if the app could just forward instead — yes, simpler that way.
- Wired `emitKlaviyoEvent('gak_donation_recorded', ...)` into both donation entry points:
  - **`routes/give-a-key.ts` line ~705** — manual admin-entered donations (POST `/api/give-a-key/donations`)
  - **`routes/webhooks.ts` line ~525** — Shopify GAK webhook (per-line-item, supports multi-donation orders)
- Event properties sent: `donation_id`, `amount`, `donation_date`, `source` (`manual` | `shopify`), plus `shopify_order_id` when applicable. Profile sent with donor email + first/last name.
- Silent fail per-emit — DB writes already committed, Klaviyo emit logged at WARN level if it fails so it surfaces in logs without breaking the donation flow.
- Typecheck clean. Courtney to tell DonateMate dev "no thanks, we'll handle it."

**6.3 End-to-end test** (1.5 d)
- Test family travels every path: subscribe → onboarding nudge → match → address confirm → first-letter nudge → ghosting → at-risk → win-back → Poppy card → re-engage OR offboard → day-30 win-back.
- Verify every email lands (Resend + Klaviyo).
- Verify every event fires.
- Verify every task surfaces.

**Deliverable**: Klaviyo ↔ app loop closed.

---

### Phase 7 — UI surfacing (1 week)

Every new state needs to be visible in the admin app. Most existing pages already exist — this phase tweaks them.

**7.1 Children Directory** (1 d)
- New status pills: `Pending Address`, `On Hold (voluntary pause)`, `Orphaned`, `Cancelled`.
- Tier-mismatch warning icon if applicable.
- Fix the "matched-but-at-risk" health-bucket bug (audit 4.5) — exclude `Matched` children from `urgent_guarantee`.

**7.2 Action Items page** (1 d)
- New task types from `lifecycle_tasks` show alongside existing GAK + cancellation tasks.
- Each task has a primary action button (Send email / Mark confirmed / Mark mailed / Review pair).

**7.3 Match detail / Queue card** (1 d)
- "Awaiting address confirmation" badge on Pending matches.
- "Send guarantee-breach contact" button on day-21+ Unmatched children.
- "Resend address confirmation email" button on Pending matches.

**7.4 Parent detail page** (0.5 d)
- Lifecycle timeline: subscribed → onboarded → matched → address-confirmed → … 
- Pause-type indicator (voluntary / guarantee).
- "Initiate COPPA erase" button (admin only).

**7.5 Dashboard tiles** (0.5 d)
- New tile: "Pending address confirmation: N".
- New tile: "At-risk families: N".
- New tile: "Poppy cards to mail: N".

**7.6 Audit log page** (already built in 5.2) — wire into Admin nav (1 h).

**Deliverable**: the admin can see and act on every state the lifecycle map names.

#### Progress log — 2026-06-07

App-side work for Phase 7 shipped **ahead of Phase 6** while waiting on Courtney's Klaviyo setup window. All sub-tasks substantially complete:

**Backend** (`api-server`):
- **Fix 7.1 health bug** — `routes/stats.ts` `/health/summary` now skips guarantee-clock calc for `match_status === "Matched"`, so a matched child with stale `match_guarantee_start_date` no longer counts as `childRed`. Closes audit 4.5.
- **New endpoint** — `GET /api/stats/lifecycle-tiles` returns `{ pending_address_confirmation, at_risk_families, poppy_cards_to_mail }` (3 counts in one batched query) — backs the 3 new dashboard tiles.
- **Extended `/children` enrichment** — `routes/children.ts` `/children` and `/children/unmatched` now batch-fetch each child's active/pending match via new `fetchActiveMatchByChildId()` helper (single round-trip, no N+1) and surface `active_match: { id, match_status, tier_mismatch_flagged }`. `parent.pause_type` already passed through via `parents(*)`.
- **New endpoint** — `POST /api/matches/:id/resend-confirmation` — re-fires the R2 address-confirmation email for unconfirmed side(s) on Pending matches. Body `{ sides: "both" | "a" | "b" }` (default = auto, send to unconfirmed only). Audit logs `match.address_confirmation_resent`. Refuses on non-Pending matches.
- **Route ordering fix** — moved `/children/flagged` above `/children/:id` so Express stops matching `"flagged"` as a child UUID (was returning 404 silently on Action Items "Safety Flags" section). Pre-existing bug, fixed in passing.

**Frontend** (`mailday`):
- **7.1 Children directory** — `pages/children.tsx` adds 3 new pills in the Status column:
  - **Pending Address** (blue) when `active_match.match_status === "Pending"`
  - **On Hold** (purple) when `parent.pause_type === "voluntary"`
  - **Tier Mismatch** (amber, ⚠️) when `active_match.tier_mismatch_flagged`
  Each has a hover tooltip explaining the state. Existing guarantee-clock badge unchanged.
- **7.2 Action Items** — `pages/action-items.tsx` adds a `LIFECYCLE_GROUPS` config that renders one `ActionSection` per lifecycle_task type with the right icon/level: **Guarantee Breach Contact** (urgent), **Chase Address Confirmation** (warning), **Tier Mismatch — Review Pair** (warning), **Poppy Cards to Mail** (neutral), **Onboarding Follow-up** (warning), **COPPA Deletion Pending** (neutral). Each task has a primary action button ("Done" / "Mailed") wired to `PATCH /api/lifecycle-tasks/:id/complete`. Total task count contributes to the page header sum.
- **7.3 Match sheet** — `pages/active-matches.tsx`:
  - Header badge: hardcoded "Active" replaced — shows blue **Awaiting Address Confirmation** when `match_status === "Pending"`, green Active otherwise.
  - New blue panel between header and Shared Interests — shows per-side address confirmation status (✓ confirmed / ○ awaiting) for both children, with **Resend to unconfirmed sides** + **Resend to both** buttons. Both wire to the new `/resend-confirmation` endpoint.
  - Queue card (`pages/queue.tsx`): Day-21 urgent kids now show a small amber hint **"Day-21 guarantee breach — outreach automated by daily cron"** so admins know the cron has taken over (no manual button — would duplicate the auto-fired R3 email).
- **7.4 Parent sheet** — `components/parent-sheet.tsx`:
  - Header now shows a pause-type badge next to At Risk: **Voluntary Pause** (purple) or **Guarantee Pause** (amber).
  - New **Lifecycle** section between Notes and Children: timeline of Subscribed → Child added → First match, plus dynamic rows that appear only when relevant (Voluntary/Guarantee pause, At-risk flag, COPPA erase pending/erased) — each colored green/amber/red.
  - New **COPPA Controls** block (admin only): renders one of 4 states — already-erased card, pending-with-cancel card, two-step confirm flow (reason textarea + scary-styled confirm button), or default "Initiate COPPA erase" button. Wires to existing `POST /api/admin/coppa/parents/:id/request` and `/cancel` endpoints. Auto-invalidates action-items + lifecycle-tasks queries on success.
- **7.5 Dashboard** — `pages/dashboard.tsx`:
  - New `LifecycleTiles` query → `/api/stats/lifecycle-tiles`.
  - Added 3 tiles to the "Today's Work" grid: **At-Risk Families** (ShieldAlert, urgent), **Pending Address Confirms** (Mailbox, neutral), **Poppy Cards to Mail** (Send, neutral). Sort order naturally pushes urgent tiles to the front.

**Tests** (Chrome DevTools UI smoke):
- Login as fresh temp admin → dashboard renders with all 3 new tiles showing 0 (no prod data yet).
- Click sidebar → Parents → click Priya Sharma (Paused) → sheet opens with **Lifecycle** section visible (Subscribed: May 14, 2026 · Child added: 1 on file · First match: waiting), **Initiate COPPA erase** button visible.
- Click "Initiate COPPA erase" → confirm flow opens with warning text, reason textarea, **Confirm — start 7-day clock** + **Cancel** buttons. Cancel works.
- Navigate to Action Items → page renders (lifecycle sections don't render because no lifecycle_tasks exist in prod — expected, code is conditional).
- Zero console errors after route-ordering fix (only flagged 404 was `/children/flagged`, now resolved).

**Typecheck**: clean across both packages.

**Production restored**: 4 parents · 6 children · 1 match · 1 admin (`hello@joinmailday.com`). Temp admin deleted. Servers stopped, temp files cleaned.

**Files changed (10)**:
1. `artifacts/api-server/src/routes/stats.ts` — health bug fix + new `/stats/lifecycle-tiles` endpoint
2. `artifacts/api-server/src/routes/children.ts` — added `fetchActiveMatchByChildId()` + enrichment + route order fix
3. `artifacts/api-server/src/routes/matches.ts` — new `/matches/:id/resend-confirmation` endpoint
4. `artifacts/mailday/src/pages/children.tsx` — 3 new status pills
5. `artifacts/mailday/src/pages/action-items.tsx` — lifecycle_tasks sections + complete-mutation
6. `artifacts/mailday/src/pages/dashboard.tsx` — 3 new tiles + lifecycle-tiles query
7. `artifacts/mailday/src/pages/active-matches.tsx` — Pending badge + per-side confirm panel + resend buttons
8. `artifacts/mailday/src/pages/queue.tsx` — Day-21 breach indicator
9. `artifacts/mailday/src/components/parent-sheet.tsx` — pause-type badge + LifecycleTimeline + CoppaControls
10. `IMPLEMENTATION-PLAN.md` — this entry

**What's left in Phase 7**:
- Nothing app-side. All sub-tasks (7.1–7.6) substantively delivered.
- Real-world validation will happen during Phase 6 end-to-end test when synthetic family travels Spine + branches and the new pills/tiles/timeline can be observed populating with live data.

**Phase 7 status**: 🚧 In progress — code complete, awaiting Phase 6 end-to-end test for live validation.

---

## 5. Cross-cutting concerns

- **Migrations**: every phase that touches the DB ships its own `supabase-migration-*.sql`. Each is idempotent and small. Run in order.
- **Feature flags**: each phase guarded by an env-var so we can disable a broken automation in production without redeploying.
- **Manual override**: every automated action that changes state should also be triggerable manually by admin (and reversible). Map repeatedly says "Courtney always handles X personally" — the automation is the safety net, not the only path.
- **Test coverage**: minimal automated tests for: re-queue routine, offboard routine, tier-mismatch detection, address-confirmation token flow. These are the "if this breaks, customer-visible bad thing happens" surfaces.
- **Documentation**: each phase updates `replit.md` with the new env vars, cron schedules, and webhook URLs.

---

## 6. Phase summary (updated 2026-05-19)

| Phase | Status | Weeks | Deliverable |
|---|---|---|---|
| 0 — Lock security surface | ✅ Done 2026-05-19 (code shipped; awaits env-var check + bucket flip) | 1 | Audit Critical+Important items fixed; ready for new public flows |
| 1 — Foundations (DB + helpers + email service + Klaviyo events) | ✅ Done 2026-05-19; **migration applied to prod 2026-06-02** | 1 | DB migrated; email/confirmation/audit/age + Klaviyo-events helpers live |
| 2 — Spine completion (incl. admin Email Templates page) | ✅ Done 2026-06-03 (all 6 blocks A–F) | 2 | New family travels the full Spine automatically; Courtney can edit Resend copy herself |
| 3 — Branches | ✅ Done 2026-06-03 (all 9 sub-blocks) | 2 | Every branch behaves per the map |
| 4 — Convergence routines | ✅ Done 2026-06-03 | 1 | Shared re-queue + offboarding routines, drift-free; `family_offboarded` event drives K7 |
| 5 — COPPA + audit log | ✅ Done 2026-06-07 | 0.5 | Hard delete + audit viewer |
| 6 — Klaviyo glue + end-to-end test | 🔄 NEXT | 0.5 | All 9 Klaviyo flows wired + tested |
| 7 — UI surfacing | 🚧 In progress (started 2026-06-07, app-side work done ahead of Phase 6 wait) | 1 | Every new state visible and actionable |
| **Total** | **6/8 done + 1 in progress** | **~9 weeks** | **Lifecycle map fully implemented + audit cleared + self-service email editing** |

---

## 7. Out of scope (deliberately)

To keep this plan honest: these items came up while reading the map but are **not** covered above. Flag if any should be added.

- **Migrating to a real test/staging Supabase project** — the audit recommended this; everything above is built against production-style data. (Suggested before Phase 0.)
- **Two-factor auth** — recommended in audit but not in the lifecycle map. Could fold into Phase 0 or punt.
- **Pagination on tables** — large tables (Cancellations, Children) need this once row counts grow. Not blocking the lifecycle work.
- **Automated test suite beyond the "if this breaks" surfaces** — full coverage is great but a separate workstream.
- **Privacy policy refresh** — legal, not engineering. Worth doing in parallel with Phase 5.

---

*Plan version 1.0 — May 19, 2026 — based on lifecycle map dated May 2026 and audit report May 19, 2026.*
