import { useListChildren } from "@workspace/api-client-react";
import type { Child } from "@workspace/api-client-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ChevronRight, Clock, Search, AlertTriangle } from "lucide-react";
import { ChildSheet } from "@/components/child-sheet";
import { ParentSheet } from "@/components/parent-sheet";
import { HealthDot, HealthFilterBadge } from "@/components/health-dot";
import { computeChildHealth } from "@/lib/health";
import type { HealthStatus } from "@/lib/health";

type ChildWithParent = Child & {
  parent: {
    id: string; first_name: string; last_name: string; email: string;
    give_a_key_recipient?: boolean | null;
    pause_type?: "voluntary" | "guarantee" | null;
  };
  days_waiting?: number | null;
  guarantee_status?: "ok" | "warning" | "urgent" | null;
  active_match?: { id: string; match_status: string; tier_mismatch_flagged: boolean | null } | null;
};

const INTEREST_COLORS = [
  "bg-blue-100 text-blue-800", "bg-purple-100 text-purple-800",
  "bg-green-100 text-green-800", "bg-orange-100 text-orange-800",
  "bg-pink-100 text-pink-800", "bg-teal-100 text-teal-800",
];

function interestColor(interest: string): string {
  let hash = 0;
  for (let i = 0; i < interest.length; i++) hash = interest.charCodeAt(i) + ((hash << 5) - hash);
  return INTEREST_COLORS[Math.abs(hash) % INTEREST_COLORS.length];
}

