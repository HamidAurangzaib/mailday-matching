# Klaviyo Setup — Step-by-Step Guide

**For:** Courtney
**From:** Hamid
**Estimated time:** Two evenings, ~2 hours each
**You'll need:** Logged in to Klaviyo as admin

---

## What we're doing & why

Klaviyo is the part of your stack that sends the **9 lifecycle emails** to families. The app already does its half of the work — it watches what's happening in the business (a family subscribes, two kids get matched, a parent cancels, etc.) and rings a "doorbell" each time something important happens.

Your job in these two evenings is to set up Klaviyo to **listen for those doorbells and send the right email when one rings**.

Think of the app as a **smoke alarm** and Klaviyo as the **fire-station phone tree** — the app knows when something's happening, Klaviyo knows what message to send to whom and when.

---

## Quick concepts (one minute)

Three things you'll see in Klaviyo over and over:

- **Metric** — Klaviyo's word for one of the "doorbells" the app rings. Each metric has a name like `Match Promoted To Active` (these are the exact names the app uses — case matters).
- **Flow** — a little recipe: *when X happens, wait Y days, send Z email*. You build one flow per email below.
- **Profile properties** — extra info that comes with each doorbell ring (the parent's first name, their child's name, etc.). You drop these into your email using `{{ event.child_first_name }}` style placeholders.

If a metric name doesn't appear in Klaviyo's search yet, **don't panic** — it only appears after the app has fired that event for the first time. You can still build the flow, just type the metric name exactly and Klaviyo will save it.

---

## Evening 1 — The everyday flows (K1 to K5)

These are the ones every active family experiences. Get these right first.

### ☐ K1 — Welcome (Day 0)

**What it does:** First email a brand-new family gets, with the link to add their child's profile.
**Trigger:** When someone subscribes via Shopify.
**Where this fires from:** The app rings the doorbell `family_subscribed` the moment Shopify tells us a new subscription started.

**In Klaviyo:**
1. Flows → Create Flow → "Create from Scratch"
2. Name: `K1 — Welcome (Day 0)`
3. Trigger: **Metric → search for `family_subscribed`**
4. No wait — send immediately
5. Add Email block → paste your welcome copy
6. Personalization to use in the email:
   - `{{ person.first_name }}` — parent's first name
   - `{{ event.onboarding_url }}` — **important** — the unique link to add their child's info. This is what makes the welcome email useful, so don't forget to put it on the big button.
   - `{{ event.tier }}` — Core / Minis / Homeschool Core etc.
   - `{{ event.billing_type }}` — Monthly / Annual
7. Set status to **Live**

> **Note:** Klaviyo's built-in Shopify integration may also fire a "Started Subscription" event from Shopify directly. You can use that instead of `family_subscribed` if you prefer, but you'll lose the personalized `onboarding_url` — the app generates that.

---

### ☐ K2 — First-letter nudge (Day 14)

**What it does:** Two weeks after pen pals are matched (and both addresses confirmed), gently nudge the family in case they haven't written their first letter yet.
**Trigger:** App rings `match_promoted_to_active` once both parents confirm addresses.

**In Klaviyo:**
1. Flows → Create Flow → "Create from Scratch"
2. Name: `K2 — First-letter nudge (Day 14)`
3. Trigger: **Metric → `match_promoted_to_active`**
4. Add a **Time Delay** block: **14 days**
5. Add Email block → paste your nudge copy
6. Personalization:
   - `{{ person.first_name }}` — parent's first name
   - `{{ event.child_first_name }}` — their child's name
   - `{{ event.pen_pal_first_name }}` — the pen pal's name
7. Status: **Live**

---

### ☐ K3 — Monthly pack: Core

**What it does:** Heads-up that this month's pack is on its way.
**Trigger:** Scheduled — 1st of every month.

