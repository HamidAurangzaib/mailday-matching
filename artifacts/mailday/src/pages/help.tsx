import { useState } from "react";
import {
  Home, Activity, Users, History, AlertTriangle, UserPlus, ShieldCheck,
  BarChart2, LayoutDashboard, ListChecks, ClipboardList, Clock, Receipt,
  DollarSign, BookOpen, ChevronDown, ChevronRight, Mail, Sparkles,
  AlertCircle, CheckCircle2, ArrowRight, Globe, Star, Info,
  Package, TrendingUp, Settings,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Section {
  id: string;
  icon: React.ElementType;
  color: string;
  title: string;
  badge?: string;
  content: React.ReactNode;
}

function AccordionItem({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);
  const Icon = section.icon;
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-5 py-4 bg-card hover:bg-muted/30 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className={`p-2 rounded-lg ${section.color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="font-heading font-bold text-base flex-1">{section.title}</span>
        {section.badge && (
          <Badge variant="secondary" className="text-[10px] mr-2">{section.badge}</Badge>
        )}
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="bg-card border-t border-border px-5 py-5 text-sm text-foreground space-y-4">
          {section.content}
        </div>
      )}
    </div>
  );
}

function Flow({ steps }: { steps: { label: string; sub?: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 my-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="bg-primary/10 border border-primary/20 rounded-lg px-3 py-1.5 text-xs font-medium text-primary leading-tight">
            <div>{s.label}</div>
            {s.sub && <div className="text-primary/60 font-normal">{s.sub}</div>}
          </div>
          {i < steps.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        </div>
      ))}
    </div>
  );
}

function Tip({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "warn" | "good" }) {
  const styles = {
    info:  { bg: "bg-blue-50 border-blue-200",  icon: Info,         ic: "text-blue-500",  text: "text-blue-800" },
    warn:  { bg: "bg-amber-50 border-amber-200", icon: AlertCircle,  ic: "text-amber-500", text: "text-amber-800" },
    good:  { bg: "bg-green-50 border-green-200", icon: CheckCircle2, ic: "text-green-500", text: "text-green-800" },
  }[type];
  const TipIcon = styles.icon;
  return (
    <div className={`flex gap-2.5 p-3 rounded-lg border ${styles.bg}`}>
      <TipIcon className={`w-4 h-4 mt-0.5 shrink-0 ${styles.ic}`} />
      <p className={`text-xs leading-relaxed ${styles.text}`}>{children}</p>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="font-heading font-bold text-sm mt-3 mb-1 text-foreground">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>;
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
      <span className="text-primary mt-0.5 shrink-0">·</span>
      <span>{children}</span>
    </li>
  );
}

const sections: Section[] = [
  {
    id: "overview",
    icon: BookOpen,
    color: "bg-primary/10 text-primary",
    title: "Platform Overview",
    content: (
      <div className="space-y-4">
        <P>
          MailDay Matching is your internal admin hub for managing a pen pal membership business.
          Matching, subscriber management, scholarships, influencer partnerships, and monthly pack
          delivery tracking all live here.
        </P>
        <H>Two Roles</H>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/40">
                <th className="text-left p-2 font-semibold">Feature</th>
                <th className="text-center p-2 font-semibold">Admin</th>
                <th className="text-center p-2 font-semibold">VA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["Dashboard", true, true],
                ["Action Items", true, true],
                ["Unmatched Queue", true, true],
                ["Match History", true, true],
                ["Children Directory", true, true],
                ["Parents Directory", true, true],
                ["Give A Key — Applications, Waitlist", true, true],
                ["Pack Delivery Tracker", true, true],
                ["Team Performance", true, true],
                ["Match Session (AI matching)", true, false],
                ["Incomplete Onboarding", true, false],
                ["Give A Key — Receipts, Donations, Dashboard", true, false],
                ["Influencer Tracker", true, false],
                ["Cancellation Tracker", true, false],
                ["User Management", true, false],
              ].map(([feat, admin, va]) => (
                <tr key={String(feat)} className="hover:bg-muted/20">
                  <td className="p-2 text-muted-foreground">{String(feat)}</td>
                  <td className="p-2 text-center">{admin ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 inline" /> : <span className="text-muted-foreground/40">—</span>}</td>
                  <td className="p-2 text-center">{va ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 inline" /> : <span className="text-muted-foreground/40">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <H>The Two Member Programs</H>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          <div className="border border-border rounded-lg p-3">
            <div className="font-semibold text-sm mb-1 flex items-center gap-1.5"><Star className="w-3.5 h-3.5 text-amber-500" /> Paid Subscribers</div>
            <p className="text-xs text-muted-foreground">Families sign up via the public <strong>Enroll</strong> page, pay through ReCharge, and enter the matching queue. Data syncs automatically every hour.</p>
          </div>
          <div className="border border-border rounded-lg p-3">
            <div className="font-semibold text-sm mb-1 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-primary" /> Give A Key</div>
            <p className="text-xs text-muted-foreground">Scholarship program for families who can't afford a subscription. Funded by donations. You cover their USPS PO Box cost so they can receive letters.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "daily",
    icon: Home,
    color: "bg-amber-100 text-amber-700",
    title: "Daily Workflow — Where to Start Every Morning",
    badge: "Start here",
    content: (
      <div className="space-y-4">
        <P>Open the <strong>Dashboard</strong> first thing each day. The "Today's Work" panel at the top tells you exactly what needs attention.</P>
        <div className="space-y-2">
          {[
            { n: "1", label: "Check Today's Work", sub: "Dashboard → top panel. Urgent guarantees, open action items, pending Give A Key applications, receipts, and unresolved pack delivery issues all surface here — click any tile to jump there." },
            { n: "2", label: "Clear Action Items", sub: "Action Items page — auto-generated tasks, process top to bottom." },
            { n: "3", label: "Review the Unmatched Queue", sub: "Check who has been waiting the longest. Red = billing paused, match them today. Amber = approaching 21-day limit." },
            { n: "4", label: "Run a Match Session", sub: "Admin only. AI generates pen pal pairings for everyone waiting — review and approve or reject each suggestion." },
            { n: "5", label: "Handle Receipts & Applications", sub: "Admin only. Verify Give A Key PO Box receipts and review new scholarship applications." },
          ].map((s) => (
            <div key={s.n} className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{s.n}</div>
              <div>
                <div className="text-sm font-semibold">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
        <H>Monthly Checklist (1st of the month)</H>
        <div className="space-y-2">
          {[
            { n: "1", label: "Confirm Pack Delivery", sub: "Operations → Pack Delivery Tracker. A new entry is auto-created on the 1st. Update email sent/failed counts once Klaviyo sends the delivery batch, then mark it Confirmed." },
            { n: "2", label: "Resolve any delivery failures", sub: "Log any members whose delivery email bounced or failed. Manually resend and mark failures resolved." },
            { n: "3", label: "Check commission due", sub: "Admin only. Growth → Influencer Tracker → Commission Due view. Pay any partners with a balance and mark it paid." },
          ].map((s) => (
            <div key={s.n} className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{s.n}</div>
              <div>
                <div className="text-sm font-semibold">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
        <Tip type="good">If Today's Work shows "All clear," everything's on track. Move on to proactive matching and queue review.</Tip>
      </div>
    ),
  },
  {
    id: "dashboard",
    icon: Home,
    color: "bg-sky-100 text-sky-700",
    title: "Dashboard  ·  /",
    content: (
      <div className="space-y-3">
        <P>Your daily command center. Five sections at a glance:</P>
        <ul className="space-y-2 ml-1">
          <Li><strong>Today's Work</strong> — Urgent tasks, open action items, pack delivery issues, pending Give A Key applications, and receipts to verify. Sorted by urgency, all linked.</Li>
          <Li><strong>Revenue</strong> — MRR, ARR, total subscribers, and new subscribers in the last 7 days.</Li>
          <Li><strong>Matching</strong> — Unmatched children, active matches, and guarantee status.</Li>
          <Li><strong>Growth</strong> (admin only) — Active influencer partners, conversions this month, and total commission owed across all influencers. Commission Owed card goes amber when there's a balance due.</Li>
          <Li><strong>Activity Feed & Subscribers by Tier</strong> — Live match log and subscriber breakdown by tier and billing type.</Li>
        </ul>
        <Tip type="warn">
          <strong>Urgent Guarantees</strong> mean a child has been unmatched for 21+ days and billing is automatically paused — match them immediately.{" "}
          <strong>Pack Delivery Issues</strong> in Today's Work means there are unresolved delivery failures for the current month.
        </Tip>
      </div>
    ),
  },
  {
    id: "queue",
    icon: Activity,
    color: "bg-orange-100 text-orange-700",
    title: "Unmatched Queue  ·  /queue",
    content: (
      <div className="space-y-3">
        <P>Every child who needs a pen pal lives here, sorted by how long they've been waiting. This is your matching priority list.</P>
        <ul className="space-y-2 ml-1">
          <Li>Children are grouped by tier (Core, Minis, Homeschool). Colors indicate urgency: <span className="text-destructive font-medium">red = billing paused</span>, <span className="text-amber-600 font-medium">amber = approaching limit</span>.</Li>
          <Li>Click any child to open their profile sheet — view their interests, age, mailing address, and match history.</Li>
          <Li>From the profile sheet you can also open their parent's record or trigger a match session for that child specifically.</Li>
        </ul>
        <Tip>The queue auto-refreshes. After completing a Match Session, return here to confirm the queue has shrunk.</Tip>
      </div>
    ),
  },
  {
    id: "matching",
    icon: Sparkles,
    color: "bg-purple-100 text-purple-700",
    title: "Match Session  ·  /matching  (Admin only)",
    content: (
      <div className="space-y-3">
        <P>The AI matching engine. It reads every unmatched child's profile and suggests compatible pen pal pairs based on age, interests, and tier.</P>
        <H>How a Match Session Works</H>
        <Flow steps={[
          { label: "Start Session" },
          { label: "AI generates pairs", sub: "reads all profiles" },
          { label: "Review each suggestion", sub: "accept or reject" },
          { label: "Confirm matches", sub: "both families notified" },
        ]} />
        <ul className="space-y-2 ml-1">
          <Li>Each suggestion shows the two children's names, ages, shared interests, and the AI's reasoning.</Li>
          <Li><strong>Accept</strong> to create the match and move both children to "Matched" status.</Li>
          <Li><strong>Reject</strong> to skip the pairing — the AI will suggest someone else next session.</Li>
          <Li>Run sessions as often as needed — typically daily or every other day.</Li>
        </ul>
        <Tip type="warn">Accepted matches are permanent until you close them in Match History. Double-check age and tier compatibility before accepting.</Tip>
      </div>
    ),
  },
  {
    id: "history",
    icon: History,
    color: "bg-slate-100 text-slate-700",
    title: "Match History  ·  /history",
    content: (
      <div className="space-y-3">
        <P>Archive of every match ever made — both active and closed. Use this to look up past pairings or to officially end a match.</P>
        <ul className="space-y-2 ml-1">
          <Li>Search by child name or parent name to find any match quickly.</Li>
          <Li>Active matches show how many days they've been paired.</Li>
          <Li>To close a match (e.g., child aged out, family cancelled), find the match and select a close reason. Both children return to Unmatched status and re-enter the queue.</Li>
        </ul>
        <Tip>Always close a match through this page — it ensures both children's statuses are updated correctly in the system.</Tip>
      </div>
    ),
  },
  {
    id: "incomplete",
    icon: AlertTriangle,
    color: "bg-amber-100 text-amber-700",
    title: "Incomplete Onboarding  ·  /incomplete  (Admin only)",
    content: (
      <div className="space-y-3">
        <P>Catches parents who signed up (and are paying) but never completed the enrollment form to add their child's profile. No profile = no match.</P>
        <ul className="space-y-2 ml-1">
          <Li>Each row shows how many days the parent has been stuck. Over 7 days triggers a warning on the Dashboard.</Li>
          <Li>Click the email icon to send a reminder directly from this page.</Li>
          <Li>Once the parent completes onboarding, they automatically drop off this list.</Li>
        </ul>
        <Tip type="warn">Check this at least weekly. A parent paying for months with no match is a churn risk.</Tip>
      </div>
    ),
  },
  {
    id: "children",
    icon: UserPlus,
    color: "bg-green-100 text-green-700",
    title: "Children Directory  ·  /children",
    content: (
      <div className="space-y-3">
        <P>Complete searchable list of every child in the system, regardless of status. Your go-to lookup tool.</P>
        <ul className="space-y-2 ml-1">
          <Li>Filter by match status (Unmatched, Matched, Paused, Cancelled) or Give A Key status.</Li>
          <Li>Click any child to open their full profile: interests, address, match history, and a link to their parent's record.</Li>
          <Li>Profile sheets are read-only here — edits happen through the parent's profile or the Give A Key receipt flow.</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "parents",
    icon: Users,
    color: "bg-teal-100 text-teal-700",
    title: "Parents Directory  ·  /parents",
    content: (
      <div className="space-y-3">
        <P>Every parent account — searchable by name or email. The family-level view of your subscriber base.</P>
        <ul className="space-y-2 ml-1">
          <Li>Shows subscription status, membership tier, billing type (monthly/annual), and mailing address.</Li>
          <Li>Click a parent to open their profile sheet — see all their children, add internal notes, and view subscription details.</Li>
          <Li>Paid subscriber records are created automatically via the ReCharge hourly sync. Give A Key parents are created during receipt verification.</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "pack-delivery",
    icon: Package,
    color: "bg-rose-100 text-rose-700",
    title: "Pack Delivery Tracker  ·  /pack-delivery  (Admin + VA)",
    badge: "Monthly",
    content: (
      <div className="space-y-4">
        <P>
          Tracks each month's Klaviyo delivery email batch — how many went out, how many failed,
          and whether every member received their pack notification. One row per month, auto-created
          on the 1st of each month at 6am Mountain Time.
        </P>
        <H>Monthly Workflow</H>
        <Flow steps={[
          { label: "Auto-create", sub: "1st of month, 6am MT" },
          { label: "Klaviyo sends batch", sub: "delivery emails go out" },
          { label: "Update counts", sub: "sent / failed / resent" },
          { label: "Log failures", sub: "per-member if any" },
          { label: "Resolve each failure", sub: "resend + mark resolved" },
          { label: "Mark Confirmed", sub: "admin signs off" },
        ]} />
        <H>Delivery Statuses</H>
        <ul className="space-y-2 ml-1">
          <Li><strong>Pending</strong> — Log created, delivery not yet confirmed.</Li>
          <Li><strong>Partial</strong> — At least one failure has been logged.</Li>
          <Li><strong>Confirmed</strong> — Admin has verified all members received their notification (or failures are resolved).</Li>
        </ul>
        <H>Logging Failures</H>
        <P>Click <strong>Add Failure</strong> on any month row to record a specific member whose email bounced or never arrived. Enter the failure reason and optionally link the parent and child records. Once you've manually resent their delivery notification, mark the failure <strong>Resolved</strong>.</P>
        <H>CSV Export</H>
        <P>Any month can be exported as a CSV for your records — includes all counts and failure details.</P>
        <Tip type="info">
          The Dashboard "Today's Work" panel shows unresolved pack delivery failures for the current month — they sort to the top as urgent items.
        </Tip>
        <Tip type="good">
          The auto-create on the 1st snapshots the active member count by tier at that moment, so you always have a record of how many members were in each tier when the batch went out.
        </Tip>
      </div>
    ),
  },
  {
    id: "influencers",
    icon: TrendingUp,
    color: "bg-violet-100 text-violet-700",
    title: "Influencer Tracker  ·  /influencers  (Admin only)",
    badge: "Growth",
    content: (
      <div className="space-y-4">
        <P>
          Manages your affiliate partner relationships — from first outreach all the way to tracking
          conversions and paying commissions. Every influencer or creator you work with lives here.
        </P>
        <H>Five Views</H>
        <ul className="space-y-2 ml-1">
          <Li><strong>All</strong> — Every influencer in the system. Sort and search.</Li>
          <Li><strong>Active Partners</strong> — Currently active affiliates with a live affiliate code.</Li>
          <Li><strong>Top Performers</strong> — Ranked by total conversions.</Li>
          <Li><strong>Commission Due</strong> — Influencers with an unpaid commission balance (owed minus paid &gt; $0). Use this each month to know who to pay.</Li>
          <Li><strong>Outreach Queue</strong> — Influencers you haven't contacted yet or who are mid-outreach. Work through these to grow your partner base.</Li>
        </ul>
        <H>Adding an Influencer</H>
        <Flow steps={[
          { label: "Click Add Influencer" },
          { label: "Enter profile info", sub: "handles, tier, follower count" },
          { label: "Set commission rate", sub: "% of revenue per conversion" },
          { label: "Generate affiliate code", sub: "unique code for tracking" },
          { label: "Track outreach", sub: "update status as you go" },
        ]} />
        <H>Commission Calculation</H>
        <P>Commission owed is calculated automatically on every save:</P>
        <div className="bg-muted/40 rounded-lg px-4 py-3 font-mono text-xs text-foreground">
          conversions × $14.00 (revenue per conversion) × (commission rate ÷ 100)
        </div>
        <P>The $14.00 revenue-per-conversion default can be adjusted per influencer. After paying, enter the payment amount in the <strong>Paid</strong> field — the balance due updates automatically.</P>
        <H>Detail Sheet (click any row)</H>
        <ul className="space-y-2 ml-1">
          <Li>Edit all profile fields inline and save.</Li>
          <Li>Add notes to the timeline — use these to log outreach attempts, calls, agreements, or any status change.</Li>
          <Li>Log content URLs (Instagram posts, TikToks) they've created featuring your brand.</Li>
          <Li>Update conversion counts manually as they come in from your affiliate platform.</Li>
        </ul>
        <H>Outreach Statuses</H>
        <ul className="space-y-2 ml-1">
          <Li><strong>Not Contacted</strong> → <strong>Outreach Sent</strong> → <strong>In Negotiation</strong> → <strong>Active Partner</strong></Li>
          <Li><strong>Declined</strong> or <strong>Ghosted</strong> — Dead ends, still tracked for reference.</Li>
        </ul>
        <H>Tiers</H>
        <ul className="space-y-2 ml-1">
          <Li><strong>Nano</strong> — Under 10K followers</Li>
          <Li><strong>Micro</strong> — 10K–100K followers</Li>
          <Li><strong>Macro</strong> — 100K–1M followers</Li>
          <Li><strong>Mega</strong> — 1M+ followers</Li>
        </ul>
        <Tip type="info">
          The Dashboard Growth section (admin only) shows a live summary: active partners, conversions this month, and total commission balance due.
          Commission Owed goes amber when there's an unpaid balance.
        </Tip>
      </div>
    ),
  },
  {
    id: "users",
    icon: ShieldCheck,
    color: "bg-indigo-100 text-indigo-700",
    title: "User Management  ·  /users  (Admin only)",
    content: (
      <div className="space-y-3">
        <P>Manage who has access to MailDay Matching and at what level.</P>
        <ul className="space-y-2 ml-1">
          <Li><strong>Add user</strong> — Create a new login with email, password, and role (Admin or VA).</Li>
          <Li><strong>Toggle role</strong> — Promote a VA to Admin or demote an Admin to VA. You can't change your own role.</Li>
          <Li><strong>Delete user</strong> — Permanently removes the account. You can't delete yourself.</Li>
        </ul>
        <Tip type="warn">There's no password reset email. To reset someone's password, delete and recreate their account — or they can use the Change Password option in the sidebar footer.</Tip>
      </div>
    ),
  },
  {
    id: "performance",
    icon: BarChart2,
    color: "bg-pink-100 text-pink-700",
    title: "Team Performance  ·  /performance",
    content: (
      <div className="space-y-3">
        <P>Tracks matching output across the team — how many matches were made this week and this month.</P>
        <ul className="space-y-2 ml-1">
          <Li>Shows team-wide totals for matches completed in the current week and month.</Li>
          <Li>Use this to spot slow weeks and decide whether to run extra match sessions.</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "gak-overview",
    icon: Sparkles,
    color: "bg-primary/10 text-primary",
    title: "Give A Key Program — Full Flow",
    badge: "Program guide",
    content: (
      <div className="space-y-4">
        <P>Give A Key is a scholarship program for families who can't afford the standard subscription. It's funded by donations (via Shopify and manual entry). You cover their USPS PO Box cost so they can receive letters.</P>
        <H>End-to-End Journey</H>
        <Flow steps={[
          { label: "Family applies", sub: "/give-a-key/apply (public)" },
          { label: "You review", sub: "Applications page" },
          { label: "Approve or waitlist", sub: "based on fund balance" },
          { label: "Family sets up PO Box", sub: "USPS, ~$30–50" },
          { label: "Family submits receipt", sub: "/give-a-key/po-box (public)" },
          { label: "You verify & activate", sub: "Receipts page" },
          { label: "Child enters queue", sub: "matched like any paid subscriber" },
        ]} />
        <H>When to Waitlist vs. Approve</H>
        <ul className="space-y-2 ml-1">
          <Li><strong>Approve</strong> — Sufficient funds in the balance to cover their reimbursement.</Li>
          <Li><strong>Waitlist</strong> — Funds too low right now. The family goes to the Waitlist in FIFO order and is activated when donations come in.</Li>
        </ul>
        <H>Reimbursement Flow</H>
        <P>You send funds via <strong>Tremendous</strong> (a digital disbursement tool). The Applications page tracks which approved families have had their Tremendous transfer sent.</P>
        <Tip type="info">The Give A Key Dashboard shows a live fund balance. If it's lower than the reimbursement amount, new approvals should go to the waitlist instead.</Tip>
      </div>
    ),
  },
  {
    id: "gak-dashboard",
    icon: LayoutDashboard,
    color: "bg-primary/10 text-primary",
    title: "Give A Key Dashboard  ·  /give-a-key  (Admin only)",
    content: (
      <div className="space-y-3">
        <P>Financial health of the scholarship program at a glance.</P>
        <ul className="space-y-2 ml-1">
          <Li><strong>Fund balance</strong> — Total donations received minus disbursements made.</Li>
          <Li><strong>Waitlist cost</strong> — How much it would cost to activate everyone on the waitlist at once.</Li>
          <Li><strong>Reimbursement amount</strong> — The amount you give each approved family for their PO Box. Adjustable here.</Li>
          <Li>Alerts appear when the balance is insufficient for the next waitlisted family, or when Tremendous transfers are pending.</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "gak-tasks",
    icon: ListChecks,
    color: "bg-orange-100 text-orange-700",
    title: "Action Items  ·  /action-items",
    content: (
      <div className="space-y-3">
        <P>Auto-generated to-do list. The system creates tasks when something needs human attention. Clear these daily.</P>
        <ul className="space-y-2 ml-1">
          <Li>Tasks are created when: a new Give A Key application arrives, a receipt is submitted, a family needs to be waitlisted, or other system events trigger follow-up.</Li>
          <Li>Click the <strong>email icon</strong> on a task to open a pre-addressed email draft to that family.</Li>
          <Li>Mark tasks <strong>Done</strong> once handled — they disappear from the list and the Dashboard counter drops to zero.</Li>
        </ul>
        <Tip type="good">The Dashboard "Today's Work" panel shows how many open action items exist. Zero is the goal every day.</Tip>
      </div>
    ),
  },
  {
    id: "gak-applications",
    icon: ClipboardList,
    color: "bg-rose-100 text-rose-700",
    title: "Applications  ·  /give-a-key/applications",
    content: (
      <div className="space-y-3">
        <P>Main processing hub for every Give A Key application. Applications come in from the public apply form and land here.</P>
        <H>Statuses</H>
        <ul className="space-y-2 ml-1">
          <Li><strong>Pending</strong> — New application, not yet reviewed.</Li>
          <Li><strong>Approved</strong> — Family cleared to set up a PO Box. Waiting for Tremendous transfer or receipt submission.</Li>
          <Li><strong>Waitlisted</strong> — Approved but no funds available yet.</Li>
          <Li><strong>Rejected</strong> — Application declined.</Li>
          <Li><strong>Active</strong> — Receipt verified, membership activated, child in the queue.</Li>
        </ul>
        <H>Tremendous Column</H>
        <P>Tracks whether you've sent the reimbursement transfer for each approved family. Mark it sent once Tremendous confirms the disbursement.</P>
      </div>
    ),
  },
  {
    id: "gak-waitlist",
    icon: Clock,
    color: "bg-amber-100 text-amber-700",
    title: "Waitlist  ·  /give-a-key/waitlist",
    content: (
      <div className="space-y-3">
        <P>FIFO queue of approved families waiting for funds to become available. Oldest first.</P>
        <ul className="space-y-2 ml-1">
          <Li>When a donation comes in and the balance can cover a reimbursement, approve the top family here.</Li>
          <Li>Approving moves them back to "Approved" status in Applications, where you then send the Tremendous transfer.</Li>
          <Li>The Give A Key Dashboard shows the current balance vs. what it costs to clear the next family.</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "gak-receipts",
    icon: Receipt,
    color: "bg-green-100 text-green-700",
    title: "Receipts  ·  /give-a-key/receipts  (Admin only)",
    content: (
      <div className="space-y-3">
        <P>The activation step. When an approved family submits their PO Box receipt, it lands here for verification.</P>
        <H>Verification Checklist</H>
        <ul className="space-y-2 ml-1">
          <Li>Confirm the receipt shows a USPS PO Box rental (not a private mailbox service).</Li>
          <Li>Confirm the address submitted matches the receipt.</Li>
          <Li>Confirm the child's information matches the application.</Li>
        </ul>
        <H>What Happens on Activation</H>
        <P>Clicking <strong>Activate</strong> creates the Parent and Child records, sets the child's status to Unmatched, and adds them to the matching queue — exactly like a paid subscriber.</P>
        <Tip type="warn">Activation is permanent. Verify the receipt is legitimate before clicking — there's no undo.</Tip>
      </div>
    ),
  },
  {
    id: "gak-donations",
    icon: DollarSign,
    color: "bg-emerald-100 text-emerald-700",
    title: "Donations  ·  /give-a-key/donations  (Admin only)",
    content: (
      <div className="space-y-3">
        <P>Ledger of all Give A Key funding. Donations minus disbursements equals the available balance.</P>
        <ul className="space-y-2 ml-1">
          <Li><strong>Shopify donations</strong> sync automatically via webhook — no manual entry needed.</Li>
          <Li><strong>Manual donations</strong> (cash, checks, Venmo, etc.) can be added here with the donor's name and amount.</Li>
          <Li>The total here feeds directly into the fund balance on the Give A Key Dashboard.</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "public",
    icon: Globe,
    color: "bg-sky-100 text-sky-700",
    title: "Public-Facing Pages",
    badge: "No login required",
    content: (
      <div className="space-y-4">
        <P>These pages are for families, not admins. Share the links directly or embed them on your website.</P>
        <div className="space-y-3">
          <div className="border border-border rounded-lg p-3">
            <div className="font-semibold text-sm flex items-center gap-2 mb-1"><Globe className="w-3.5 h-3.5 text-sky-500" /> Enrollment  ·  /enroll</div>
            <p className="text-xs text-muted-foreground">Standard paid subscription signup. Multi-step form collecting parent email, mailing address, and child profiles. ReCharge handles billing separately.</p>
          </div>
          <div className="border border-border rounded-lg p-3">
            <div className="font-semibold text-sm flex items-center gap-2 mb-1"><Globe className="w-3.5 h-3.5 text-sky-500" /> Give A Key Apply  ·  /give-a-key/apply</div>
            <p className="text-xs text-muted-foreground">Scholarship application form. Collects personal info, child details, and a Statement of Need. Submitted applications appear in the Applications page.</p>
          </div>
          <div className="border border-border rounded-lg p-3">
            <div className="font-semibold text-sm flex items-center gap-2 mb-1"><Globe className="w-3.5 h-3.5 text-sky-500" /> PO Box Receipt  ·  /give-a-key/po-box</div>
            <p className="text-xs text-muted-foreground">Receipt submission portal for approved Give A Key families. They upload their USPS PO Box receipt and enter their new address. Submissions appear in the Receipts page.</p>
          </div>
        </div>
        <Tip type="info">The enrollment and Give A Key apply pages are completely separate flows — families should only use one, not both.</Tip>
      </div>
    ),
  },
  {
    id: "slack",
    icon: Settings,
    color: "bg-slate-100 text-slate-700",
    title: "Automated Slack Notifications",
    content: (
      <div className="space-y-3">
        <P>The system sends automated Slack messages to keep the team informed without having to log in. All times are Mountain Time.</P>
        <div className="space-y-2">
          {[
            { time: "Daily — 7:00am", label: "Daily Digest", desc: "Unmatched queue count, urgent guarantees, open action items, Give A Key fund balance, and at-risk members. A quick morning briefing." },
            { time: "Fridays — 8:00am", label: "Friday Reminder", desc: "Nudge to run a match session before the weekend — shows how many children are waiting." },
            { time: "Sundays — 8:00am", label: "Weekly Summary", desc: "Week-in-review: matches made, new subscribers, current MRR, and member health snapshot." },
            { time: "1st of month — 6:00am", label: "Pack Delivery Auto-Create", desc: "Automatically creates the new month's Pack Delivery log entry with a snapshot of active member counts by tier." },
          ].map((n) => (
            <div key={n.label} className="border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[10px] font-mono">{n.time}</Badge>
                <span className="font-semibold text-sm">{n.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{n.desc}</p>
            </div>
          ))}
        </div>
        <Tip type="warn">Slack notifications require the <strong>SLACK_WEBHOOK</strong> environment variable to be set. If you're not seeing messages, contact your admin to verify it's configured.</Tip>
      </div>
    ),
  },
  {
    id: "tips",
    icon: Star,
    color: "bg-amber-100 text-amber-700",
    title: "Tips, Gotchas & Good to Know",
    content: (
      <div className="space-y-3">
        <Tip type="warn"><strong>Session timeouts:</strong> If the app stops loading data (everything shows 0 or errors appear), your session has expired. Click the user menu in the sidebar footer, sign out, then sign back in.</Tip>
        <Tip type="warn"><strong>Match guarantees:</strong> The 21-day clock starts when a child is first added, not when a match attempt is made. Check the Dashboard Urgent Guarantees count every morning.</Tip>
        <Tip type="info"><strong>ReCharge sync:</strong> Subscriber data syncs automatically every hour. If a subscriber's info looks stale, wait up to an hour — or ask your admin to trigger a manual sync.</Tip>
        <Tip type="info"><strong>Closing a match:</strong> When a child ages out or a family cancels, always close the match in Match History first. This returns both children to Unmatched and keeps the queue accurate.</Tip>
        <Tip type="info"><strong>Pack delivery timing:</strong> The new month's delivery log is auto-created at 6am MT on the 1st. If you need to create it earlier (e.g., you're sending delivery emails on the last day of the month), use the manual "Add Month" button on the Pack Delivery Tracker.</Tip>
        <Tip type="good"><strong>Give A Key tip:</strong> Process receipts before running match sessions so newly activated scholarship families are included in the same day's matching.</Tip>
        <Tip type="good"><strong>Influencer commissions:</strong> Always use the Commission Due view at the start of each month — it shows only influencers with an outstanding balance so you don't have to scroll through everyone.</Tip>
        <Tip type="good"><strong>Password changes:</strong> Each team member can change their own password from the sidebar footer — click the user area to find the option.</Tip>
      </div>
    ),
  },
];

export default function Help() {
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-8 pb-16">
      <div>
        <div className="flex items-center gap-2 text-primary mb-2">
          <BookOpen className="w-5 h-5" />
          <span className="text-xs font-semibold uppercase tracking-widest">Platform Guide</span>
        </div>
        <h1 className="text-3xl font-heading font-bold text-foreground">How to Run MailDay Matching</h1>
        <p className="text-muted-foreground mt-2">
          Everything you need to know — from daily workflows to every page and feature.
          Click any section to expand it.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-heading font-bold text-sm text-primary mb-1">Quick Navigation</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {sections.map((s) => (
                  <button
                    key={s.id}
                    className="hover:text-primary transition-colors"
                    onClick={() => {
                      document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    {s.title.split("·")[0].trim()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {sections.map((s) => (
          <div key={s.id} id={s.id}>
            <AccordionItem section={s} />
          </div>
        ))}
      </div>
    </div>
  );
}
