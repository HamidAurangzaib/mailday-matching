import { useState } from "react";
import { useGetUnmatchedChildren } from "@workspace/api-client-react";
import type { ChildWithParent } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Link, useSearch, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, Sparkles } from "lucide-react";
import { ChildSheet } from "@/components/child-sheet";
import { HealthDot } from "@/components/health-dot";
import { computeChildHealth } from "@/lib/health";

const TIER_COLORS: Record<string, string> = {
  "Core":             "bg-indigo-100 text-indigo-800 border-indigo-200",
  "Minis":            "bg-purple-100 text-purple-800 border-purple-200",
  "Homeschool Core":  "bg-teal-100 text-teal-800 border-teal-200",
  "Homeschool Minis": "bg-emerald-100 text-emerald-800 border-emerald-200",
};

type HealthFilter = "all" | "warning" | "urgent";

export default function Queue() {
  const { data, isLoading } = useGetUnmatchedChildren();
  const { user } = useAuth();
  const searchStr = useSearch();
  const rematchOnly = new URLSearchParams(searchStr).get("rematch") === "1";
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState("core");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const allMinis = (data?.minis_pool || []).filter(c =>
    rematchOnly ? (c as ChildWithParent & { match_status?: string }).match_status === "Rematch Requested" : true
  );
  const allCore = (data?.core_pool || []).filter(c =>
    rematchOnly ? (c as ChildWithParent & { match_status?: string }).match_status === "Rematch Requested" : true
  );

  const applyFilter = (pool: ChildWithParent[]) => {
    if (healthFilter === "urgent") return pool.filter(c => c.guarantee_status === "urgent");
    if (healthFilter === "warning") return pool.filter(c => c.guarantee_status === "warning");
    return pool;
  };

  const minis = applyFilter(allMinis);
  const core = applyFilter(allCore);

  const toggleFilter = (f: HealthFilter) =>
    setHealthFilter(prev => (prev === f ? "all" : f));

  const openChild = (id: string) => {
    setSelectedChildId(id);
    setSheetOpen(true);
  };

  const openParentById = (parentId: string) => {
    setSheetOpen(false);
    setSelectedChildId(null);
    setTimeout(() => setLocation(`/parents?id=${parentId}`), 250);
  };

  const isAdmin = user?.role === "admin";
  const rematchCount = allMinis.length + allCore.length;
  const totalCount = rematchOnly
    ? rematchCount
    : (data?.core_pool?.length || 0) + (data?.minis_pool?.length || 0);
  const filteredCount = core.length + minis.length;
  const warningCount = data?.warning_count || 0;
  const urgentCount = data?.urgent_count || 0;

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">
            {rematchOnly ? "Rematch Queue" : "Unmatched Queue"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rematchOnly && (
              <>
                {rematchCount} {rematchCount === 1 ? "child" : "children"} waiting for a rematch —{" "}
                <Link href="/queue" className="underline hover:no-underline">view full queue</Link>
              </>
            )}
            {!rematchOnly && (
              healthFilter !== "all"
                ? `Showing ${filteredCount} of ${totalCount} ${totalCount === 1 ? "child" : "children"} — `
                : `${totalCount} ${totalCount === 1 ? "child" : "children"} waiting to be matched`
            )}
            {!rematchOnly && healthFilter !== "all" && (
              <button onClick={() => setHealthFilter("all")} className="underline hover:no-underline cursor-pointer">
                clear filter
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => toggleFilter("warning")}
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors cursor-pointer
              ${healthFilter === "warning"
                ? "bg-accent text-accent-foreground border-accent"
                : "text-accent-foreground bg-accent/20 border-accent hover:bg-accent/30"
              }`}
          >
            {warningCount} Warning
          </button>
          <button
            onClick={() => toggleFilter("urgent")}
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors cursor-pointer
              ${healthFilter === "urgent"
                ? "bg-destructive text-destructive-foreground border-destructive"
                : "text-destructive bg-destructive/10 border-destructive hover:bg-destructive/20"
              }`}
          >
            {urgentCount} Urgent
          </button>
          {isAdmin && totalCount >= 2 && (
            <Link href="/matching">
              <Button className="gap-2">
                <Sparkles className="w-4 h-4" />
                Start Match Session
              </Button>
            </Link>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="core">Core (6-12) ({core.length})</TabsTrigger>
          <TabsTrigger value="minis">Minis (3-6) ({minis.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="core" className="mt-6">
          <ChildGrid children={core} onOpen={openChild} healthFilter={healthFilter} />
        </TabsContent>
        <TabsContent value="minis" className="mt-6">
          <ChildGrid children={minis} onOpen={openChild} healthFilter={healthFilter} />
        </TabsContent>
      </Tabs>

      <ChildSheet
        childId={selectedChildId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        isAdmin={user?.role === "admin"}
        onOpenParent={openParentById}
      />
    </div>
  );
}

function ChildGrid({ children, onOpen, healthFilter }: { children: ChildWithParent[]; onOpen: (id: string) => void; healthFilter: HealthFilter }) {
  if (children.length === 0) {
    const emptyMsg =
      healthFilter === "urgent" ? "No urgent children in this pool." :
      healthFilter === "warning" ? "No warning children in this pool." :
      "No children in this queue.";
    return (
      <div className="text-center p-12 border rounded-xl bg-muted/20">
        <p className="text-muted-foreground">{emptyMsg}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {children.map((child) => (
        <ChildCard key={child.id} child={child} onOpen={onOpen} />
      ))}
    </div>
  );
}

function ChildCard({ child, onOpen }: { child: ChildWithParent; onOpen: (id: string) => void }) {
  const isUrgent = child.guarantee_status === "urgent";
  const isWarning = child.guarantee_status === "warning";
  const tierColor = TIER_COLORS[child.tier] ?? "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <Card
      className={`relative overflow-hidden transition-all hover:shadow-md cursor-pointer hover:scale-[1.01]
        ${isUrgent ? "border-destructive/50 ring-1 ring-destructive/20" : ""}
        ${isWarning ? "border-accent/50 ring-1 ring-accent/20" : ""}
      `}
      onClick={() => onOpen(child.id)}
    >
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <HealthDot status={computeChildHealth(child)} size="md" />
              {child.child_first_name}
              <span className="text-sm font-normal text-muted-foreground">({child.age})</span>
            </CardTitle>
            <div className="flex items-center gap-1.5 flex-wrap">
              {child.parent?.state && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                  {child.parent.state}
                </span>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${tierColor}`}>
                {child.tier}
              </span>
            </div>
          </div>

          {child.days_waiting != null && (
            <Badge
              variant={isUrgent ? "destructive" : isWarning ? "default" : "secondary"}
              className={isWarning ? "bg-accent hover:bg-accent/80 text-accent-foreground" : ""}
            >
              {isUrgent && <AlertTriangle className="w-3 h-3 mr-1" />}
              {!isUrgent && isWarning && <Clock className="w-3 h-3 mr-1" />}
              {child.days_waiting} days
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isUrgent && (
          <div className="mb-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 px-2 py-1 rounded inline-block">
            Day-21 guarantee breach — outreach automated by daily cron
          </div>
        )}
        {child.billing_paused && (
          <div className="mb-4 text-xs font-medium text-destructive bg-destructive/10 px-2 py-1 rounded inline-block">
            Billing Paused
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-2">
          {child.interests?.slice(0, 5).map((interest: string, i: number) => (
            <Badge key={i} variant="outline" className="bg-muted/50">
              {interest}
            </Badge>
          ))}
          {(child.interests?.length || 0) > 5 && (
            <Badge variant="outline" className="bg-muted/50">
              +{(child.interests?.length || 0) - 5} more
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-3">Click to view full profile →</p>
      </CardContent>
    </Card>
  );
}
