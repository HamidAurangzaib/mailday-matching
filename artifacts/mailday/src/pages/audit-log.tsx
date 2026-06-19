import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Activity, Filter, RefreshCw, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { format, parseISO } from "date-fns";

interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_ip: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  payload_before: unknown;
  payload_after: unknown;
  metadata: unknown;
  created_at: string;
}

interface AuditLogResponse {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
}

interface FilterValues {
  actions: string[];
  entity_types: string[];
}

const PAGE_SIZE = 50;

// Colour-code by entity type for quick scanning.
const ENTITY_COLORS: Record<string, string> = {
  parent: "bg-blue-100 text-blue-800",
  child: "bg-green-100 text-green-800",
  match: "bg-purple-100 text-purple-800",
  lifecycle_task: "bg-amber-100 text-amber-800",
  email_template: "bg-pink-100 text-pink-800",
  gak_application: "bg-orange-100 text-orange-800",
};

export default function AuditLogPage() {
  const [actionFilter, setActionFilter] = useState<string>("");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("");
  const [actorFilter, setActorFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [detailRow, setDetailRow] = useState<AuditRow | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (actionFilter) p.set("action", actionFilter);
    if (entityTypeFilter) p.set("entity_type", entityTypeFilter);
    if (actorFilter) p.set("actor", actorFilter);
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(offset));
    return p.toString();
  }, [actionFilter, entityTypeFilter, actorFilter, dateFrom, dateTo, offset]);

  const { data, isLoading, isFetching, refetch } = useQuery<AuditLogResponse>({
    queryKey: ["audit-log", params],
    queryFn: () => customFetch<AuditLogResponse>(`/api/admin/audit-log?${params}`),
  });

  const { data: filters } = useQuery<FilterValues>({
    queryKey: ["audit-log-filters"],
    queryFn: () => customFetch<FilterValues>("/api/admin/audit-log/filters"),
  });

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);

  const clearFilters = () => {
    setActionFilter("");
    setEntityTypeFilter("");
    setActorFilter("");
    setDateFrom("");
    setDateTo("");
    setOffset(0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-black flex items-center gap-2">
            <Activity className="w-7 h-7" />
            Audit Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only record of who did what. Useful for COPPA compliance and answering "who changed that?".
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <Label htmlFor="action-filter" className="text-xs">Action</Label>
            <Select
              value={actionFilter || "all"}
              onValueChange={(v) => { setActionFilter(v === "all" ? "" : v); setOffset(0); }}
            >
              <SelectTrigger id="action-filter">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {(filters?.actions ?? []).map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="entity-type-filter" className="text-xs">Entity</Label>
            <Select
              value={entityTypeFilter || "all"}
              onValueChange={(v) => { setEntityTypeFilter(v === "all" ? "" : v); setOffset(0); }}
            >
              <SelectTrigger id="entity-type-filter">
                <SelectValue placeholder="All entities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All entities</SelectItem>
                {(filters?.entity_types ?? []).map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="actor-filter" className="text-xs">Actor email contains</Label>
            <Input
              id="actor-filter"
              placeholder="e.g. courtney@"
              value={actorFilter}
              onChange={(e) => { setActorFilter(e.target.value); setOffset(0); }}
            />
          </div>
          <div>
            <Label htmlFor="date-from" className="text-xs">From</Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
            />
          </div>
          <div>
            <Label htmlFor="date-to" className="text-xs">To</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
            />
          </div>
          <div className="md:col-span-3 lg:col-span-5 flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
            <p className="text-xs text-muted-foreground">
              {isLoading ? "Loading…" : `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-6">Loading audit log…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6">No entries match these filters.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left py-2 px-4">When</th>
                  <th className="text-left py-2 px-4">Actor</th>
                  <th className="text-left py-2 px-4">Action</th>
                  <th className="text-left py-2 px-4">Entity</th>
                  <th className="text-left py-2 px-4">Entity ID</th>
                  <th className="text-right py-2 px-4">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 px-4 whitespace-nowrap text-muted-foreground text-xs">
                      {format(parseISO(row.created_at), "MMM d, yyyy h:mm:ss a")}
                    </td>
                    <td className="py-2 px-4 text-xs">
                      {row.actor_email ?? <span className="text-muted-foreground italic">system</span>}
                    </td>
                    <td className="py-2 px-4">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{row.action}</code>
                    </td>
                    <td className="py-2 px-4">
                      <Badge variant="outline" className={ENTITY_COLORS[row.entity_type] ?? ""}>
                        {row.entity_type}
                      </Badge>
                    </td>
                    <td className="py-2 px-4">
                      <code className="text-xs text-muted-foreground">{row.entity_id.slice(0, 8)}…</code>
                    </td>
                    <td className="py-2 px-4 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetailRow(row)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0 || isFetching}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          <p className="text-xs text-muted-foreground">
            Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(total / PAGE_SIZE)}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total || isFetching}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      <Dialog open={detailRow !== null} onOpenChange={(o) => !o && setDetailRow(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailRow?.action}</DialogTitle>
            <DialogDescription>
              {detailRow?.entity_type} · {detailRow?.entity_id}
            </DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-muted-foreground">When: </span><strong>{format(parseISO(detailRow.created_at), "PPPP p")}</strong></div>
                <div><span className="text-muted-foreground">Actor: </span><strong>{detailRow.actor_email ?? "system"}</strong></div>
                <div><span className="text-muted-foreground">IP: </span><strong>{detailRow.actor_ip ?? "—"}</strong></div>
                <div><span className="text-muted-foreground">Actor ID: </span><strong className="font-mono">{detailRow.actor_id ?? "—"}</strong></div>
              </div>
              {detailRow.metadata ? (
                <div>
                  <Label className="text-xs">Metadata</Label>
                  <pre className="text-xs bg-muted/30 p-3 rounded border overflow-x-auto">
                    {JSON.stringify(detailRow.metadata, null, 2)}
                  </pre>
                </div>
              ) : null}
              {detailRow.payload_before ? (
                <div>
                  <Label className="text-xs">Before</Label>
                  <pre className="text-xs bg-muted/30 p-3 rounded border overflow-x-auto">
                    {JSON.stringify(detailRow.payload_before, null, 2)}
                  </pre>
                </div>
              ) : null}
              {detailRow.payload_after ? (
                <div>
                  <Label className="text-xs">After</Label>
                  <pre className="text-xs bg-muted/30 p-3 rounded border overflow-x-auto">
                    {JSON.stringify(detailRow.payload_after, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