**In Klaviyo:**
1. Lists & Segments → Create Segment
   - Name: `Core members — active`
   - Condition: `membership_tier` equals `Core` AND `subscription_status` equals `Active`
2. Campaigns → Create Campaign → Email
3. Name: `K3 — Monthly pack — Core`
4. Recipients: the `Core members — active` segment
5. Schedule: monthly recurring on the 1st
6. Paste copy + schedule. Status: **Live**

---

### ☐ K4 — Monthly pack: Minis

Same as K3 but for the segment:
- Name: `Minis members — active`
- Condition: `membership_tier` equals `Minis` OR `Homeschool Minis` AND `subscription_status` equals `Active`

---

### ☐ K5 — Monthly pack: Homeschool

Same as K3 but for the segment:
- Name: `Homeschool members — active`
- Condition: `membership_tier` equals `Homeschool Core` OR `Homeschool Minis` AND `subscription_status` equals `Active`

> **Tip:** Save K3 first, then "duplicate" it for K4 and K5 — Klaviyo lets you copy a campaign and just swap the segment. Saves 20 minutes.

**End of Evening 1.** Save your progress. The 5 flows above are the heart of the system — if you stop here, the app's email game is already in much better shape than today.

---

## Evening 2 — The rescue + special flows (K6 to K9) + the two webhooks

These handle the harder cases (a family going quiet, a cancellation, donations).

### ☐ K6 — Ghosting win-back sequence (3–4 emails)

**What it does:** When a family stops opening their monthly pack emails for a couple of months, send them a short series of "are you still with us?" emails. If those don't work, send a **handwritten Poppy card** by hand.

**The chain:**
1. **Segment:** "Hasn't opened K3/K4/K5 in 45 days"
   - Lists & Segments → Create Segment
   - Condition: `Has not opened Email` for any of `K3/K4/K5` in the last 45 days, AND `subscription_status` equals `Active`
2. **Flow:** triggered by segment membership
   - Name: `K6 — Ghosting win-back`
   - Trigger: **When someone enters the segment above**
   - **Step 1 — Webhook action:** POST to `https://[your-app-url]/api/webhooks/klaviyo/at-risk`
     - This tells the app the family is going quiet so it flags them as "At Risk" inside the admin tool.
   - **Step 2 — Email 1:** "We miss you" — wait 0 days
   - **Step 3 — Wait 4 days**
   - **Step 4 — Email 2:** "Here's what's coming this month"
   - **Step 5 — Wait 4 days**
   - **Step 6 — Email 3:** "One last note"
   - **Step 7 — Webhook action:** POST to `https://[your-app-url]/api/webhooks/klaviyo/winback-completed`
     - This tells the app *"the email series finished and they still haven't re-engaged"*. The app then creates a Poppy-card task in your Action Items so you know to write them a handwritten card.

> **For the webhook URLs** above — Hamid will send you the actual URL + a small "secret" string that needs to go in a header called `X-MailDay-Secret`. This stops random people on the internet from poking at your app.

### ☐ K7 — Day-30 win-back (post-cancel)

**What it does:** 30 days after a family cancels, send one last "we'd love to have you back" email with maybe a small offer.
**Trigger:** App rings `family_offboarded` when a cancellation has been fully processed (after the 48-hour grace period).

**In Klaviyo:**
1. Flows → Create Flow → "Create from Scratch"
2. Name: `K7 — Day-30 win-back`
3. Trigger: **Metric → `family_offboarded`**
4. Add a **Time Delay** block: **30 days**
5. Add Email block → paste your copy
6. Personalization:
   - `{{ person.first_name }}` — parent's first name
   - `{{ event.reason }}` — the reason they cancelled (you can use this to branch — for example, skip if `reason` is "moved to digital only")
7. Status: **Live**

---

### ☐ K8 — Annual upgrade offer

**What it does:** At day 90 of monthly billing, offer to switch them to annual (often with a small bonus).
**Trigger:** Segment based on subscription age. No app involvement.

