import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format, parseISO, differenceInDays } from "date-fns";
import {
  ChevronDown, ChevronUp, Plus, Download, CheckCircle2,
  AlertTriangle, Package, Mail, XCircle, Clock, Eye,
} from "lucide-react";

interface PackLog {
  id: string;
  month_name: string;
  month_number: number;
  year: number;
  total_active_members_at_send: number;
  core_members_count: number;
  minis_members_count: number;
  homeschool_core_count: number;
  homeschool_minis_count: number;
  delivery_emails_sent: number;
  delivery_emails_failed: number;
  delivery_emails_manually_resent: number;
  emails_opened: number;
  confirmation_status: string;
  confirmed_by?: string;
  confirmed_date?: string;
  notes?: string;
  created_date: string;
  failure_counts: { total: number; unresolved: number };
}

interface PackFailure {
  id: string;
  pack_delivery_log_id: string;
  parent_id?: string;
  child_id?: string;
  failure_reason: string;
  resolved: boolean;
  resolved_date?: string;
  resolved_by?: string;
  resolution_notes?: string;
  created_at: string;
  parents?: { first_name: string; last_name: string; email: string };
  children?: { child_first_name: string };
}

interface PackStats {
  total_months: number;
  total_sent: number;
  total_failures: number;
  success_rate: number;
}

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-slate-100 text-slate-600 border-slate-200",
  Sent: "bg-blue-100 text-blue-700 border-blue-200",
  Partial: "bg-amber-100 text-amber-700 border-amber-200",
  Confirmed: "bg-green-100 text-green-700 border-green-200",
};

function statusBadge(status: string) {
  return <Badge className={`border text-xs font-semibold ${STATUS_COLORS[status] || "bg-gray-100"}`}>{status}</Badge>;
}

function daysSince(dateStr: string) {
  try { return differenceInDays(new Date(), parseISO(dateStr)); } catch { return 0; }
}

