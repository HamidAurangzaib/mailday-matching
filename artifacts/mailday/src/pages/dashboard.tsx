import { useGetStatsSummary } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Users, AlertCircle, Clock, CheckCircle2, TrendingUp, DollarSign,
  CalendarCheck, Mail, AlertTriangle, Cake, ListChecks, FileCheck2,
  ClipboardList, ChevronRight, UserPlus, ArrowRight, Sparkles, RefreshCw,
  CalendarDays, Star, Package, UserMinus, TrendingDown, Minus,
  Mailbox, ShieldAlert, Send,
} from "lucide-react";

interface InfluencerStats {
  active_partners: number;
  total_conversions: number;
  conversions_this_month: number;
  total_commission_owed: number;
  total_commission_paid: number;
  balance_due: number;
}

interface HealthSummary {
  children: { green: number; yellow: number; red: number };
  parents:  { green: number; yellow: number; red: number };
}

interface LifecycleTiles {
  pending_address_confirmation: number;
  at_risk_families: number;
  poppy_cards_to_mail: number;
}

interface GakFund {
  pending_count: number;
  receipts_pending: number;
  tremendous_pending?: number;
  fund_balance?: number;
}

interface TaskCount {
  count: number;
}

interface CancellationStats {
  cancellations_this_month: number;
  cancellations_this_quarter: number;
  top_cancellation_reason_this_quarter: string | null;
  net_member_change_this_month: number;
}

interface StatsWithRevenue {
  total_unmatched: number;
  total_matched: number;
  total_active_matches: number;
  minis_unmatched: number;
  core_unmatched: number;
  urgent_guarantee: number;
  warning_guarantee: number;
  incomplete_onboarding: number;
  overdue_onboarding_count: number;
  overdue_onboarding_list: { id: string; name: string; email: string; days_since_joined: number | null }[];
  rematch_count: number;
  matches_this_week: number;
  matches_this_month: number;
  upcoming_birthdays: { id: string; name: string; date_of_birth: string; days_until: number; turning: number }[];
  total_mrr: number;
  total_arr: number;
  total_active_subscribers: number;
  new_subscribers_7d: number;
  monthly_subscribers: number;
  annual_subscribers: number;
  subscribers_by_tier: Record<string, { monthly: number; annual: number }>;
}