**In Klaviyo:**
1. Lists & Segments → Create Segment
   - Name: `Monthly members at day 90`
   - Conditions:
     - `billing_type` equals `Monthly`
     - `subscription_status` equals `Active`
     - `subscription_start_date` was *exactly* 90 days ago (use Klaviyo's "Date is X days ago" condition)
2. Campaigns → Create Campaign → Email
3. Name: `K8 — Annual upgrade offer`
4. Send daily to anyone newly matching the segment (Klaviyo can do this — "Smart Sending" / "Send to new members of segment").
5. Status: **Live**

---

### ☐ K9 — Give a Key donor thank-you

**What it does:** Thanks someone for donating to the Give-a-Key fund.
**Trigger:** A donation gets recorded. **(See note below — we're waiting on DonateMate's answer before deciding.)**

**Two possible setups — Hamid will confirm which one before you build this:**

- **Option A (if DonateMate sends donations to Klaviyo directly):**
  Klaviyo will receive a metric from DonateMate (probably called something like `Donation Received`). Build the flow with that metric as the trigger.

- **Option B (if the app needs to send the doorbell):**
  Trigger: Metric → `gak_donation_recorded`
  Personalization available:
  - `{{ person.first_name }}` — donor's first name
  - `{{ event.amount }}` — donation amount
  - `{{ event.donation_id }}` — reference number

> **Don't build K9 yet** — wait for Hamid's note on the DonateMate question. Should arrive in the next few days.

---

## ☐ Webhook secrets — one-time setup

The two webhooks K6 fires into the app (`/at-risk` and `/winback-completed`) need a shared secret so the app knows the request really came from your Klaviyo, not from someone pretending.

**Hamid will send you:**
1. The actual webhook URLs (full https addresses)
2. The exact secret string to paste into each Klaviyo webhook action under the header `X-MailDay-Secret`

Just paste them into the two Webhook actions in the K6 flow — that's it.

---

## ☐ Test mode — before going Live

Klaviyo lets you test any flow by clicking **"Preview" → "Send to me"** with a fake event. For each flow you built:

1. Click into the flow
2. Hit **"Preview"** on the email block
3. Send a test to your own email
4. Open it on your phone — does the personalization look right? (No empty `{{ }}` placeholders showing through?)
5. If yes → flip flow to **Live**

**Most common gotcha:** an empty `{{ event.child_first_name }}` showing through means either (a) the event doesn't carry that property (check above — I've listed every variable available per flow), or (b) you typed the variable name slightly differently. Klaviyo's variable picker has them all — use the dropdown rather than typing freehand.

---

## ☐ When you're done — quick checklist

- [ ] K1 Welcome — Live
- [ ] K2 First-letter nudge — Live
- [ ] K3 Monthly pack Core — Scheduled
- [ ] K4 Monthly pack Minis — Scheduled
- [ ] K5 Monthly pack Homeschool — Scheduled
- [ ] K6 Ghosting win-back — Live (including both webhook actions)
- [ ] K7 Day-30 win-back — Live
- [ ] K8 Annual upgrade — Live
- [ ] K9 Donor thank-you — Live *(after Hamid confirms DonateMate path)*

Once they're all ticked, message Hamid — he'll run an end-to-end test with a synthetic family to confirm every email lands in the right inbox at the right time.

---

## Stuck?

Three best ways to unstick yourself:

1. **Klaviyo's metric search not showing the name?** That's fine — it only appears after the first real event. Type it exactly and save.
2. **Variable showing as empty `{{ }}`?** Use Klaviyo's variable dropdown instead of typing — it lists everything available.
3. **Anything weirder than that** — text Hamid. He can screen-share within a few hours.

You don't need to do all of this in one go — pause whenever, the flows you've saved as **Live** will start working straight away, and the unfinished ones just won't fire yet.

Good luck — and thank you for taking this on!
