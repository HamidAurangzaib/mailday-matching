import { useListParents } from "@workspace/api-client-react";
import type { Parent } from "@workspace/api-client-react";
import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { HealthDot, HealthFilterBadge } from "@/components/health-dot";
import { computeParentHealth } from "@/lib/health";
import type { HealthStatus } from "@/lib/health";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ParentSheet } from "@/components/parent-sheet";
import { ChildSheet } from "@/components/child-sheet";

type ParentWithHealth = Parent & { last_email_open_date?: string | null };

export default function Parents() {
  const { data: rawParents, isLoading } = useListParents();
  const parents = rawParents as ParentWithHealth[] | undefined;
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState<HealthStatus | "all">("all");
  const searchStr = useSearch();

  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const idFromUrl = new URLSearchParams(searchStr).get("id");
  useEffect(() => {
    if (idFromUrl) setSelectedParentId(idFromUrl);
  }, [idFromUrl]);

  const openParent = (id: string) => {
    setSelectedChildId(null);
    setSelectedParentId(id);
  };

  const openChild = (id: string) => {
    setSelectedParentId(null);
    // small delay so first sheet animates out before second opens
    setTimeout(() => setSelectedChildId(id), 200);
  };

  const q = search.toLowerCase();
  const bySearch = q
    ? parents?.filter((p) =>
        p.first_name?.toLowerCase().includes(q) ||
        p.last_name?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q)
      )
    : parents;
  const filtered =
    healthFilter === "all"
      ? bySearch
      : bySearch?.filter((p) => computeParentHealth(p) === healthFilter);

  const healthCounts = {
    green:  bySearch?.filter((p) => computeParentHealth(p) === "green").length  ?? 0,
    yellow: bySearch?.filter((p) => computeParentHealth(p) === "yellow").length ?? 0,
    red:    bySearch?.filter((p) => computeParentHealth(p) === "red").length    ?? 0,
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-heading font-bold flex-1">Parents Directory</h1>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
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
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Tier & Status</TableHead>
              <TableHead>Join Date</TableHead>
              {isAdmin && <TableHead>Address & Notes</TableHead>}
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={isAdmin ? 6 : 5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5} className="h-24 text-center text-muted-foreground">
                  No parents found.
                </TableCell>
              </TableRow>
            ) : (
              filtered?.map((parent) => (
                <TableRow
                  key={parent.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => openParent(parent.id)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <HealthDot status={computeParentHealth(parent)} />
                      <span>{parent.first_name} {parent.last_name}</span>
                      {parent.at_risk && (
                        <Badge variant="destructive" className="text-[10px]">At Risk</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{parent.email}</div>
                    {parent.phone && <div className="text-xs text-muted-foreground">{parent.phone}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant="outline">{parent.membership_tier || "Unknown"}</Badge>
                      <span className="text-xs text-muted-foreground">{parent.subscription_status}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {parent.join_date ? format(new Date(parent.join_date), "MMM d, yyyy") : "Unknown"}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <div className="max-w-[250px] space-y-1">
                        {parent.mailing_address && (
                          <div className="text-xs truncate" title={parent.mailing_address}>
                            {parent.mailing_address}
                          </div>
                        )}
                        {parent.internal_notes && (
                          <div className="text-xs text-muted-foreground truncate" title={parent.internal_notes}>
                            📝 {parent.internal_notes}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  )}
                  <TableCell>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ParentSheet
        parentId={selectedParentId}
        open={!!selectedParentId}
        onClose={() => setSelectedParentId(null)}
        isAdmin={isAdmin}
        onOpenChild={openChild}
      />

      <ChildSheet
        childId={selectedChildId}
        open={!!selectedChildId}
        onClose={() => setSelectedChildId(null)}
        isAdmin={isAdmin}
        onOpenParent={openParent}
      />
    </div>
  );
}