interface ActivityEvent {
  id: string;
  type: string;
  description: string;
  child_a_name: string;
  child_b_name: string;
  status: string;
  timestamp: string;
  shared_interests: string[];
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export default function Dashboard() {
  const { data: rawStats, isLoading } = useGetStatsSummary();
  const stats = rawStats as StatsWithRevenue | undefined;
  const { user } = useAuth();

  const { data: activity, isLoading: activityLoading } = useQuery<ActivityEvent[]>({
    queryKey: ["activity"],
    queryFn: () => customFetch<ActivityEvent[]>("/api/activity?limit=20"),
    refetchInterval: 30000,
  });

  const { data: gakFund } = useQuery<GakFund>({
    queryKey: ["gak-fund-dashboard"],
    queryFn: () => customFetch<GakFund>("/api/give-a-key/fund"),
    refetchInterval: 60000,
  });

  const { data: taskCount } = useQuery<TaskCount>({
    queryKey: ["gak-tasks-open-count"],
    queryFn: () => customFetch<TaskCount>("/api/give-a-key/tasks/open-count"),
    refetchInterval: 60000,
  });

  const { data: healthSummary } = useQuery<HealthSummary>({
    queryKey: ["health-summary"],
    queryFn: () => customFetch<HealthSummary>("/api/health/summary"),
    refetchInterval: 60000,
  });

  const { data: lifecycleTiles } = useQuery<LifecycleTiles>({
    queryKey: ["lifecycle-tiles"],
    queryFn: () => customFetch<LifecycleTiles>("/api/stats/lifecycle-tiles"),
    refetchInterval: 60000,
  });

  const isAdmin = user?.role === "admin";

  const { data: influencerStats } = useQuery<InfluencerStats>({
    queryKey: ["influencer-stats-dashboard"],
    queryFn: () => customFetch<InfluencerStats>("/api/influencers/stats"),
    refetchInterval: 60000,
    enabled: isAdmin,
    retry: false,
  });

  interface PackCurrent { failure_counts?: { total: number; unresolved: number } }
  const { data: packCurrent } = useQuery<PackCurrent | null>({
    queryKey: ["pack-delivery-current-dashboard"],
    queryFn: () => customFetch<PackCurrent | null>("/api/pack-delivery/current"),
    refetchInterval: 60000,
    retry: false,
  });

  const { data: cancellationStats } = useQuery<CancellationStats>({
    queryKey: ["cancellation-stats-dashboard"],
    queryFn: () => customFetch<CancellationStats>("/api/cancellations/stats"),
    refetchInterval: 300000,
    enabled: isAdmin,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 space-y-6">
        <h1 className="text-3xl font-heading font-bold">Overview</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const tierRows = Object.entries(stats?.subscribers_by_tier ?? {}).sort((a, b) =>
    (b[1].monthly + b[1].annual) - (a[1].monthly + a[1].annual)
  );

  const overdueList = stats?.overdue_onboarding_list ?? [];
  const packFailures = packCurrent?.failure_counts?.unresolved ?? 0;

  const openTasks = taskCount?.count ?? 0;
  const pendingApps = gakFund?.pending_count ?? 0;
  const receipts = gakFund?.receipts_pending ?? 0;
  const urgentGuarantees = stats?.urgent_guarantee ?? 0;
  const totalUnmatched = (stats?.core_unmatched ?? 0) + (stats?.minis_unmatched ?? 0);

  const pendingAddress = lifecycleTiles?.pending_address_confirmation ?? 0;
  const atRiskFamilies = lifecycleTiles?.at_risk_families ?? 0;
  const poppyCards = lifecycleTiles?.poppy_cards_to_mail ?? 0;

  const workItems = [
    { label: "Urgent Guarantees",         count: urgentGuarantees, href: "/queue",                    icon: AlertCircle,   urgent: true  },
    { label: "At-Risk Families",          count: atRiskFamilies,   href: "/parents",                  icon: ShieldAlert,   urgent: true  },
    { label: "Open Action Items",         count: openTasks,        href: "/give-a-key/tasks",          icon: ListChecks,    urgent: true  },
    { label: "Pack Delivery Issues",      count: packFailures,     href: "/pack-delivery",             icon: Package,       urgent: true  },
    { label: "Pending Address Confirms",  count: pendingAddress,   href: "/active-matches",           icon: Mailbox,       urgent: false },
    { label: "Poppy Cards to Mail",       count: poppyCards,       href: "/action-items",             icon: Send,          urgent: false },
    { label: "In Queue",                  count: totalUnmatched,   href: "/queue",                    icon: Users,         urgent: false },
    { label: "Pending Applications",      count: pendingApps,      href: "/give-a-key/applications",  icon: ClipboardList, urgent: false },
    { label: "Receipts to Verify",        count: receipts,         href: "/give-a-key/receipts",      icon: FileCheck2,    urgent: false },
  ];

  const sortedWorkItems = [...workItems].sort((a, b) => {
    const score = (i: typeof a) => i.count > 0 && i.urgent ? 0 : i.count > 0 ? 1 : 2;
    const diff = score(a) - score(b);
    return diff !== 0 ? diff : b.count - a.count;
  });

  const firstActiveIdx = sortedWorkItems.findIndex((i) => i.count > 0);

  const startHere = (() => {
    if (urgentGuarantees > 0) return {
      message: `${urgentGuarantees} ${urgentGuarantees === 1 ? "child has" : "children have"} hit the 21-day guarantee — act now.`,
      href: "/queue", level: "urgent" as const,
    };
    if (totalUnmatched >= 2) return {
      message: `${totalUnmatched} children are waiting to be matched. ${isAdmin ? "Ready to start a match session?" : "Check the queue."}`,
      href: isAdmin ? "/matching" : "/queue", level: "info" as const,
    };
    if (openTasks > 0) return {
      message: `${openTasks} Give a Key ${openTasks === 1 ? "task needs" : "tasks need"} your attention.`,
      href: "/give-a-key/tasks", level: "action" as const,
    };
    if (pendingApps > 0) return {
      message: `${pendingApps} scholarship ${pendingApps === 1 ? "application is" : "applications are"} pending review.`,
      href: "/give-a-key/applications", level: "action" as const,
    };
    if (receipts > 0) return {
      message: `${receipts} ${receipts === 1 ? "receipt is" : "receipts are"} waiting to be verified.`,
      href: "/give-a-key/receipts", level: "action" as const,
    };
    return {
      message: totalUnmatched === 1 ? "One child in queue — wait for more before matching. Otherwise, everything's clear!" : "Everything's clear — great day to get ahead on matching.",
      href: "/queue", level: "clear" as const,
    };
  })();

  const startHereStyles = {
    urgent: { wrap: "bg-destructive/5 border-destructive/30", icon: "text-destructive", text: "text-destructive font-semibold", cta: "text-destructive hover:text-destructive/80", Icon: AlertCircle },
    info:   { wrap: "bg-sky-50 border-sky-200",               icon: "text-sky-600",      text: "text-sky-900 font-semibold",     cta: "text-sky-700 hover:text-sky-900",           Icon: Sparkles   },
    action: { wrap: "bg-amber-50 border-amber-200",           icon: "text-amber-600",    text: "text-amber-900 font-semibold",   cta: "text-amber-700 hover:text-amber-900",       Icon: AlertTriangle },
    clear:  { wrap: "bg-green-50 border-green-200",           icon: "text-green-600",    text: "text-green-900",                 cta: "text-green-700 hover:text-green-900",       Icon: CheckCircle2  },
  }[startHere.level];

  return (
    <div className="p-4 md:p-8 space-y-8">
      <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground">Overview</h1>

      {/* Today's Work — priority sorted */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Today's Work</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {sortedWorkItems.map(({ label, count, href, icon: Icon, urgent }, idx) => (
            <Link key={label} href={href}>
              <div className={`relative group rounded-xl border px-4 py-3 flex flex-col gap-1 cursor-pointer transition-colors hover:bg-muted/30 ${count > 0 && urgent ? "border-destructive/40 bg-destructive/5" : count > 0 ? "border-amber-300/60 bg-amber-50/50" : "border-border bg-muted/10"}`}>
                {idx === firstActiveIdx && (
                  <span className="absolute -top-2 left-3 text-[9px] font-bold uppercase tracking-widest bg-foreground text-background px-1.5 py-0.5 rounded-full">
                    First
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <Icon className={`w-4 h-4 ${count > 0 && urgent ? "text-destructive" : count > 0 ? "text-amber-600" : "text-muted-foreground"}`} />
                  <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className={`text-2xl font-bold leading-none mt-1 ${count > 0 && urgent ? "text-destructive" : count > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                  {count}
                </div>
                <div className="text-xs text-muted-foreground leading-snug">{label}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Member Health */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Member Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(
            [
              { label: "Children", data: healthSummary?.children, href: "/children" },
              { label: "Parents",  data: healthSummary?.parents,  href: "/parents"  },
            ] as const
          ).map(({ label, data, href }) => {
            const total = (data?.green ?? 0) + (data?.yellow ?? 0) + (data?.red ?? 0);
            return (
              <Link key={label} href={href}>
                <div className="rounded-xl border bg-card p-4 flex items-center gap-4 hover:bg-muted/30 transition-colors cursor-pointer group">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">{label}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500 ring-1 ring-green-200 inline-block" />
                        <span className="font-semibold text-green-700">{data?.green ?? "—"}</span>
                        <span className="text-muted-foreground text-xs">healthy</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-1 ring-amber-200 inline-block" />
                        <span className="font-semibold text-amber-700">{data?.yellow ?? "—"}</span>
                        <span className="text-muted-foreground text-xs">attention</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-red-200 inline-block" />
                        <span className="font-semibold text-red-700">{data?.red ?? "—"}</span>
                        <span className="text-muted-foreground text-xs">at risk</span>
                      </span>
                    </div>
                    {total > 0 && (
                      <div className="mt-3 h-1.5 rounded-full overflow-hidden bg-muted flex">
                        {(data?.green ?? 0) > 0 && <div className="bg-green-500 h-full" style={{ width: `${((data?.green ?? 0) / total) * 100}%` }} />}
                        {(data?.yellow ?? 0) > 0 && <div className="bg-amber-400 h-full" style={{ width: `${((data?.yellow ?? 0) / total) * 100}%` }} />}
                        {(data?.red ?? 0) > 0   && <div className="bg-red-500 h-full"   style={{ width: `${((data?.red ?? 0)   / total) * 100}%` }} />}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Onboarding reminder banner */}
      {overdueList.length > 0 && (
        <section>
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-amber-800 text-sm">
                {overdueList.length} {overdueList.length === 1 ? "family" : "families"} waiting to onboard
              </div>
              <p className="text-xs text-amber-700 mt-1">
                These parents signed up over a week ago but haven't added their child yet.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {overdueList.slice(0, 6).map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5 bg-white rounded-full px-3 py-1 border border-amber-200 text-xs">
                    <Mail className="w-3 h-3 text-amber-500" />
                    <span className="font-medium">{p.name}</span>
                    {p.days_since_joined != null && (
                      <span className="text-amber-500">· {p.days_since_joined}d ago</span>
                    )}
                  </div>
                ))}
                {overdueList.length > 6 && (
                  <div className="flex items-center rounded-full px-3 py-1 text-xs text-amber-700">
                    +{overdueList.length - 6} more
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Revenue row */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Revenue</h2>
        <div className={`grid gap-4 md:gap-6 ${isAdmin ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"}`}>
          <StatCard
            title="MRR"
            value={fmt(stats?.total_mrr ?? 0)}
            icon={DollarSign}
            description={`${stats?.total_active_subscribers ?? 0} active subscribers`}
            valueClassName="text-2xl"
          />
          <StatCard
            title="ARR"
            value={fmt(stats?.total_arr ?? 0)}
            icon={TrendingUp}
            description="Annualized from current MRR"
            valueClassName="text-2xl"
          />
          {/* Subscribers card — total + 7-day new */}
          <Link href="/parents">
            <Card className="cursor-pointer transition-colors hover:bg-muted/30">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Subscribers</CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.total_active_subscribers ?? 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.monthly_subscribers ?? 0} monthly · {stats?.annual_subscribers ?? 0} annual
                </p>
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                  <UserPlus className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  <span className="text-sm font-semibold text-green-700">+{stats?.new_subscribers_7d ?? 0}</span>
                  <span className="text-xs text-muted-foreground">new in the last 7 days</span>
                </div>
              </CardContent>
            </Card>
          </Link>
          {/* Give a Key fund balance — admin only */}
          {isAdmin && (
            <Link href="/give-a-key">
              <Card className="cursor-pointer transition-colors hover:bg-muted/30">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Give a Key Fund</CardTitle>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{fmt(gakFund?.fund_balance ?? 0)}</div>
                  <p className="text-xs text-muted-foreground mt-1">Available balance</p>
                  {(gakFund?.pending_count ?? 0) > 0 && (
                    <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                      <ClipboardList className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="text-xs text-amber-700 font-medium">{gakFund?.pending_count} pending {(gakFund?.pending_count ?? 0) === 1 ? "application" : "applications"}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          )}
        </div>
      </section>

      {/* Matching row */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Matching</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            title="Total Unmatched"
            value={String(stats?.total_unmatched ?? 0)}
            icon={Users}
            description={`${stats?.minis_unmatched ?? 0} Minis · ${stats?.core_unmatched ?? 0} Core`}
            href="/queue"
          />
          <StatCard
            title="Rematch Queue"
            value={String(stats?.rematch_count ?? 0)}
            icon={RefreshCw}
            description="Children awaiting rematch"
            href="/queue"
          />
          {/* Active Matches — two numbers in one card */}
          <Link href="/history">
            <Card className="cursor-pointer transition-colors hover:bg-muted/30">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Matches</CardTitle>
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats?.total_active_matches ?? 0}</div>
                <div className="mt-2 pt-2 border-t border-border flex items-center gap-1.5">
                  <CalendarCheck className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  <span className="text-sm font-semibold text-green-700">{stats?.matches_this_week ?? 0}</span>
                  <span className="text-xs text-muted-foreground">confirmed this week</span>
                </div>
              </CardContent>
            </Card>
          </Link>
          <StatCard
            title="Urgent Guarantees"
            value={String(stats?.urgent_guarantee ?? 0)}
            icon={AlertCircle}
            description="Billing paused — act now"
            alert
            href="/action-items"
          />
          <StatCard
            title="Warning Guarantees"
            value={String(stats?.warning_guarantee ?? 0)}
            icon={Clock}
            description="Approaching 21-day limit"
            warning
            href="/action-items"
          />
          {/* Days Until Friday */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">Match Day</CardTitle>
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {(() => {
                const day = new Date().getDay();
                const daysTo = day === 5 ? 0 : (5 - day + 7) % 7;
                return (
                  <>
                    <div className="text-3xl font-bold">{daysTo === 0 ? "🎉" : daysTo}</div>
                    <p className="text-xs text-muted-foreground mt-1 mb-3">
                      {daysTo === 0 ? "It's Friday — match day!" : `day${daysTo === 1 ? "" : "s"} until Friday`}
                    </p>
                    {isAdmin && (
                      <Link href="/matching">
                        <Button size="sm" variant="outline" className="w-full h-7 text-xs">
                          Run Session
                        </Button>
                      </Link>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Upcoming birthdays */}
      {(stats?.upcoming_birthdays ?? []).length > 0 && (
        <section>
          <div className="rounded-xl border border-pink-200 bg-pink-50/60 p-4 flex gap-3 items-start">
            <Cake className="w-5 h-5 text-pink-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-pink-800 text-sm">
                {(stats?.upcoming_birthdays ?? []).length} upcoming {(stats?.upcoming_birthdays ?? []).length === 1 ? "birthday" : "birthdays"} — next 30 days
              </div>
              <p className="text-xs text-pink-600 mt-1">
                A great time to remind their pen pal to send a special letter!
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(stats?.upcoming_birthdays ?? []).map((b) => (
                  <div key={b.id} className="flex items-center gap-1.5 bg-white rounded-full px-3 py-1 border border-pink-200 text-xs">
                    <Cake className="w-3 h-3 text-pink-400" />
                    <span className="font-medium">{b.name}</span>
                    <span className="text-pink-400">·</span>
                    <span className="text-pink-600">
                      {b.days_until === 0 ? `Turning ${b.turning} today!` : `Turns ${b.turning} in ${b.days_until}d`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Retention section — admin only */}
      {isAdmin && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Retention</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Link href="/cancellations">
              <Card className="cursor-pointer hover:bg-muted/30 transition-colors">
                <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cancellations — Month</CardTitle>
                  <UserMinus className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="text-3xl font-bold">{cancellationStats?.cancellations_this_month ?? "—"}</div>
                  <p className="text-xs text-muted-foreground mt-1">{cancellationStats?.cancellations_this_quarter ?? "—"} this quarter</p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/cancellations?view=trends">
              <Card className="cursor-pointer hover:bg-muted/30 transition-colors">
                <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Top Reason — Quarter</CardTitle>
                  <TrendingDown className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="text-lg font-bold leading-tight">{cancellationStats?.top_cancellation_reason_this_quarter ?? "No data"}</div>
                  <p className="text-xs text-muted-foreground mt-1">Most common reason</p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/cancellations?view=unprocessed">
              <Card className="cursor-pointer hover:bg-muted/30 transition-colors">
                <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net Change — Month</CardTitle>
                  {(cancellationStats?.net_member_change_this_month ?? 0) > 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  ) : (cancellationStats?.net_member_change_this_month ?? 0) < 0 ? (
                    <TrendingDown className="w-4 h-4 text-destructive" />
                  ) : (
                    <Minus className="w-4 h-4 text-muted-foreground" />
                  )}
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className={`text-3xl font-bold ${(cancellationStats?.net_member_change_this_month ?? 0) > 0 ? "text-green-600" : (cancellationStats?.net_member_change_this_month ?? 0) < 0 ? "text-destructive" : ""}`}>
                    {cancellationStats != null ? (cancellationStats.net_member_change_this_month > 0 ? "+" : "") + cancellationStats.net_member_change_this_month : "—"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">New − cancelled</p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/cancellations">
              <Card className="cursor-pointer hover:bg-muted/30 transition-colors">
                <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tracker</CardTitle>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="text-sm font-semibold text-primary mt-2">View all cancellations</div>
                  <p className="text-xs text-muted-foreground mt-1">Categorise, log saves, track churn</p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </section>
      )}

      {/* Growth section — admin only */}
      {isAdmin && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Growth</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link href="/influencers">
              <Card className="cursor-pointer hover:bg-muted/30 transition-colors">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Active Partners</CardTitle>
                  <Star className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{influencerStats?.active_partners ?? "—"}</div>
                  <p className="text-xs text-muted-foreground mt-1">affiliate partners</p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/influencers">
              <Card className="cursor-pointer hover:bg-muted/30 transition-colors">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Conversions This Month</CardTitle>
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{influencerStats?.conversions_this_month ?? "—"}</div>
                  <p className="text-xs text-muted-foreground mt-1">{influencerStats?.total_conversions ?? 0} total all-time</p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/influencers?view=Commission+Due">
              <Card className={`cursor-pointer hover:bg-muted/30 transition-colors ${(influencerStats?.balance_due ?? 0) > 0 ? "border-amber-300 bg-amber-50/40" : ""}`}>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Commission Owed</CardTitle>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className={`text-3xl font-bold ${(influencerStats?.balance_due ?? 0) > 0 ? "text-amber-700" : ""}`}>
                    ${(influencerStats?.balance_due ?? 0).toFixed(2)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">balance due across all influencers</p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </section>
      )}

      {/* Bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Live activity feed */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <span className="text-xs text-muted-foreground">{activity?.length ?? 0} events</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {activityLoading ? (
              <div className="px-6 pb-6 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : activity?.length === 0 ? (
              <div className="px-6 pb-6 text-sm text-muted-foreground">No matches yet — run a Match Session to get started.</div>
            ) : (
              <div className="divide-y max-h-72 overflow-y-auto">
                {activity?.map((event) => (
                  <div key={event.id} className="flex items-start justify-between px-6 py-3 gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug truncate">{event.description}</p>
                      {event.shared_interests.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {event.shared_interests.map((i) => (
                            <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">{i}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <Badge
                        variant={event.status === "Active" ? "default" : "outline"}
                        className={`text-[10px] mb-1 ${event.status === "Active" ? "bg-green-500" : "text-muted-foreground"}`}
                      >
                        {event.status}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground">{timeAgo(event.timestamp)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscribers by tier */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscribers by Tier</CardTitle>
          </CardHeader>
          <CardContent>
            {tierRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active subscribers yet.</p>
            ) : (
              <div className="space-y-3">
                {tierRows.map(([tier, counts]) => {
                  const total = counts.monthly + counts.annual;
                  return (
                    <div key={tier} className="flex items-center justify-between pb-3 border-b last:border-0 last:pb-0">
                      <div>
                        <div className="text-sm font-medium">{tier}</div>
                        <div className="text-xs text-muted-foreground">
                          {counts.monthly} monthly · {counts.annual} annual
                        </div>
                      </div>
                      <span className="font-bold text-lg">{total}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  title, value, icon: Icon, description, alert, warning, valueClassName, href,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  description?: string;
  alert?: boolean;
  warning?: boolean;
  valueClassName?: string;
  href?: string;
}) {
  const card = (
    <Card className={`transition-colors ${href ? "cursor-pointer hover:bg-muted/30" : ""} ${alert && value !== "0" ? "border-destructive/50 bg-destructive/5 hover:bg-destructive/10" : ""} ${warning && value !== "0" ? "border-amber-400/50 bg-amber-50/50 hover:bg-amber-50" : ""}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`w-4 h-4 ${alert && value !== "0" ? "text-destructive" : warning && value !== "0" ? "text-amber-600" : "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className={`font-bold ${valueClassName ?? "text-3xl"} ${alert && value !== "0" ? "text-destructive" : ""}`}>
          {value}
        </div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href}>{card}</Link>;
  return card;
}
