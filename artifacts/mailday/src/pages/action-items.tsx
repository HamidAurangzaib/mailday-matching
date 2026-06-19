import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ShieldAlert } from "lucide-react";
import {
  useGetStatsSummary,
  useGetUnmatchedChildren,
  customFetch,
} from "@workspace/api-client-react";
import type { ChildWithParent } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { ChildSheet } from "@/components/child-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle, Clock, AlertTriangle, CheckCircle2, ChevronRight,
  ClipboardList, FileCheck2, Send, Check, ListChecks, UserMinus, Mailbox,
} from "lucide-react";

interface FlaggedChild {
  id: string;
  child_first_name: string;
  age: number | null;
  tier: string;
  parent_id: string;
}

interface StatsData {
  urgent_guarantee: number;
  warning_guarantee: number;
  overdue_onboarding_list: { id: string; name: string; email: string; days_since_joined: number | null }[];
}

interface GakFund {
  pending_count: number;
  receipts_pending: number;
  tremendous_pending?: number;
}

interface GakTask {
  id: string;
  title: string;
  description?: string | null;
  completed: boolean;
  created_at: string;
}

interface CancellationTask {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  cancellation_id: string;
  parent_name: string;
  tier: string | null;
  cancellation_date: string | null;
  completed: boolean;
  created_at: string;
}

interface SaveOpp {
  id: string;
  cancellation_date: string;
  tier: string;
  parent_first_name: string | null;
  parent_last_name: string | null;
  parent_email: string | null;
  cancellation_reason_category: string | null;
}

type LifecycleTaskType =
  | "incomplete_onboarding_followup"
  | "contact_guarantee_breach"
  | "chase_address_confirmation"
  | "review_tier_mismatch"
  | "send_poppy_card"
  | "coppa_deletion_pending";

interface LifecycleTask {
  id: string;
  type: LifecycleTaskType | string;
  title: string;
  description: string | null;
  related_entity_id: string | null;
  related_entity_type: string | null;
  completed: boolean;
  created_at: string;
}

const LIFECYCLE_GROUPS: {
  key: LifecycleTaskType;
  title: string;
  level: Level;
  icon: React.ComponentType<{ className?: string }>;
  actionLabel: string;
}[] = [
  { key: "contact_guarantee_breach",       title: "Guarantee Breach Contact",     level: "urgent",  icon: AlertCircle,   actionLabel: "Done" },
  { key: "chase_address_confirmation",     title: "Chase Address Confirmation",   level: "warning", icon: Mailbox,       actionLabel: "Done" },
  { key: "review_tier_mismatch",           title: "Tier Mismatch — Review Pair",  level: "warning", icon: AlertTriangle, actionLabel: "Done" },
  { key: "send_poppy_card",                title: "Poppy Cards to Mail",          level: "neutral", icon: Send,          actionLabel: "Mailed" },
  { key: "incomplete_onboarding_followup", title: "Onboarding Follow-up",         level: "warning", icon: ListChecks,    actionLabel: "Done" },
  { key: "coppa_deletion_pending",         title: "COPPA Deletion Pending",       level: "neutral", icon: ShieldAlert,   actionLabel: "Done" },
];

type Level = "urgent" | "warning" | "neutral";

