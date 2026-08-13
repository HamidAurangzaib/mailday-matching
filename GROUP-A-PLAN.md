# Group A — Implementation Plan

**Source:** Courtney's "Development Work List" (Aug 2026), Group A — *"needed before matching can go live."*
**Status:** Order placed. In progress.
**Goal:** Nothing in this group is optional — until all six are built **and tested**, matching stays off and no address moves between families.

---

## Cross-cutting decisions (apply across all items)

1. **Matching stays behind a kill-switch until Group A is tested.** A `MATCHING_ENABLED` env flag (default off) gates the "create match" path, so consent enforcement is provably in place before any real address can be released.
2. **Pausing is built on a `pause_reasons` LIST from day one** (the Group C / C4 model), even though A4 is the only writer for now. This means the later cancellation/rematch work slots on top with **zero rework**. Billing resumes only when the list is empty.
3. **Consent + attestation records are append-only and versioned** — every legal record stores *what exact wording* was shown and *when*, so it's defensible later.
4. **Reuse what exists.** The confirmation-token system, the two-sided match-confirm flow, the 24h-expiry address-change flow, and the guardian-attestation pattern (already shipped) are the foundation — we extend, not rebuild.

---

## Build order (dependency-driven)

| # | Item | Why here | Est. |
|---|---|---|---|
| 1 | **A2** — names out of the AI | Independent, trivial, attorney-required. Clean first win. | ~0.5 d |
| 2 | **A5** — bot protection | Independent. Needs Cloudflare Turnstile keys (Hamid/Courtney). | ~1 d |
| 3 | **A1** — address-change verify | Mostly built; finish the admin view + coverage. | ~0.5–1 d |
| 4 | **A3 + A4** — two-party consent | The big coupled piece. Needs the address-form decision below. | ~5–6 d |
| 5 | **A6** — Give-a-Key awaiting-address | Shares the onboarding form + matching-pool exclusion with A4. | ~1.5 d |

**Total: ~9–10 days.** A4 is the bulk.

---

## ⚠️ One decision needed from Courtney before A4/A6

**Where does a Shopify family confirm their address + type + the sharing checkbox?**

The token-based **onboarding form** (what Shopify families actually use) collects *no address* — the address comes from the Shopify checkout. But A4 wants the address type + the "I'm comfortable sharing this" checkbox chosen *at onboarding*, and A6 wants a 4th "PO Box via Give-a-Key" option there.

**Recommendation:** add an **Address section to the onboarding form** that shows the address already on file from checkout, lets the parent confirm it / pick the type (Home / Work / PO Box / setting-up-via-GAK), and check the sharing box. This makes "address type chosen at onboarding, not match time" true for Shopify families, and it's where A4-step-3, A4-step-8, and A6 all naturally live.

*Building A2 / A5 / A1 does not depend on this — those proceed now.*

---

## A2 — Keep children's real names away from the AI  *(attorney-required)*

**Now:** `matching.ts` `childrenForClaude` sends `name: child_first_name` (real names) to Anthropic. Results map back by **UUID id**, never by name.

**Build:**
- Replace each child's real name with an opaque per-run code (`CHILD_1`, `CHILD_2`, …). Send only the code + age + interests + state — never the name.
- Keep a `code → id` map for the run; translate Claude's suggestions (codes) back to real child ids internally.
- Real names never leave our system.

**Also:** report the Anthropic API data-retention posture for Courtney's privacy policy (API inputs are **not** used for training; default retention is limited and zero-data-retention can be requested).

**Test:** run the matcher with the emit intercepted; assert the outbound payload contains no `child_first_name` and only `CHILD_n` codes; assert suggestions still resolve to the right children.

---

## A5 — Human/bot verification on the three public forms  *(attorney-required)*

**Now:** `/api/enroll`, `/api/onboarding/:token/child` (+ `/attestation`), `/api/give-a-key/apply` have **no** CAPTCHA, rate-limit, or honeypot. `helmet` + `express-rate-limit` are already installed (used only on `/auth`).

**Build (recommend Cloudflare Turnstile):** free, privacy-first (no Google cookies), invisible for most users.
- Add the Turnstile widget to the three forms; send its token with each submit.
- **Server-side verify** each token against Turnstile's siteverify before processing (a browser-only check is bypassable).
- Add a per-IP rate-limit on the three endpoints as defence-in-depth.