function exportCsv(rows: PackLog[], failuresOnly = false) {
  if (failuresOnly) return; // failures CSV needs per-row fetch — handled separately
  const headers = ["Month","Year","Total Members","Core","Minis","HS Core","HS Minis","Sent","Failed","Manually Resent","Status","Confirmed By","Confirmed Date","Notes","Created"];
  const lines = rows.map((r) => [
    r.month_name, r.year, r.total_active_members_at_send, r.core_members_count, r.minis_members_count,
    r.homeschool_core_count, r.homeschool_minis_count, r.delivery_emails_sent, r.delivery_emails_failed,
    r.delivery_emails_manually_resent, r.confirmation_status, r.confirmed_by || "", r.confirmed_date || "", r.notes || "", r.created_date,
  ].map((v) => `"${v}"`).join(","));
  const blob = new Blob([[headers.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "pack-delivery-log.csv"; a.click();
  URL.revokeObjectURL(url);
}

export default function PackDelivery() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";
  const [filterYear, setFilterYear] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedFailure, setSelectedFailure] = useState<PackFailure | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNotes, setResolveNotes] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editConfirmedBy, setEditConfirmedBy] = useState("");

  const { data: logs = [], isLoading } = useQuery<PackLog[]>({
    queryKey: ["pack-delivery", filterYear, filterStatus],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterYear !== "all") p.set("year", filterYear);
      if (filterStatus !== "all") p.set("status", filterStatus);
      return customFetch(`/api/pack-delivery?${p}`);
    },
  });

  const { data: stats } = useQuery<PackStats>({
    queryKey: ["pack-delivery-stats"],
    queryFn: () => customFetch("/api/pack-delivery/stats"),
  });

  const { data: failures = [] } = useQuery<PackFailure[]>({
    queryKey: ["pack-delivery-failures", expanded],
    queryFn: () => expanded ? customFetch(`/api/pack-delivery/${expanded}/failures`) : Promise.resolve([]),
    enabled: !!expanded,
  });

  const createMutation = useMutation({
    mutationFn: () => customFetch("/api/pack-delivery", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pack-delivery"] }); qc.invalidateQueries({ queryKey: ["pack-delivery-stats"] }); setAddOpen(false); toast({ title: "Pack delivery log created" }); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; confirmation_status?: string; notes?: string; confirmed_by?: string }) =>
      customFetch(`/api/pack-delivery/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pack-delivery"] }); setEditId(null); toast({ title: "Updated" }); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, resolution_notes }: { id: string; resolution_notes: string }) =>
      customFetch(`/api/pack-delivery/failures/${id}`, { method: "PATCH", body: JSON.stringify({ resolution_notes }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pack-delivery"] });
      qc.invalidateQueries({ queryKey: ["pack-delivery-failures", expanded] });
      setResolveOpen(false);
      setSelectedFailure(null);
      setResolveNotes("");
      toast({ title: "Failure resolved" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const years = Array.from(new Set(logs.map((l) => l.year))).sort((a, b) => b - a);
  const now = new Date();
  const currentMonthLog = logs.find((l) => l.month_number === now.getMonth() + 1 && l.year === now.getFullYear());

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl md:text-3xl font-heading font-bold">Pack Delivery Tracker</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => exportCsv(logs)}>
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Create Log
            </Button>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Months Tracked", value: stats.total_months, Icon: Package },
            { label: "Total Emails Sent", value: stats.total_sent.toLocaleString(), Icon: Mail },
            { label: "Total Failures", value: stats.total_failures, Icon: XCircle },
            { label: "Success Rate", value: `${stats.success_rate}%`, Icon: CheckCircle2 },
          ].map(({ label, value, Icon }) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Current Month — prominent */}
      {currentMonthLog && (
        <div className={`rounded-xl border-2 p-5 ${currentMonthLog.failure_counts.unresolved > 0 ? "border-amber-300 bg-amber-50" : "border-primary/20 bg-primary/5"}`}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Current Month</div>
              <div className="text-2xl font-bold font-heading">{currentMonthLog.month_name} {currentMonthLog.year}</div>
              <div className="flex items-center gap-2 mt-2">
                {statusBadge(currentMonthLog.confirmation_status)}
                {currentMonthLog.created_date && (
                  <span className="text-xs text-muted-foreground">{daysSince(currentMonthLog.created_date)} days since created</span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4 text-center">
              {[
                { label: "Members", value: currentMonthLog.total_active_members_at_send, alert: false },
                { label: "Sent", value: currentMonthLog.delivery_emails_sent, alert: false },
                { label: "Opened", value: currentMonthLog.emails_opened ?? 0, alert: false },
                { label: "Failed", value: currentMonthLog.delivery_emails_failed, alert: currentMonthLog.delivery_emails_failed > 0 },
              ].map(({ label, value, alert }) => (
                <div key={label}>
                  <div className={`text-2xl font-bold ${alert ? "text-destructive" : label === "Opened" ? "text-green-600" : ""}`}>{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  {label === "Opened" && currentMonthLog.delivery_emails_sent > 0 && (
                    <div className="text-xs text-green-600 font-medium">
                      {Math.round(((currentMonthLog.emails_opened ?? 0) / currentMonthLog.delivery_emails_sent) * 100)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {currentMonthLog.failure_counts.unresolved > 0 && (
            <div className="mt-3 flex items-center gap-2 text-amber-700 text-sm font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {currentMonthLog.failure_counts.unresolved} unresolved {currentMonthLog.failure_counts.unresolved === 1 ? "failure" : "failures"} need attention
            </div>
          )}
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setExpanded(expanded === currentMonthLog.id ? null : currentMonthLog.id)}>
            {expanded === currentMonthLog.id ? "Hide Details" : "Show Details"}
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Select value={filterYear} onValueChange={setFilterYear}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Year" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {["Pending","Sent","Partial","Confirmed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Log list */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 rounded-xl bg-muted/20 animate-pulse" />)}</div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground text-sm">No pack delivery logs yet</div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const isCurrent = log.month_number === now.getMonth() + 1 && log.year === now.getFullYear();
            if (isCurrent) return null; // already shown above
            const isExpanded = expanded === log.id;
            return (
              <div key={log.id} className="rounded-xl border bg-card overflow-hidden">
                {/* Row header */}
                <button
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
                  onClick={() => setExpanded(isExpanded ? null : log.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{log.month_name} {log.year}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {statusBadge(log.confirmation_status)}
                      {log.failure_counts.unresolved > 0 && (
                        <span className="text-xs text-amber-700 font-medium">{log.failure_counts.unresolved} unresolved</span>
                      )}
                    </div>
                  </div>
                  <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
                    <span><span className="font-semibold text-foreground">{log.total_active_members_at_send}</span> members</span>
                    <span><span className="font-semibold text-foreground">{log.delivery_emails_sent}</span> sent</span>
                    {(log.emails_opened ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-green-600 font-semibold">
                        <Eye className="w-3.5 h-3.5" />
                        {log.delivery_emails_sent > 0
                          ? `${Math.round(((log.emails_opened ?? 0) / log.delivery_emails_sent) * 100)}% opened`
                          : `${log.emails_opened} opened`}
                      </span>
                    )}
                    <span className={log.delivery_emails_failed > 0 ? "text-destructive font-semibold" : ""}>{log.delivery_emails_failed} failed</span>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t px-4 py-4 space-y-4 bg-muted/10">
                    {/* Tier breakdown */}
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Tier Breakdown</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        {[
                          { label: "Core", value: log.core_members_count },
                          { label: "Minis", value: log.minis_members_count },
                          { label: "HS Core", value: log.homeschool_core_count },
                          { label: "HS Minis", value: log.homeschool_minis_count },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-background rounded-lg border px-3 py-2">
                            <div className="text-xs text-muted-foreground">{label}</div>
                            <div className="font-bold">{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Admin edit */}
                    {isAdmin && (
                      editId === log.id ? (
                        <div className="space-y-3">
                          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Edit Record</div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Status</Label>
                              <Select value={editStatus} onValueChange={setEditStatus}>
                                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                <SelectContent>{["Pending","Sent","Partial","Confirmed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Confirmed By</Label>
                              <Input className="h-8" value={editConfirmedBy} onChange={(e) => setEditConfirmedBy(e.target.value)} />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Notes</Label>
                            <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="min-h-[60px] text-sm" />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => updateMutation.mutate({ id: log.id, confirmation_status: editStatus, notes: editNotes, confirmed_by: editConfirmedBy })} disabled={updateMutation.isPending}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => { setEditId(log.id); setEditStatus(log.confirmation_status); setEditNotes(log.notes || ""); setEditConfirmedBy(log.confirmed_by || ""); }}>
                          Edit Record
                        </Button>
                      )
                    )}

                    {/* Notes display */}
                    {log.notes && (
                      <div className="text-sm text-muted-foreground bg-background border rounded-lg px-3 py-2">{log.notes}</div>
                    )}

                    {/* Failures */}
                    {log.failure_counts.total > 0 && (
                      <div>
                        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                          Failures ({log.failure_counts.total})
                        </div>
                        <div className="space-y-2">
                          {failures.filter((f) => f.pack_delivery_log_id === log.id).length === 0 && (
                            <div className="text-xs text-muted-foreground">Loading failures…</div>
                          )}
                          {failures.filter((f) => f.pack_delivery_log_id === log.id).map((failure) => (
                            <div key={failure.id} className={`rounded-lg border px-3 py-2 text-sm flex items-start gap-3 ${failure.resolved ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium">
                                  {failure.parents ? `${failure.parents.first_name} ${failure.parents.last_name}` : "Unknown parent"}
                                  {failure.children && <span className="text-muted-foreground"> — {failure.children.child_first_name}</span>}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">{failure.failure_reason}</div>
                                {failure.resolved && failure.resolution_notes && (
                                  <div className="text-xs text-green-700 mt-1">Resolved: {failure.resolution_notes}</div>
                                )}
                              </div>
                              {failure.resolved
                                ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                                : <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => { setSelectedFailure(failure); setResolveNotes(""); setResolveOpen(true); }}>Mark Resolved</Button>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Log Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Pack Delivery Log</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will create a log entry for the current month and populate member counts from active subscriptions.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Failure Sheet */}
      <Sheet open={resolveOpen} onOpenChange={setResolveOpen}>
        <SheetContent side="right" className="w-full sm:w-[400px]">
          {selectedFailure && (
            <>
              <SheetHeader>
                <SheetTitle>Resolve Failure</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                  <div><span className="font-medium">Parent:</span> {selectedFailure.parents ? `${selectedFailure.parents.first_name} ${selectedFailure.parents.last_name}` : "—"}</div>
                  <div><span className="font-medium">Email:</span> {selectedFailure.parents?.email || "—"}</div>
                  {selectedFailure.children && <div><span className="font-medium">Child:</span> {selectedFailure.children.child_first_name}</div>}
                  <div><span className="font-medium">Reason:</span> {selectedFailure.failure_reason}</div>
                  <div><span className="font-medium">Reported:</span> {format(parseISO(selectedFailure.created_at), "MMM d, yyyy")}</div>
                </div>
                <div className="space-y-1.5">
                  <Label>Resolution Notes</Label>
                  <Textarea placeholder="Describe how this was resolved…" value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} className="min-h-[100px]" />
                </div>
                <Button className="w-full" onClick={() => resolveMutation.mutate({ id: selectedFailure.id, resolution_notes: resolveNotes })} disabled={resolveMutation.isPending}>
                  {resolveMutation.isPending ? "Saving…" : "Mark as Resolved"}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