function ActionSection({ title, count, level, children }: {
  title: string; count: number; level: Level; children: React.ReactNode;
}) {
  const header = {
    urgent: "bg-destructive/5 border-b-destructive/20 text-destructive",
    warning: "bg-amber-50 border-b-amber-200 text-amber-800",
    neutral: "bg-muted/30 text-foreground",
  }[level];
  const badge = {
    urgent: "bg-destructive text-white",
    warning: "bg-amber-500 text-white",
    neutral: "bg-foreground text-background",
  }[level];

  return (
    <div className="rounded-xl border overflow-hidden">
      <div className={`px-4 py-2.5 flex items-center justify-between border-b ${header}`}>
        <span className="text-sm font-semibold">{title}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badge}`}>{count}</span>
      </div>
      <div className="divide-y divide-border bg-white">{children}</div>
    </div>
  );
}

function ActionRow({ level, icon: Icon, label, detail, href, onClick, action, onAction, actionPending }: {
  level: Level;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: string;
  href?: string;
  onClick?: () => void;
  action?: string;
  onAction?: () => void;
  actionPending?: boolean;
}) {
  const iconColor = {
    urgent: "text-destructive",
    warning: "text-amber-500",
    neutral: "text-muted-foreground",
  }[level];

  const inner = (
    <div
      className={`px-4 py-3 flex items-center gap-3 transition-colors ${onClick || (href && !href.startsWith("mailto:")) ? "hover:bg-muted/20 cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <Icon className={`w-4 h-4 shrink-0 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {detail && <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>}
      </div>
      {onAction && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 h-9 min-w-[80px] text-xs gap-1"
          disabled={actionPending}
          onClick={(e) => { e.stopPropagation(); onAction(); }}
        >
          <Check className="w-3 h-3" />{action}
        </Button>
      )}
      {!onAction && (onClick || href) && (
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      )}
    </div>
  );

  if (href?.startsWith("mailto:")) return <a href={href}>{inner}</a>;
  if (href) return <Link href={href}>{inner}</Link>;
  return <div>{inner}</div>;
}