**Dependency:** a Cloudflare Turnstile site key (public) + secret key (server). Set `TURNSTILE_SECRET_KEY` in Replit.
**Why Turnstile over reCAPTCHA/hCaptcha:** free at any volume, no Google tracking (better for a children's brand), minimal user friction.

**Test:** submit each form with a missing/invalid token → rejected server-side; with a valid token → accepted.

---

## A1 — Address changes verified by email  *(attorney-required — mostly built)*

**Already there:** enroll + Give-a-Key address changes save the new address in a `confirmation_tokens.payload`, email an `address_change_confirm` link to the on-file address, apply only on click, expire in **24h**. That already means only the real parent's inbox can approve a change.

**Remaining:**
- **Admin "Pending address changes" view** — a screen listing outstanding `address_change` tokens (who, old→new address, requested-at, expires-at). New read endpoint + a small page/section.
- **Coverage audit:** confirm *every* public address-change path routes through the pending+confirm flow (enroll ✓, GAK ✓); the admin `PATCH /parents/:id` direct edit stays (admin-only, intended).
- Confirm the confirmation email shows the **new address** (so a parent notices an unwanted redirect) — verify wording matches Courtney's exact copy.

**Deliverable Courtney needs in writing:** a short "deployed and tested" confirmation for her attorney once this is live.

**Test:** request a change → address unchanged until click; click within 24h → applied; let it expire → rejected; the pending change appears in the admin view.

---

## A3 + A4 — Two-party consent before any address is released  *(attorney-required — the big one)*

**Now:** a match is created `Pending`; both parents click a `match_notification` link that sets `address_confirmed_a/b`; when both are true it promotes to `Active`. It's an *address confirmation*, not a *consent to share*.

### A3 — the match email becomes a consent screen
- Rework `match_notification` wording to the consent language (Courtney's exact copy), show the **parent's full address on file** above the button, change the button to **"I consent to share my mailing address with {{penpal_first_name}}'s family,"** update the sub-line, and **remove** the "address appears the second you do" line.
- **Consent record** (new `match_consents` table): match_id, parent_id, child_id, `consented_at`, the exact button text shown (incl. pen-pal name), version. Surface it in the app on the match.

### A4 — the workflow
- **Both sides required.** Release addresses only when *both* parents consent; if one consents, release nothing. Admin sees each side's consent status.
- **Onboarding address section** (see the decision above): show on-file address, pick type, **required sharing checkbox** (save timestamp on parent).
- **Reminders + timeout cron** (extend the existing chase-address job):
  - 48h no response → Reminder 1 (Poppy).
  - Day 7 → Reminder 2 (MailDay).
  - Day 14 → treat as decline: **pause** the silent child (add `address_consent` to `pause_reasons`, pause ReCharge), set the **partner** back to matchable + into the pool, send the pause email + the partner "didn't work out" email, notify admin. No manual steps.
- **Active decline at match time** → cancel that child's ReCharge sub, set child inactive, partner back to matchable immediately (no rematch-consent needed — no letters exchanged), send the decline + partner emails, notify admin.
- **New email templates (5):** reminder-1 (day 2, Poppy), reminder-2 (day 7), address-consent pause (day 14), decline-confirmation, "match didn't work out" (partner). All from Courtney's exact copy.
- **Data model:** `match_consents` table; `children.pause_reasons` (text[]); `children` gains `matchable` semantics (or a status), `parents.address_share_ack_at`.

**Test:** one-side-only consent releases nothing; both consent → promote; no-response at 48h/7d/14d fires each email + the day-14 pause+requeue; active decline cancels + requeues partner; consent records show in the app; addresses never appear in any email.

---

## A6 — Give-a-Key families have no address yet  *(new, from Courtney)*

**Build:**
- 4th address-type option at onboarding: **"I'm setting up a PO Box through Give a Key."**
- If chosen, allow submit with no address; set child status **`awaiting_address`** (new). This child **must not** enter the matching pool (matching already skips paused children — add this status to the exclusion).
- When the Give-a-Key receipt is approved **and** a PO Box address is added, flip the child to matchable automatically. *(Confirmed: today's GAK receipt approval does NOT push the address onto the child — this link must be built.)*
- 30 days with no address → create an Action Item (do not cancel).

**Test:** GAK onboarding submits with no address → `awaiting_address`, excluded from pool; approve receipt + add address → becomes matchable; 30-day timer → Action Item.

---

## New/changed data model (summary)

- `match_consents` table (A3/A4) — the legal consent record.
- `children.pause_reasons` text[] (A4, C-ready).
- `children` `awaiting_address` status (A6).
- `parents.address_share_ack_at` timestamptz (A4 onboarding checkbox).
- *(Already shipped: `parents.guardian_attestation_at/_version` — D1 standalone.)*

## Env / external dependencies

- `MATCHING_ENABLED` flag (kill-switch).
- `TURNSTILE_SECRET_KEY` + site key (A5) — needs a Cloudflare account.

## Deliverables for Courtney's attorney

- Written "deployed + tested" confirmation for **A1** and for the **A3/A4 consent flow**.