function InterestTags({ interests, max = 4 }: { interests: string[]; max?: number }) {
  if (!interests || interests.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = interests.slice(0, max);
  const overflow = interests.length - max;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {shown.map((i) => (
        <span key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${interestColor(i)}`}>{i}</span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600" title={interests.slice(max).join(", ")}>
          +{overflow}
        </span>
      )}
    </div>
  );
}

const MATCH_STATUS_STYLES: Record<string, { badge: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  Matched:             { badge: "bg-green-500 hover:bg-green-600 text-white border-transparent", variant: "default" },
  Unmatched:           { badge: "", variant: "secondary" },
  "Rematch Requested": { badge: "bg-orange-100 text-orange-800 border-orange-200", variant: "outline" },
  Paused:              { badge: "bg-yellow-100 text-yellow-800 border-yellow-200", variant: "outline" },
  Cancelled:           { badge: "bg-red-100 text-red-800 border-red-200", variant: "outline" },
};

export default function Children() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [healthFilter, setHealthFilter] = useState<HealthStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

  // "give_a_key" is a virtual client-side filter — fetch all, then filter
  const isGAKFilter = statusFilter === "give_a_key";
  const { data: children, isLoading } = useListChildren({
    match_status: !isGAKFilter && statusFilter !== "all" ? statusFilter : undefined,
  });

  const typedAll = children as ChildWithParent[] | undefined;
  const typedByStatus = isGAKFilter
    ? typedAll?.filter((c) => c.parent.give_a_key_recipient)
    : typedAll;
  const q = search.toLowerCase();
  const typedBySearch = q
    ? typedByStatus?.filter((c) =>
        c.child_first_name?.toLowerCase().includes(q) ||
        c.parent.first_name?.toLowerCase().includes(q) ||
        c.parent.last_name?.toLowerCase().includes(q)
      )
    : typedByStatus;
  const typedChildren =
    healthFilter === "all"
      ? typedBySearch
      : typedBySearch?.filter((c) => computeChildHealth(c) === healthFilter);

  const healthCounts = {
    green:  typedBySearch?.filter((c) => computeChildHealth(c) === "green").length  ?? 0,
    yellow: typedBySearch?.filter((c) => computeChildHealth(c) === "yellow").length ?? 0,
    red:    typedBySearch?.filter((c) => computeChildHealth(c) === "red").length    ?? 0,
  };

  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const openChild = (id: string) => {
    setSelectedParentId(null);
    setSelectedChildId(id);
  };

  const openParent = (id: string) => {
    setSelectedChildId(null);
    setTimeout(() => setSelectedParentId(id), 200);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl font-heading font-bold flex-1">Children Directory</h1>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Unmatched">Unmatched</SelectItem>
            <SelectItem value="Matched">Matched</SelectItem>
            <SelectItem value="Rematch Requested">Rematch Requested</SelectItem>
            <SelectItem value="Paused">Paused</SelectItem>
            <SelectItem value="Cancelled">Cancelled</SelectItem>
            <SelectItem value="give_a_key">Give a Key</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium mr-1">Health:</span>
        <button
          onClick={() => setHealthFilter("all")}
          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${healthFilter === "all" ? "bg-foreground text-background border-foreground" : "bg-muted/40 text-muted-foreground border-border hover:bg-muted/60"}`}
        >
          All
        </button>
        {(["green", "yellow", "red"] as HealthStatus[]).map((s) => (
          <HealthFilterBadge
            key={s}
            status={s}
            active={healthFilter === s}
            count={healthCounts[s]}
            onClick={() => setHealthFilter(healthFilter === s ? "all" : s)}
          />
        ))}
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Child</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Interests</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && <TableHead>Notes</TableHead>}
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={isAdmin ? 8 : 7}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : typedChildren?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 8 : 7} className="h-24 text-center text-muted-foreground">
                  No children found.
                </TableCell>
              </TableRow>
            ) : (
              typedChildren?.map((child) => {
                const s = MATCH_STATUS_STYLES[child.match_status] ?? { badge: "", variant: "outline" as const };
                return (
                  <TableRow
                    key={child.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => openChild(child.id)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <HealthDot status={computeChildHealth(child)} />
                        <span>{child.child_first_name}</span>
                      </div>
                      {child.safety_flag && <Badge variant="destructive" className="ml-2 text-[10px]">Flag</Badge>}
                      {child.parent.give_a_key_recipient && (
                        <Badge className="ml-2 text-[10px] bg-[#DD4B39] hover:bg-[#DD4B39]/90 text-white border-transparent">Give a Key</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{child.age}</span>
                      <span className="text-xs text-muted-foreground ml-1">yrs</span>
                    </TableCell>
                    <TableCell>
                      <div>{child.parent.first_name} {child.parent.last_name}</div>
                      <div className="text-xs text-muted-foreground">{child.parent.email}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{child.tier}</Badge></TableCell>
                    <TableCell className="max-w-[200px]">
                      <InterestTags interests={child.interests ?? []} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={s.variant} className={s.badge}>{child.match_status}</Badge>
                        {child.active_match?.match_status === "Pending" && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-blue-100 text-blue-800 border-blue-200" title="Match created but awaiting both families to confirm their mailing address">
                            Pending Address
                          </span>
                        )}
                        {child.parent.pause_type === "voluntary" && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-purple-100 text-purple-800 border-purple-200" title="Family is on a voluntary pause">
                            On Hold
                          </span>
                        )}
                        {child.active_match?.tier_mismatch_flagged && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-amber-100 text-amber-800 border-amber-200" title="Pen-pal tiers no longer match — review pair">
                            <AlertTriangle className="w-2.5 h-2.5" />Tier Mismatch
                          </span>
                        )}
                        {child.guarantee_status && child.guarantee_status !== "ok" && (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${child.guarantee_status === "urgent" ? "bg-red-100 text-red-800 border-red-200" : "bg-yellow-100 text-yellow-800 border-yellow-200"}`}>
                            <Clock className="w-2.5 h-2.5" />{child.days_waiting}d
                          </span>
                        )}
                      </div>
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        {child.internal_notes && (
                          <span className="text-xs text-muted-foreground truncate max-w-[160px] block" title={child.internal_notes}>
                            📝 {child.internal_notes}
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell><ChevronRight className="w-4 h-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ChildSheet
        childId={selectedChildId}
        open={!!selectedChildId}
        onClose={() => setSelectedChildId(null)}
        isAdmin={isAdmin}
        onOpenParent={openParent}
        onOpenChild={openChild}
      />

      <ParentSheet
        parentId={selectedParentId}
        open={!!selectedParentId}
        onClose={() => setSelectedParentId(null)}
        isAdmin={isAdmin}
        onOpenChild={openChild}
      />
    </div>
  );
}