export default function ActionItems() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: rawStats, isLoading: statsLoading } = useGetStatsSummary();
  const stats = rawStats as StatsData | undefined;

  const { data: unmatchedData, isLoading: queueLoading } = useGetUnmatchedChildren();

  const { data: gakFund } = useQuery<GakFund>({
    queryKey: ["gak-fund-action-items"],
    queryFn: () => customFetch<GakFund>("/api/give-a-key/fund"),
    refetchInterval: 60000,
  });

  const { data: gakTasks } = useQuery<GakTask[]>({
    queryKey: ["gak-tasks-list"],
    queryFn: () => customFetch<GakTask[]>("/api/give-a-key/tasks"),
    refetchInterval: 60000,
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/give-a-key/tasks/${id}/complete`, { method: "PATCH" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gak-tasks-list"] });
      void queryClient.invalidateQueries({ queryKey: ["action-items-count"] });
    },
  });

  const { data: flaggedChildren } = useQuery<FlaggedChild[]>({
    queryKey: ["flagged-children-action-items"],
    queryFn: () => customFetch<FlaggedChild[]>("/api/children/flagged"),
    enabled: isAdmin,
    refetchInterval: 60000,
    retry: false,
  });

  const { data: cancellationTasks } = useQuery<CancellationTask[]>({
    queryKey: ["cancellation-tasks-action-items"],
    queryFn: () => customFetch<CancellationTask[]>("/api/cancellations/tasks"),
    enabled: isAdmin,
    refetchInterval: 60000,
    retry: false,
  });

  const { data: saveOpportunities } = useQuery<SaveOpp[]>({
    queryKey: ["cancellation-save-opps-action-items"],
    queryFn: () => customFetch<SaveOpp[]>("/api/cancellations?view=save_opportunities"),
    enabled: isAdmin,
    refetchInterval: 60000,
    retry: false,
  });

  const completeCancelTaskMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/cancellations/tasks/${id}/complete`, { method: "PATCH" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cancellation-tasks-action-items"] });
      void queryClient.invalidateQueries({ queryKey: ["action-items-count"] });
    },
  });

  const { data: lifecycleTasks } = useQuery<LifecycleTask[]>({
    queryKey: ["lifecycle-tasks-action-items"],
    queryFn: () => customFetch<LifecycleTask[]>("/api/lifecycle-tasks"),
    refetchInterval: 60000,
    retry: false,
  });

  const completeLifecycleTaskMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/lifecycle-tasks/${id}/complete`, { method: "PATCH" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lifecycle-tasks-action-items"] });
      void queryClient.invalidateQueries({ queryKey: ["action-items-count"] });
    },
  });

  if (statsLoading || queueLoading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const allChildren: ChildWithParent[] = [
    ...(unmatchedData?.core_pool ?? []),
    ...(unmatchedData?.minis_pool ?? []),
  ];

  const urgentChildren = allChildren.filter((c) => c.guarantee_status === "urgent");
  const warningChildren = allChildren.filter((c) => c.guarantee_status === "warning");
  const overdueList = stats?.overdue_onboarding_list ?? [];
  const openTasks = (gakTasks ?? []).filter((t) => !t.completed);
  const pendingApps = gakFund?.pending_count ?? 0;
  const receiptsPending = gakFund?.receipts_pending ?? 0;
  const tremendousPending = isAdmin ? (gakFund?.tremendous_pending ?? 0) : 0;

  const openCancelTasks = cancellationTasks ?? [];
  const oldSaveOpps = (saveOpportunities ?? []).filter((c) => {
    const days = Math.floor((Date.now() - new Date(c.cancellation_date + "T00:00:00").getTime()) / 86400000);
    return days >= 7;
  });
  const flagged = flaggedChildren ?? [];

  const lifecycleByType = new Map<string, LifecycleTask[]>();
  for (const t of lifecycleTasks ?? []) {
    if (t.completed) continue;
    const arr = lifecycleByType.get(t.type) ?? [];
    arr.push(t);
    lifecycleByType.set(t.type, arr);
  }
  const lifecycleTotal = Array.from(lifecycleByType.values()).reduce((sum, arr) => sum + arr.length, 0);

  const totalCount =
    urgentChildren.length +
    warningChildren.length +
    overdueList.length +
    openTasks.length +
    pendingApps +
    receiptsPending +
    tremendousPending +
    lifecycleTotal +
    (isAdmin ? openCancelTasks.length + oldSaveOpps.length + flagged.length : 0);

  const allClear = totalCount === 0;

  const openChild = (id: string) => {
    setSelectedChildId(id);
    setSheetOpen(true);
  };

  const openParentById = (parentId: string) => {
    setSheetOpen(false);
    setSelectedChildId(null);
    setTimeout(() => setLocation(`/parents?id=${parentId}`), 250);
  };

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-heading font-bold">Action Items</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {allClear
            ? "Nothing outstanding — you're all caught up."
            : `${totalCount} ${totalCount === 1 ? "item needs" : "items need"} your attention`}
        </p>
      </div>

      {allClear && (
        <div className="rounded-xl border border-green-200 bg-green-50/60 px-5 py-10 flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
          <div>
            <div className="font-semibold text-green-800 text-lg">All clear!</div>
            <p className="text-sm text-green-700 mt-1">
              No outstanding items across matching, onboarding, or Give a Key.
            </p>
          </div>
        </div>
      )}

      {urgentChildren.length > 0 && (
        <ActionSection title="Urgent Guarantees" count={urgentChildren.length} level="urgent">
          {urgentChildren.map((child) => (
            <ActionRow
              key={child.id}
              level="urgent"
              icon={AlertCircle}
              label={`${child.child_first_name} (${child.age ?? "?"}) — ${child.tier}`}
              detail={`${child.days_waiting ?? "?"} days waiting — 21-day guarantee reached, billing pauses soon`}
              onClick={() => openChild(child.id)}
              action="View"
            />
          ))}
        </ActionSection>
      )}

      {warningChildren.length > 0 && (
        <ActionSection title="Approaching Guarantee" count={warningChildren.length} level="warning">
          {warningChildren.map((child) => (
            <ActionRow
              key={child.id}
              level="warning"
              icon={Clock}
              label={`${child.child_first_name} (${child.age ?? "?"}) — ${child.tier}`}
              detail={`${child.days_waiting ?? "?"} days waiting — ${21 - (child.days_waiting ?? 0)} days until guarantee deadline`}
              onClick={() => openChild(child.id)}
              action="View"
            />
          ))}
        </ActionSection>
      )}

      {overdueList.length > 0 && (
        <ActionSection title="Overdue Onboarding" count={overdueList.length} level="warning">
          {overdueList.map((p) => (
            <ActionRow
              key={p.id}
              level="warning"
              icon={AlertTriangle}
              label={p.name}
              detail={
                p.days_since_joined != null
                  ? `Signed up ${p.days_since_joined} days ago — no child added yet`
                  : "Signed up — no child added yet"
              }
              href={`mailto:${p.email}`}
              action="Email"
            />
          ))}
        </ActionSection>
      )}

      {openTasks.length > 0 && (
        <ActionSection title="Give a Key Tasks" count={openTasks.length} level="neutral">
          {openTasks.map((task) => (
            <ActionRow
              key={task.id}
              level="neutral"
              icon={ListChecks}
              label={task.title}
              detail={task.description ?? undefined}
              href="/give-a-key/tasks"
              action="Mark done"
              onAction={() => completeMutation.mutate(task.id)}
              actionPending={completeMutation.isPending}
            />
          ))}
        </ActionSection>
      )}

      {LIFECYCLE_GROUPS.map((group) => {
        const tasks = lifecycleByType.get(group.key) ?? [];
        if (tasks.length === 0) return null;
        return (
          <ActionSection key={group.key} title={group.title} count={tasks.length} level={group.level}>
            {tasks.map((task) => (
              <ActionRow
                key={task.id}
                level={group.level}
                icon={group.icon}
                label={task.title}
                detail={task.description ?? undefined}
                action={group.actionLabel}
                onAction={() => completeLifecycleTaskMutation.mutate(task.id)}
                actionPending={completeLifecycleTaskMutation.isPending}
              />
            ))}
          </ActionSection>
        );
      })}

      {(pendingApps > 0 || receiptsPending > 0 || tremendousPending > 0) && (
        <ActionSection
          title="Give a Key — Admin"
          count={pendingApps + receiptsPending + tremendousPending}
          level="neutral"
        >
          {pendingApps > 0 && (
            <ActionRow
              level="neutral"
              icon={ClipboardList}
              label={`${pendingApps} pending ${pendingApps === 1 ? "application" : "applications"}`}
              detail="Awaiting review"
              href="/give-a-key/applications"
              action="Review"
            />
          )}
          {receiptsPending > 0 && (
            <ActionRow
              level="neutral"
              icon={FileCheck2}
              label={`${receiptsPending} ${receiptsPending === 1 ? "receipt" : "receipts"} to verify`}
              detail="PO Box receipts awaiting verification"
              href="/give-a-key/receipts"
              action="Verify"
            />
          )}
          {tremendousPending > 0 && (
            <ActionRow
              level="neutral"
              icon={Send}
              label={`${tremendousPending} Tremendous ${tremendousPending === 1 ? "card" : "cards"} to send`}
              detail="Approved applicants waiting on their reward card"
              href="/give-a-key/applications"
              action="Send"
            />
          )}
        </ActionSection>
      )}

      {isAdmin && flagged.length > 0 && (
        <ActionSection title="Safety Flags" count={flagged.length} level="urgent">
          {flagged.map((child) => (
            <ActionRow
              key={child.id}
              level="urgent"
              icon={ShieldAlert}
              label={`${child.child_first_name}${child.age != null ? ` (${child.age})` : ""} — ${child.tier}`}
              detail="Safety flag is set on this child's profile — review and take action"
              onClick={() => openChild(child.id)}
              action="View"
            />
          ))}
        </ActionSection>
      )}

      {isAdmin && (openCancelTasks.length > 0 || oldSaveOpps.length > 0) && (
        <ActionSection title="Cancellations" count={openCancelTasks.length + oldSaveOpps.length} level="warning">
          {openCancelTasks.map((task) => (
            <ActionRow
              key={task.id}
              level="warning"
              icon={UserMinus}
              label={task.title}
              detail={task.description ?? undefined}
              href={`/cancellations?id=${task.cancellation_id}`}
              action="Review"
            />
          ))}
          {oldSaveOpps.map((c) => {
            const days = Math.floor((Date.now() - new Date(c.cancellation_date + "T00:00:00").getTime()) / 86400000);
            const name = `${c.parent_first_name ?? ""} ${c.parent_last_name ?? ""}`.trim() || c.parent_email || "Unknown";
            return (
              <ActionRow
                key={c.id}
                level="warning"
                icon={Clock}
                label={`Save window closing — ${name}`}
                detail={`cancelled ${days} days ago${c.cancellation_reason_category ? ` · ${c.cancellation_reason_category}` : ""} · ${c.tier}`}
                href={`/cancellations?id=${c.id}`}
                action="Log Save"
              />
            );
          })}
        </ActionSection>
      )}

      <ChildSheet
        childId={selectedChildId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        isAdmin={isAdmin}
        onOpenParent={openParentById}
      />
    </div>
  );
}
